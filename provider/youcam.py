"""Server-only Clothes V4 adapter. Contract-tested; live integration UNVERIFIED.

There is no simulated output path and no implicit credential discovery. A caller
supplies current consent/revision checks and commits returned bytes atomically.
"""

from dataclasses import asdict, dataclass, field, replace
import hashlib
import json
import math
import re
import time
from typing import Callable
from urllib.parse import quote, urlsplit

from .images import MAX_IMAGE_BYTES, ImageValidationError, validate_image
from .transport import HttpResponse, TransportError, UrllibTransport

API_ORIGIN = "https://yce-api-01.makeupar.com"
FILE_PATH = "/s2s/v2.0/file"
TASK_PATH = "/s2s/v2.0/task/cloth-v4"
STORAGE_HOSTS = frozenset({"yce-us.s3-accelerate.amazonaws.com"})
POLL_SECONDS = 10
MAX_POLLS = 60
MAX_TASK_SECONDS = 600
MAX_JSON_BYTES = 65_536
ID_PATTERN = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
TASK_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,512}\Z")
FILE_ID_PATTERN = re.compile(r"[A-Za-z0-9_+/=-]{1,1024}\Z")
HASH_PATTERN = re.compile(r"[a-f0-9]{64}\Z")
ENGINE_ERRORS = frozenset({
    "error_exceed_max_image_size", "exceed_max_filesize", "invalid_parameter",
    "error_download_image", "error_download_mask", "error_decode_image",
    "error_decode_mask", "error_nsfw_content_detected", "error_no_face",
    "error_pose", "error_face_parsing", "error_inference",
    "exceed_nsfw_retry_limits", "error_upload", "unknown_internal_error",
    "error_below_min_image_size", "error_invalid_ref", "error_apply_region_mismatch",
    "error_invalid_src", "error_editing_failed",
})
HTTP_CODES = frozenset({
    "InvalidParameters", "CreditInsufficiency", "InvalidStyleGroup", "InvalidStyle",
    "BadRequest", "InvalidAccessToken", "InvalidTaskId", "TaskTimeout",
})


class ProviderError(Exception):
    def __init__(self, code, *, stage="validation", http_status=None,
                 retryable=False, retry_after_seconds=None, creation_uncertain=False,
                 task_id=None):
        # Codes are controlled by this module, never raw upstream error strings.
        super().__init__(code)
        self.code = code
        self.stage = stage
        self.http_status = http_status
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        self.creation_uncertain = creation_uncertain
        self.task_id = task_id

    def as_dict(self):
        return {name: getattr(self, name) for name in (
            "code", "stage", "http_status", "retryable", "retry_after_seconds",
            "creation_uncertain", "task_id",
        )}


class MissingConfiguration(ProviderError):
    def __init__(self):
        super().__init__("provider_unconfigured", stage="configuration")


def _positive_int(value):
    return type(value) is int and 1 <= value <= 2**53 - 1


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


@dataclass(frozen=True)
class PreviewBinding:
    appointment_id: str
    client_id: str
    choice_revision: int
    item_id: str
    item_revision: int
    item_photo_revision: int
    source_photo_revision: int
    consent_revision: int

    def __post_init__(self):
        for name in ("appointment_id", "client_id", "item_id"):
            value = getattr(self, name)
            if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
                raise ProviderError("invalid_binding")
        for name in ("choice_revision", "item_revision", "item_photo_revision",
                     "source_photo_revision", "consent_revision"):
            if not _positive_int(getattr(self, name)):
                raise ProviderError("invalid_binding")

    def as_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        if type(data) is not dict or set(data) != set(cls.__dataclass_fields__):
            raise ProviderError("invalid_binding")
        return cls(**data)


ProviderBinding = PreviewBinding


@dataclass(frozen=True)
class ImageInput:
    data: bytes = field(repr=False)
    mime_type: str

    def __post_init__(self):
        try:
            validate_image(self.data, self.mime_type)
        except ImageValidationError as error:
            raise ProviderError(str(error), stage="image_validation") from None


