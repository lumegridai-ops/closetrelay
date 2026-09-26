"""Loopback-only, single-operator HTTP application. No login or public deployment."""
import argparse
import base64
import binascii
from datetime import datetime, timezone
import importlib
import json
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from .demo import DEMO
from .model import Actor, Closet, Conflict, Denied, NotFound


MAX_JSON_BYTES = 12 * 1024 * 1024
MAX_IMAGE_BYTES = 8 * 1024 * 1024
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
PACKAGE_ROOT = Path(__file__).resolve().parent.parent


class APIError(Exception):
    def __init__(self, status, code, message, details=None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details

    def body(self):
        error = {"code": self.code, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return {"error": error}


def now():
    return datetime.now(timezone.utc).isoformat()


def object_body(body, allowed, required=()):
    if not isinstance(body, dict):
        raise APIError(400, "invalid_request", "The JSON body must be an object")
    unknown = set(body) - set(allowed)
    missing = set(required) - set(body)
    if unknown or missing:
        raise APIError(400, "invalid_request", "Request fields do not match this action",
                       {"unknown_fields": sorted(unknown), "missing_fields": sorted(missing)})


def text_field(body, key, maximum=300, required=True):
    value = body.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise APIError(400, "invalid_request", f"{key} must be a nonempty string of at most {maximum} characters")
    return value.strip()


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise APIError(400, "invalid_identifier", "Identifiers must be 1–80 letters, digits, hyphens or underscores, starting with a letter or digit")
    return value


def integer_field(body, key, minimum=0):
    value = body.get(key)
    if type(value) is not int or value < minimum:
        raise APIError(400, "invalid_request", f"{key} must be an integer of at least {minimum}")
    return value


def boolean_field(body, key):
    if type(body.get(key)) is not bool:
        raise APIError(400, "invalid_request", f"{key} must be true or false")
    return body[key]


def clean_item(item):
    return {**item, "is_demo": bool(item["is_demo"]), "photo_ref": item["photo_ref"] or None}


class Application:
    def __init__(self, database, ui_directory=None, *, seed_demo=True, provider=None, provider_module=None):
        self.database = Path(database).resolve()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.closet = Closet(self.database)
        if seed_demo:
            self.closet.initialize_demo(DEMO)
        self.ui_directory = Path(ui_directory or PACKAGE_ROOT / "ui").resolve()
        self.provider = provider
        self.provider_module = provider_module
        self.provider_import_error = None
        if provider is None:
            try:
                self.provider_module = importlib.import_module("provider.youcam")
                self.provider = self.provider_module.YouCamClothesV4(api_key=os.environ.get("YOUCAM_API_KEY"))
            except ImportError:
                self.provider_import_error = "The provider adapter is not available in this checkout"
        self.preview_locks = {}
        self.lock_guard = threading.Lock()

    def capability(self):
        configured = bool(self.provider and self.provider.configured)
        return {"name": "YouCam Clothes V4", "configured": configured, "enabled": configured,
                "reason": None if configured else (self.provider_import_error or "Preview is disabled: YOUCAM_API_KEY is not configured"),
                "configuration_is_not_api_verification": True,
                "retention_note": "Local withdrawal stops requests and display. Upstream cancellation/deletion is not implemented or verified.",
                "category": "outer", "real_photos_required": True}

    def require_provider(self):
        if not self.capability()["enabled"]:
            raise APIError(503, "preview_disabled", self.capability()["reason"])

    def configure_provider(self, body):
        object_body(body, {"api_key"}, {"api_key"})
        key = body["api_key"]
        if key is not None and (not isinstance(key, str) or not key.strip() or len(key) > 4096):
            raise APIError(400, "invalid_key", "Enter a nonempty API key, or null to clear the in-memory key")
        if self.provider_module is None:
            try:
                self.provider_module = importlib.import_module("provider.youcam")
            except ImportError:
                raise APIError(503, "adapter_unavailable", "The provider adapter is not available in this checkout")
        # Only the adapter holds the key in process memory. No database write,
        # environment update, audit payload, response echo or file persistence.
        self.provider = self.provider_module.YouCamClothesV4(api_key=key.strip() if key else None)
        self.provider_import_error = None
        return {"provider": self.capability(), "storage": "process_memory_only", "api_access_verified": False}

    def appointment(self, appointment_id):
        record = self.closet.appointment(Actor("client", appointment_id), appointment_id)
        record["previews"] = [self.preview_view(task_id) for task_id in self.closet.list_previews(appointment_id)]
        return record

    def audit(self):
        return [{**event, "payload": json.loads(event["payload"])} for event in self.closet.diagnostic_rows("audit")]

    def state(self):
        items = [clean_item(item) for item in self.closet.items()]
        appointments = [self.appointment(appointment["id"]) for appointment in self.closet.appointments()]
        return {"items": items, "appointments": appointments, "audit": self.audit(), "provider": self.capability(),
                "server_time": now(), "scope": {"mode": "local_operator", "authentication": False,
                  "demo_catalog": any(item["is_demo"] for item in items),
                  "notice": "One local operator controls every appointment. View selection is not authenticated client identity. Sample records are fictional; they contain no photos."}}

    def preview_view(self, preview_id):
        task = self.closet.preview_record(preview_id)
        view = self.closet.preview(Actor("client", task["appointment_id"]), preview_id)
        job = self.closet.provider_job(preview_id)
        provider = None
        if job:
            task_data = json.loads(job["task_json"]) if job["task_json"] else {}
            error = job["error"]
            if error:
                try:
                    error = json.loads(error)
                except (TypeError, json.JSONDecodeError):
                    pass
            provider = {"name": job["provider"], "task_id": job["provider_task_id"], "status": job["status"],
                        "created_at": job["created_at"], "updated_at": job["updated_at"], "error": error,
                        "next_poll_at": task_data.get("next_poll_at"), "deadline_at": task_data.get("deadline_at"),
                        "poll_count": task_data.get("poll_count", 0)}
        return {"id": preview_id, "appointment_id": task["appointment_id"], "status": view["status"],
                "displayable": view["displayable"], "result_url": view["result_ref"], "reason": task["reason"],
                "item_id": task["item_id"], "item_version": task["item_version"], "choice_revision": task["choice_revision"],
                "consent_revision": task["consent_revision"], "source_revision": task["source_revision"], "provider": provider}

    def binding(self, preview_id):
        task = self.closet.preview_record(preview_id)
        return self.provider_module.PreviewBinding(
            appointment_id=task["appointment_id"], client_id=task["appointment_id"],
            choice_revision=task["choice_revision"], item_id=task["item_id"], item_revision=task["item_version"],
            item_photo_revision=task["item_version"], source_photo_revision=task["source_revision"],
            consent_revision=task["consent_revision"])

    def current_guard(self, preview_id, binding):
        return lambda observed: observed == binding and self.closet.preview_current(preview_id)

    def provider_failure(self, preview_id, error, task=None):
        safe = error.as_dict() if hasattr(error, "as_dict") else {
            "code": "provider_error", "message": "The provider operation failed", "retryable": False}
        self.closet.record_provider_job(preview_id, task=task, status="failed", error=safe)
        if not safe.get("retryable") or safe.get("creation_uncertain"):
            self.closet.complete_preview(preview_id, "failed")
        raise APIError(502, safe.get("code", "provider_error"), safe.get("message", "The provider operation failed"),
                       {**safe, "preview_id": preview_id})

    def create_preview(self, appointment_id, body):
        object_body(body, {"retry_of"})
        retry_of = identifier(body["retry_of"]) if "retry_of" in body else None
        self.require_provider()  # No key: no task row, upload or provider network request.
        appointment = self.closet.appointment(Actor("client", appointment_id), appointment_id)
        approval = appointment["approval"]
        if not approval or not appointment["consent"] or not appointment["source_ref"]:
            raise APIError(409, "preview_not_ready", "Choose an item and record explicit photo-processing consent with a source photo first")
        item = next((entry for entry in self.closet.items() if entry["id"] == approval["item_id"]), None)
        if item is None or not item["photo_ref"]:
            raise APIError(409, "garment_photo_required", "Add a real photograph of this exact garment before requesting a preview")
        source = self.closet.media(identifier(appointment["source_ref"].removeprefix("/media/")))
        reference = self.closet.media(identifier(item["photo_ref"].removeprefix("/media/")))
        task = self.closet.request_preview(Actor("client", appointment_id), retry_of=retry_of)
        preview_id = task["id"]
        binding = self.binding(preview_id)
        self.closet.record_provider_job(preview_id)
        try:
            remote = self.provider.create_preview(
                source=self.provider_module.ImageInput(data=source["data"], mime_type=source["mime_type"]),
                reference=self.provider_module.ImageInput(data=reference["data"], mime_type=reference["mime_type"]),
                binding=binding, check_current=self.current_guard(preview_id, binding))
            self.closet.record_provider_job(preview_id, task=remote.as_dict(), status="pending")
        except Exception as error:
            self.provider_failure(preview_id, error)
        return self.preview_view(preview_id)

    def refresh_preview(self, preview_id):
        self.require_provider()
        with self.lock_guard:
            lock = self.preview_locks.setdefault(preview_id, threading.Lock())
        with lock:
            current = self.preview_view(preview_id)
            if current["status"] != "pending":
                return current
            job = self.closet.provider_job(preview_id)
            if not job or not job["task_json"]:
                raise APIError(409, "provider_task_unavailable", "This request has no confirmed provider task to poll; inspect its recorded error")
            remote = self.provider_module.ProviderTask.from_dict(json.loads(job["task_json"]))
            binding = self.binding(preview_id)
            try:
                result = self.provider.poll_preview(remote, check_current=self.current_guard(preview_id, binding))
                self.closet.record_provider_job(preview_id, task=result.task.as_dict(), status=result.status,
                                               error={"code": result.error_code} if result.error_code else None)
                if result.status == "succeeded":
                    self.closet.complete_preview_image(preview_id, result.output.data, result.output.mime_type)
                elif result.status == "failed":
                    self.closet.complete_preview(preview_id, "failed")
            except Exception as error:
                self.provider_failure(preview_id, error, remote.as_dict())
            return self.preview_view(preview_id)

    def upload(self, body):
        object_body(body, {"purpose", "mime_type", "data_base64", "appointment_id", "filename"},
                    {"purpose", "mime_type", "data_base64"})
        purpose = body["purpose"]
        if not isinstance(purpose, str) or purpose not in {"source", "garment"}:
            raise APIError(400, "invalid_request", "purpose must be source or garment")
        appointment_id = identifier(body.get("appointment_id")) if purpose == "source" else None
        if purpose == "garment" and body.get("appointment_id") is not None:
            raise APIError(400, "invalid_request", "Garment photos belong to inventory, not an appointment")
        mime_type = body["mime_type"]
        if not isinstance(mime_type, str) or mime_type not in {"image/jpeg", "image/png"}:
            raise APIError(400, "invalid_image", "Only JPEG and PNG images are accepted")
        encoded = body["data_base64"]
        if not isinstance(encoded, str):
            raise APIError(400, "invalid_image", "data_base64 must be a base64 string")
        try:
            data = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise APIError(400, "invalid_image", "Image encoding is invalid")
        if not data or len(data) > MAX_IMAGE_BYTES:
            raise APIError(413, "image_too_large", "Images must contain 1 byte to 8 MiB")
        if (mime_type == "image/png" and not data.startswith(b"\x89PNG\r\n\x1a\n")) or (
                mime_type == "image/jpeg" and not data.startswith(b"\xff\xd8\xff")):
            raise APIError(400, "invalid_image", "Image bytes do not match the declared type")
        if self.provider_module is not None:
            try:
                self.provider_module.ImageInput(data=data, mime_type=mime_type)
            except Exception as error:
                code = error.code if hasattr(error, "code") else "invalid_image_container"
                raise APIError(400, "invalid_image", "Image does not meet the provider's file requirements", {"reason": code})
        return self.closet.upload_media(purpose, mime_type, data, appointment_id)

    def dispatch(self, method, path, body):
        pieces = [unquote(piece) for piece in path.split("/") if piece]
        if path == "/api/health" and method == "GET":
            return 200, {"ok": True, "app": "ClosetRelay", "mode": "local_operator", "authentication": False,
                         "provider": self.capability(), "server_time": now()}
        if path == "/api/state" and method == "GET":
            return 200, self.state()
        if path == "/api/audit" and method == "GET":
            return 200, {"events": self.audit()}
        if path == "/api/provider/configure" and method == "POST":
            return 200, self.configure_provider(body)
        if path == "/api/uploads" and method == "POST":
            return 201, self.upload(body)
        if path == "/api/items":
            if method == "GET":
                return 200, {"items": [clean_item(item) for item in self.closet.items()]}
            if method == "POST":
                object_body(body, {"id", "label", "location", "condition"}, {"id", "label", "location", "condition"})
                return 201, clean_item(self.closet.create_item(identifier(body["id"]), text_field(body, "label"),
                                                              text_field(body, "location"), text_field(body, "condition", 2000)))
        if len(pieces) == 3 and pieces[:2] == ["api", "items"] and method == "PATCH":
            item_id = identifier(pieces[2])
            object_body(body, {"expected_version", "condition", "unavailable", "photo_id"}, {"expected_version"})
            if not any(field in body for field in ("condition", "unavailable", "photo_id")):
                raise APIError(400, "invalid_request", "Supply a condition, availability or garment-photo change")
            changes = {"expected_version": integer_field(body, "expected_version", 1)}
            if "condition" in body:
                changes["condition"] = text_field(body, "condition", 2000)
            if "unavailable" in body:
                changes["unavailable"] = boolean_field(body, "unavailable")
            if "photo_id" in body:
                photo = self.closet.media(identifier(body["photo_id"]))
                if photo["purpose"] != "garment":
                    raise APIError(400, "invalid_image", "An inventory item requires a garment photo")
                changes["photo_ref"] = f"/media/{photo['id']}"
            return 200, clean_item(self.closet.edit_item(Actor("stylist"), item_id, **changes))
        if path == "/api/appointments":
            if method == "GET":
                return 200, {"appointments": [self.appointment(entry["id"]) for entry in self.closet.appointments()]}
            if method == "POST":
                object_body(body, {"name"}, {"name"})
                return 201, self.closet.create_appointment(text_field(body, "name", 160))
        if len(pieces) >= 3 and pieces[:2] == ["api", "appointments"]:
            appointment_id = identifier(pieces[2])
            if len(pieces) == 3 and method == "GET":
                return 200, self.appointment(appointment_id)
            if len(pieces) == 4:
                action = pieces[3]
                if action == "manifest" and method == "GET":
                    self.closet.appointment(Actor("client", appointment_id), appointment_id)
                    return 200, self.closet.picker_manifest(Actor("picker"), appointment_id)
                if action == "choice" and method == "POST":
                    object_body(body, {"item_id", "expected_version", "expected_choice_revision"},
                                {"item_id", "expected_version", "expected_choice_revision"})
                    return 201, self.closet.choose(Actor("client", appointment_id), identifier(body["item_id"]),
                                                  integer_field(body, "expected_version", 1), integer_field(body, "expected_choice_revision"))
                if action == "hold" and method == "POST":
                    object_body(body, {"approval_id"}, {"approval_id"})
                    return 200, self.closet.hold(Actor("stylist", assignments=(appointment_id,)), appointment_id, identifier(body["approval_id"]))
                if action == "consent" and method == "POST":
                    object_body(body, {"consent", "source_id"}, {"consent"})
                    consent = boolean_field(body, "consent")
                    source_ref = None
                    if consent:
                        source = self.closet.media(identifier(body.get("source_id")))
                        if source["purpose"] != "source" or source["appointment_id"] != appointment_id:
                            raise APIError(400, "invalid_image", "Source photo must belong to this appointment")
                        source_ref = f"/media/{source['id']}"
                    result = self.closet.consent(Actor("client", appointment_id), source_ref)
                    return 200, {**result, "local_personal_media_removed": not consent,
                                 "provider_deletion": "unimplemented; no upstream deletion is claimed"}
                if action == "previews" and method == "POST":
                    return 201, self.create_preview(appointment_id, body)
        if len(pieces) == 4 and pieces[:2] == ["api", "holds"] and method == "POST":
            hold_id, action = identifier(pieces[2]), pieces[3]
            if action == "release":
                object_body(body, set())
                holds = self.closet.diagnostic_rows("holds")
                hold = next((entry for entry in holds if entry["id"] == hold_id), None)
                if hold is None:
                    raise NotFound("Unknown hold")
                self.closet.release(Actor("stylist", assignments=(hold["appointment_id"],)), hold_id)
                return 200, {"released": True, "hold_id": hold_id}
            if action == "pack":
                object_body(body, {"item_id", "request_key"}, {"item_id", "request_key"})
                return 200, self.closet.pick(Actor("picker"), hold_id, identifier(body["item_id"]), text_field(body, "request_key", 120))
        if len(pieces) in {3, 4} and pieces[:2] == ["api", "previews"]:
            preview_id = identifier(pieces[2])
            if len(pieces) == 3 and method == "GET":
                return 200, self.preview_view(preview_id)
            if len(pieces) == 4 and pieces[3] == "refresh" and method == "POST":
                object_body(body, set())
                return 200, self.refresh_preview(preview_id)
        raise APIError(404, "not_found", "This endpoint does not exist")


class Handler(BaseHTTPRequestHandler):
    server_version = "ClosetRelayLocal/1"

    def log_message(self, format, *args):
        # No request bodies, photos, API keys, personal names or provider replies in logs.
        return

    def boundary(self):
        port = self.server.server_address[1]
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in allowed_hosts:
            raise APIError(403, "local_host_required", "Use this server's localhost or 127.0.0.1 address")
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{host}" for host in allowed_hosts}:
            raise APIError(403, "same_origin_required", "Use the application served by this local server")

    def json_body(self):
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "invalid_request", "Chunked request bodies are not supported")
        if self.headers.get_content_type() != "application/json":
            raise APIError(415, "json_required", "Send application/json")
        raw_length = self.headers.get("Content-Length")
        if raw_length is None or not raw_length.isdecimal():
            raise APIError(411, "length_required", "A valid Content-Length is required")
        length = int(raw_length)
        if length > MAX_JSON_BYTES:
            raise APIError(413, "request_too_large", "Request exceeds the local upload limit")
        if length == 0:
            raise APIError(400, "invalid_json", "Send a JSON object, including {} for empty actions")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise APIError(400, "invalid_json", "Request body ended early")

        def pairs(entries):
            result = {}
            for key, value in entries:
                if key in result:
                    raise ValueError("Duplicate field")
                result[key] = value
            return result

        try:
            return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                              parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite number")))
        except (ValueError, UnicodeDecodeError):
            raise APIError(400, "invalid_json", "JSON must be valid UTF-8 with unique fields and finite numbers")

    def send_bytes(self, status, body, mime_type, *, head=False):
        self.send_response(status)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def json_response(self, status, body):
        self.send_bytes(status, json.dumps(body, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def handle_request(self, method):
        try:
            self.boundary()
            path = urlsplit(self.path).path
            if path.startswith("/api/"):
                body = self.json_body() if method in {"POST", "PATCH"} else None
                status, result = self.server.application.dispatch(method, path, body)
                self.json_response(status, result)
                return
            if method not in {"GET", "HEAD"}:
                raise APIError(405, "method_not_allowed", "This resource is read-only")
            if path.startswith("/media/"):
                media_id = identifier(unquote(path.removeprefix("/media/")))
                record = self.server.application.closet.media(media_id, for_display=True)
                self.send_bytes(200, record["data"], record["mime_type"], head=method == "HEAD")
                return
            decoded = unquote(path)
            relative = "index.html" if decoded == "/" else decoded.lstrip("/")
            candidate = (self.server.application.ui_directory / relative).resolve()
            if not candidate.is_relative_to(self.server.application.ui_directory) or not candidate.is_file():
                raise APIError(404, "not_found", "UI asset not found")
            self.send_bytes(200, candidate.read_bytes(), mimetypes.guess_type(str(candidate))[0] or "application/octet-stream", head=method == "HEAD")
        except APIError as error:
            self.json_response(error.status, error.body())
        except NotFound as error:
            self.json_response(404, {"error": {"code": "not_found", "message": str(error)}})
        except Conflict as error:
            self.json_response(409, {"error": {"code": "state_conflict", "message": str(error)}})
        except Denied as error:
            self.json_response(403, {"error": {"code": "action_denied", "message": str(error)}})
        except sqlite3.IntegrityError:
            self.json_response(409, {"error": {"code": "record_conflict", "message": "This identifier or allocation already exists"}})
        except sqlite3.OperationalError:
            self.json_response(503, {"error": {"code": "storage_unavailable", "message": "The local database is unavailable or busy; reload before retrying"}})
        except Exception:
            self.json_response(500, {"error": {"code": "internal_error", "message": "The local server could not complete this request"}})

    def do_GET(self):
        self.handle_request("GET")

    def do_HEAD(self):
        self.handle_request("HEAD")

    def do_POST(self):
        self.handle_request("POST")

    def do_PATCH(self):
        self.handle_request("PATCH")


def make_server(application, port=4323):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.application = application
    return server


def main():
    parser = argparse.ArgumentParser(description="Run ClosetRelay for one local operator; no authentication or public deployment")
    parser.add_argument("--port", type=int, default=4323)
    parser.add_argument("--database", type=Path, default=PACKAGE_ROOT / "backend/data/closetrelay.sqlite3")
    parser.add_argument("--ui-directory", type=Path, default=PACKAGE_ROOT / "ui")
    parser.add_argument("--empty", action="store_true", help="Start an empty new database instead of seeding fictional examples")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be 0–65535")
    application = Application(args.database, args.ui_directory, seed_demo=not args.empty)
    server = make_server(application, args.port)
    print(json.dumps({"url": f"http://127.0.0.1:{server.server_address[1]}", "mode": "local_operator", "authentication": False,
                      "provider_enabled": application.capability()["enabled"]}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