@dataclass(frozen=True)
class ProviderTask:
    task_id: str
    binding: PreviewBinding
    created_at: float
    deadline_at: float
    next_poll_at: float
    source_sha256: str
    reference_sha256: str
    poll_count: int = 0
    provider: str = "youcam-clothes-v4"

    def __post_init__(self):
        if not isinstance(self.task_id, str) or not TASK_PATTERN.fullmatch(self.task_id):
            raise ProviderError("invalid_task_record")
        if not isinstance(self.binding, PreviewBinding) or self.provider != "youcam-clothes-v4":
            raise ProviderError("invalid_task_record")
        if not all(_number(getattr(self, x)) for x in ("created_at", "deadline_at", "next_poll_at")):
            raise ProviderError("invalid_task_record")
        if not self.created_at < self.deadline_at <= self.created_at + MAX_TASK_SECONDS:
            raise ProviderError("invalid_task_record")
        if not self.created_at <= self.next_poll_at <= self.deadline_at:
            raise ProviderError("invalid_task_record")
        if type(self.poll_count) is not int or not 0 <= self.poll_count <= MAX_POLLS:
            raise ProviderError("invalid_task_record")
        for value in (self.source_sha256, self.reference_sha256):
            if not isinstance(value, str) or not HASH_PATTERN.fullmatch(value):
                raise ProviderError("invalid_task_record")

    def as_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        if type(data) is not dict or set(data) != set(cls.__dataclass_fields__):
            raise ProviderError("invalid_task_record")
        values = dict(data)
        values["binding"] = PreviewBinding.from_dict(data["binding"])
        return cls(**values)


@dataclass(frozen=True)
class PreviewOutput:
    data: bytes = field(repr=False)
    mime_type: str
    sha256: str
    width: int
    height: int


@dataclass(frozen=True)
class PreviewOutcome:
    status: str  # pending | succeeded | failed; never an inventory state.
    task: ProviderTask
    output: PreviewOutput | None = None
    error_code: str | None = None
    retry_after_seconds: int | None = None


def _json_object(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate_key")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("invalid_constant")

    try:
        result = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise ProviderError("invalid_provider_response") from None
    if type(result) is not dict:
        raise ProviderError("invalid_provider_response")
    return result


def _headers(headers):
    if not isinstance(headers, dict):
        raise ProviderError("invalid_provider_response")
    result = {}
    for key, value in headers.items():
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,100}", key):
            raise ProviderError("invalid_provider_response")
        lower = key.lower()
        if lower in result or not isinstance(value, str) or any(ord(c) < 32 or ord(c) > 126 for c in value):
            raise ProviderError("invalid_provider_response")
        result[lower] = value
    return result


class YouCamClothesV4:
    """Inject a key explicitly on the server. This class never reads secrets.

    check_current(binding) must return literal True only if the authenticated
    actor's consent and all bound revisions remain current. App-level compare
    and commit is still required after the final return: the adapter is not a DB.
    """

    def __init__(self, api_key=None, *, transport=None, clock=time.time,
                 request_timeout_seconds=30, storage_hosts=STORAGE_HOSTS):
        if api_key is not None and (not isinstance(api_key, str) or not 1 <= len(api_key) <= 4096
                                    or any(ord(c) < 33 or ord(c) > 126 for c in api_key)):
            raise ProviderError("invalid_provider_configuration", stage="configuration")
        if not _number(request_timeout_seconds) or not 0 < request_timeout_seconds <= 60:
            raise ProviderError("invalid_provider_configuration", stage="configuration")
        if not isinstance(storage_hosts, (set, frozenset, tuple, list)) or not storage_hosts:
            raise ProviderError("invalid_provider_configuration", stage="configuration")
        # An operator may add another independently verified provider hostname.
        # Wildcards, IP addresses, custom API endpoints and browser input cannot.
        for host in storage_hosts:
            if not isinstance(host, str) or not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,63}", host):
                raise ProviderError("invalid_provider_configuration", stage="configuration")
        self._api_key = api_key
        self._transport = transport or UrllibTransport()
        self._clock = clock
        self._request_timeout = request_timeout_seconds
        self._storage_hosts = frozenset(storage_hosts)

    @property
    def configured(self):
        return self._api_key is not None

    def _require_configuration(self):
        if not self.configured:
            raise MissingConfiguration()

    def _now(self):
        value = self._clock()
        if not _number(value):
            raise ProviderError("invalid_clock", stage="configuration")
        return value

    def _guard(self, binding, check_current, *, stage, task_id=None):
        if not isinstance(binding, PreviewBinding) or not callable(check_current):
            raise ProviderError("binding_check_required", stage=stage, task_id=task_id)
        try:
            current = check_current(binding)
        except Exception:
            raise ProviderError("binding_check_failed", stage=stage, task_id=task_id) from None
        if current is not True:
            raise ProviderError("binding_not_current", stage=stage, task_id=task_id)

    def _storage_url(self, value, stage):
        try:
            if not isinstance(value, str) or not 1 <= len(value) <= 16384 or any(ord(c) < 33 or ord(c) > 126 for c in value):
                raise ValueError()
            parsed = urlsplit(value)
            if (parsed.scheme != "https" or parsed.hostname not in self._storage_hosts
                    or parsed.username is not None or parsed.password is not None
                    or parsed.port not in (None, 443) or parsed.fragment
                    or not parsed.path or "\\" in value):
                raise ValueError()
        except ValueError:
            raise ProviderError("untrusted_storage_url", stage=stage) from None
        return value

    def _request(self, method, url, headers, body, *, stage, deadline, max_bytes):
        remaining = deadline - self._now()
        if remaining <= 0:
            raise ProviderError("preview_deadline_exceeded", stage=stage)
        try:
            response = self._transport.request(
                method=method, url=url, headers=headers, body=body,
                timeout_seconds=min(remaining, self._request_timeout), max_bytes=max_bytes,
            )
        except (TransportError, OSError, TimeoutError):
            raise ProviderError(
                "provider_network_error", stage=stage, retryable=method == "GET",
                retry_after_seconds=POLL_SECONDS if method == "GET" else None,
                creation_uncertain=stage == "create_task",
            ) from None
        if (not isinstance(response, HttpResponse) or type(response.status) is not int
                or not 100 <= response.status <= 599 or type(response.body) is not bytes
                or len(response.body) > max_bytes):
            raise ProviderError("invalid_provider_response", stage=stage,
                                creation_uncertain=stage == "create_task")
        # An out-of-deadline create response may still disclose a useful task ID.
        # Do not discard that ID here; create_preview validates and reports it.
        return response

    def _api(self, method, path, body, *, stage, deadline):
        response = self._request(
            method, API_ORIGIN + path,
            {"Authorization": "Bearer " + self._api_key, "Content-Type": "application/json", "Accept": "application/json"},
            json.dumps(body, separators=(",", ":"), allow_nan=False).encode() if body is not None else None,
            stage=stage, deadline=deadline, max_bytes=MAX_JSON_BYTES,
        )
        try:
            headers = _headers(response.headers)
            value = _json_object(response.body)
        except ProviderError:
            raise ProviderError("invalid_provider_response", stage=stage, http_status=response.status,
                                creation_uncertain=stage == "create_task") from None
        if response.status != 200:
            code = value.get("error_code")
            code = code if isinstance(code, str) and code in HTTP_CODES else "provider_http_error"
            if response.status in (401, 403):
                code = "provider_authentication_failed"
            elif response.status == 429:
                code = "provider_rate_limited"
            retryable = method == "GET" and response.status in (429, 502, 503, 504)
            delay = POLL_SECONDS
            if re.fullmatch(r"[0-9]{1,4}", headers.get("retry-after", "")):
                delay = max(POLL_SECONDS, min(600, int(headers["retry-after"])))
            raise ProviderError(code, stage=stage, http_status=response.status,
                                retryable=retryable, retry_after_seconds=delay if retryable else None,
                                creation_uncertain=stage == "create_task" and response.status >= 500)
        if (headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json"
                or type(value.get("status")) is not int or value["status"] != 200
                or type(value.get("data")) is not dict):
            raise ProviderError("invalid_provider_response", stage=stage, creation_uncertain=stage == "create_task")
        return value["data"]

    def _upload(self, image, role, binding, check_current, deadline):
        stage = "allocate_" + role
        self._guard(binding, check_current, stage=stage)
        mime = "image/jpg" if image.mime_type == "image/jpeg" else image.mime_type
        filename = role + (".png" if mime == "image/png" else ".jpg")
        payload = {"files": [{"content_type": mime, "file_name": filename, "file_size": len(image.data)}]}
        data = self._api("POST", FILE_PATH, payload, stage=stage, deadline=deadline)
        files = data.get("files")
        if not isinstance(files, list) or len(files) != 1 or type(files[0]) is not dict:
            raise ProviderError("invalid_file_allocation", stage=stage)
        entry = files[0]
        file_id = entry.get("file_id")
        requests = entry.get("requests")
        if (entry.get("content_type") != mime or entry.get("file_name") != filename
                or not isinstance(file_id, str) or not FILE_ID_PATTERN.fullmatch(file_id)
                or not isinstance(requests, list) or len(requests) != 1 or type(requests[0]) is not dict):
            raise ProviderError("invalid_file_allocation", stage=stage)
        upload = requests[0]
        if upload.get("method") != "PUT" or type(upload.get("headers")) is not dict:
            raise ProviderError("invalid_upload_instruction", stage=stage)
        # The official File schema shows Content-Length as both integer and
        # string; accept either, normalize, and bind it to the actual byte length.
        converted = {}
        for key, value in upload["headers"].items():
            if isinstance(key, str) and key.lower() == "content-length" and type(value) is int:
                value = str(value)
            converted[key] = value
        headers = _headers(converted)
        if (headers.get("content-type") != mime or headers.get("content-length") != str(len(image.data))
                or any(name not in ("content-type", "content-length") and not name.startswith("x-amz-") for name in headers)):
            raise ProviderError("invalid_upload_instruction", stage=stage)
        url = self._storage_url(upload.get("url"), stage)
        self._guard(binding, check_current, stage="upload_" + role)
        response = self._request("PUT", url, headers, image.data, stage="upload_" + role,
                                 deadline=deadline, max_bytes=MAX_JSON_BYTES)
        if response.status not in (200, 201, 204):
            raise ProviderError("provider_upload_failed", stage="upload_" + role, http_status=response.status)
        self._guard(binding, check_current, stage="uploaded_" + role)
        return file_id

    def create_preview(self, *, source: ImageInput, reference: ImageInput,
                       binding: PreviewBinding, check_current: Callable) -> ProviderTask:
        self._require_configuration()
        if not isinstance(source, ImageInput) or not isinstance(reference, ImageInput):
            raise ProviderError("validated_image_required")
        self._guard(binding, check_current, stage="before_upload")
        started = self._now()
        deadline = started + MAX_TASK_SECONDS
        source_id = self._upload(source, "source", binding, check_current, deadline)
        reference_id = self._upload(reference, "reference", binding, check_current, deadline)
        self._guard(binding, check_current, stage="create_task")
        data = self._api("POST", TASK_PATH, {
            "src_file_id": source_id, "ref_file_id": reference_id,
            "garment_category": "outer", "change_shoes": False, "filter_multi_person": "strict",
        }, stage="create_task", deadline=deadline)
        task_id = data.get("task_id")
        if not isinstance(task_id, str) or not TASK_PATTERN.fullmatch(task_id):
            raise ProviderError("invalid_provider_task_id", stage="create_task", creation_uncertain=True)
        self._guard(binding, check_current, stage="task_created", task_id=task_id)
        now = self._now()
        if now >= deadline:
            raise ProviderError("preview_deadline_exceeded", stage="task_created", task_id=task_id)
        return ProviderTask(task_id, binding, started, deadline, min(now + POLL_SECONDS, deadline),
                            hashlib.sha256(source.data).hexdigest(), hashlib.sha256(reference.data).hexdigest())

    def poll_preview(self, task: ProviderTask, *, check_current: Callable) -> PreviewOutcome:
        self._require_configuration()
        if not isinstance(task, ProviderTask):
            raise ProviderError("invalid_task_record")
        self._guard(task.binding, check_current, stage="poll_task", task_id=task.task_id)
        now = self._now()
        if now < task.created_at:
            raise ProviderError("clock_moved_backwards", stage="poll_task", task_id=task.task_id)
        if now >= task.deadline_at or task.poll_count >= MAX_POLLS:
            return PreviewOutcome("failed", task, error_code="preview_deadline_exceeded")
        if now < task.next_poll_at:
            return PreviewOutcome("pending", task, retry_after_seconds=math.ceil(task.next_poll_at - now))
        updated = replace(task, poll_count=task.poll_count + 1,
                          next_poll_at=min(now + POLL_SECONDS, task.deadline_at))
        try:
            data = self._api("GET", TASK_PATH + "/" + quote(task.task_id, safe=""), None,
                             stage="poll_task", deadline=task.deadline_at)
            self._guard(task.binding, check_current, stage="polled_task", task_id=task.task_id)
            if self._now() >= task.deadline_at:
                return PreviewOutcome("failed", updated, error_code="preview_deadline_exceeded")
            state = data.get("task_status")
            if state == "running":
                if data.get("error") is not None or data.get("results") not in (None, {}):
                    raise ProviderError("contradictory_provider_response", stage="poll_task")
                return PreviewOutcome("pending", updated, retry_after_seconds=POLL_SECONDS)
            if state == "error":
                code = data.get("error")
                if not isinstance(code, str) or not code or data.get("results") not in (None, {}):
                    raise ProviderError("invalid_provider_response", stage="poll_task")
                return PreviewOutcome("failed", updated,
                                      error_code=code if code in ENGINE_ERRORS else "provider_engine_error")
            if state != "success" or data.get("error") is not None or type(data.get("results")) is not dict:
                raise ProviderError("invalid_provider_response", stage="poll_task")
            url = self._storage_url(data["results"].get("url"), "download_result")
            self._guard(task.binding, check_current, stage="download_result", task_id=task.task_id)
            response = self._request("GET", url, {"Accept": "image/jpeg, image/png"}, None,
                                     stage="download_result", deadline=task.deadline_at,
                                     max_bytes=MAX_IMAGE_BYTES - 1)
            if response.status != 200:
                raise ProviderError("provider_result_download_failed", stage="download_result", http_status=response.status)
            headers = _headers(response.headers)
            mime = headers.get("content-type", "").split(";", 1)[0].strip().lower()
            try:
                width, height = validate_image(response.body, mime, is_input=False)
            except ImageValidationError:
                raise ProviderError("invalid_provider_image", stage="download_result") from None
            self._guard(task.binding, check_current, stage="result_ready", task_id=task.task_id)
            if self._now() >= task.deadline_at:
                return PreviewOutcome("failed", updated, error_code="preview_deadline_exceeded")
            output = PreviewOutput(response.body, mime, hashlib.sha256(response.body).hexdigest(), width, height)
            return PreviewOutcome("succeeded", updated, output=output)
        except ProviderError as error:
            # Binding failure is not provider failure: expose it to the caller
            # so it can invalidate the local task and discard any returned bytes.
            if error.code in ("binding_not_current", "binding_check_failed", "binding_check_required"):
                raise
            if error.retryable and self._now() < task.deadline_at:
                delay = error.retry_after_seconds or POLL_SECONDS
                updated = replace(updated, next_poll_at=min(self._now() + delay, task.deadline_at))
                return PreviewOutcome("pending", updated, error_code=error.code, retry_after_seconds=delay)
            return PreviewOutcome("failed", updated, error_code=error.code)
