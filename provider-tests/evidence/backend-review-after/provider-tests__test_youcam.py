"""Offline tests only. All images, API keys and provider responses are synthetic.

No inference requests, customer images, consented participants or real task IDs.
"""

from dataclasses import replace
import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from provider import (  # noqa: E402
    ImageInput, MissingConfiguration, PreviewBinding, ProviderError, ProviderTask, YouCamClothesV4,
)
from provider.transport import HttpResponse, TransportError
from provider.youcam import API_ORIGIN, FILE_PATH, TASK_PATH


def png(width=512, height=384, colour=(19, 93, 151)):
    def chunk(name, body):
        return struct.pack(">I", len(body)) + name + body + struct.pack(">I", zlib.crc32(name + body) & 0xFFFFFFFF)
    rows = (b"\x00" + bytes(colour) * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


SOURCE = png()
REFERENCE = png(colour=(89, 39, 109))
RESULT = png(colour=(213, 205, 153))
BINDING = PreviewBinding("fixture-appointment", "fixture-client", 1, "fixture-jacket", 1, 1, 1, 1)
KEY = "synthetic-test-token-never-a-live-key"
STORAGE = "https://yce-us.s3-accelerate.amazonaws.com"


def response(data, status=200, headers=None):
    return HttpResponse(status, headers or {"Content-Type": "application/json"},
                        json.dumps(data).encode())


def api(data):
    return response({"status": 200, "data": data})


def allocation(role, content, **changes):
    entry = {"file_name": role + ".png", "content_type": "image/png", "file_id": "test/" + role + "+id=",
             "requests": [{"method": "PUT", "url": STORAGE + "/synthetic/" + role + "?signature=not-real",
                           "headers": {"Content-Type": "image/png", "Content-Length": len(content)}}]}
    entry.update(changes)
    return api({"files": [entry]})


def creation_steps():
    return [allocation("source", SOURCE), HttpResponse(200, {}, b""),
            allocation("reference", REFERENCE), HttpResponse(204, {}, b""), api({"task_id": "synthetic_task_01"})]


def success():
    return api({"task_status": "success", "error": None,
                "results": {"url": STORAGE + "/synthetic/result.png?signature=not-real"}})


class Clock:
    def __init__(self):
        self.value = 1_800_000_000.0

    def __call__(self):
        return self.value

    def advance(self, seconds=10):
        self.value += seconds


class ScriptedTransport:
    def __init__(self, steps):
        self.steps = list(steps)
        self.calls = []

    def request(self, **request):
        self.calls.append(request)
        if not self.steps:
            raise AssertionError("Unexpected request: offline script has no response")
        step = self.steps.pop(0)
        if callable(step):
            step = step(request)
        if isinstance(step, Exception):
            raise step
        return step


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.current = True
        self.guard = lambda binding: self.current and binding == BINDING

    def client(self, steps):
        self.transport = ScriptedTransport(steps)
        return YouCamClothesV4(KEY, transport=self.transport, clock=self.clock)

    def create(self, client):
        return client.create_preview(source=ImageInput(SOURCE, "image/png"),
                                     reference=ImageInput(REFERENCE, "image/png"),
                                     binding=BINDING, check_current=self.guard)

    def ready(self, steps):
        client = self.client(creation_steps() + steps)
        task = self.create(client)
        self.clock.advance()
        return client, task

    def test_documented_upload_create_poll_download_and_no_credential_leak(self):
        client, task = self.ready([
            api({"task_status": "running", "error": None, "results": None}),
            success(), HttpResponse(200, {"Content-Type": "image/png"}, RESULT),
        ])
        pending = client.poll_preview(task, check_current=self.guard)
        self.assertEqual(pending.status, "pending")
        self.assertIsNone(pending.output)
        self.clock.advance()
        result = client.poll_preview(pending.task, check_current=self.guard)
        self.assertEqual(result.status, "succeeded")
        self.assertEqual(result.output.data, RESULT)
        self.assertEqual(result.output.sha256, hashlib.sha256(RESULT).hexdigest())
        self.assertEqual((result.output.width, result.output.height), (512, 384))
        self.assertEqual(result.task.binding, BINDING)
        self.assertEqual(result.task.source_sha256, hashlib.sha256(SOURCE).hexdigest())
        self.assertEqual(result.task.reference_sha256, hashlib.sha256(REFERENCE).hexdigest())
        self.assertEqual(result.task.poll_count, 2)
        calls = self.transport.calls
        self.assertEqual([c["method"] for c in calls], ["POST", "PUT", "POST", "PUT", "POST", "GET", "GET", "GET"])
        self.assertEqual(calls[0]["url"], API_ORIGIN + FILE_PATH)
        self.assertEqual(calls[4]["url"], API_ORIGIN + TASK_PATH)
        self.assertEqual(json.loads(calls[4]["body"]), {
            "src_file_id": "test/source+id=", "ref_file_id": "test/reference+id=",
            "garment_category": "outer", "change_shoes": False, "filter_multi_person": "strict",
        })
        self.assertEqual(calls[1]["body"], SOURCE)
        self.assertEqual(calls[3]["body"], REFERENCE)
        self.assertEqual(calls[1]["headers"]["content-length"], str(len(SOURCE)))
        for call in calls:
            if call["url"].startswith(API_ORIGIN):
                self.assertEqual(call["headers"]["Authorization"], "Bearer " + KEY)
            else:
                self.assertNotIn("authorization", {k.lower() for k in call["headers"]})
        self.assertNotIn(KEY, repr(task))
        self.assertNotIn("signature", repr(result))

    def test_missing_key_is_explicit_without_network(self):
        transport = ScriptedTransport([])
        client = YouCamClothesV4(transport=transport)
        self.assertFalse(client.configured)
        with self.assertRaises(MissingConfiguration) as caught:
            self.create(client)
        self.assertEqual(caught.exception.code, "provider_unconfigured")
        self.assertEqual(transport.calls, [])

    def test_binding_round_trip_and_strict_revision_types(self):
        self.assertEqual(PreviewBinding.from_dict(BINDING.as_dict()), BINDING)
        for change in ({"choice_revision": True}, {"consent_revision": 0}, {"item_id": "../secret"},
                       {"source_photo_revision": "1"}, {"unexpected": 1}):
            with self.subTest(change=change), self.assertRaises(ProviderError):
                PreviewBinding.from_dict({**BINDING.as_dict(), **change})

    def test_task_round_trip_and_untrusted_task_record_rejected(self):
        task = self.create(self.client(creation_steps()))
        self.assertEqual(ProviderTask.from_dict(task.as_dict()), task)
        changes = [{"task_id": "../../file"}, {"deadline_at": task.created_at + 86400},
                   {"poll_count": True}, {"created_at": float("nan")},
                   {"reference_sha256": "unknown"}, {"provider": "fake"}, {"extra": "x"}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ProviderError):
                ProviderTask.from_dict({**task.as_dict(), **change})

    def test_inputs_are_checked_before_network(self):
        cases = [(b"", "image/png"), (b"<svg/>", "image/png"), (SOURCE, "image/jpeg"),
                 (SOURCE, "text/html"), (png(511, 384), "image/png"), (png(512, 383), "image/png"),
                 (png(4097, 384), "image/png"), (SOURCE[:-2], "image/png"),
                 (SOURCE + b"trailing", "image/png"), (bytearray(SOURCE), "image/png")]
        for data, mime in cases:
            with self.subTest(mime=mime, size=len(data)), self.assertRaises(ProviderError):
                ImageInput(data, mime)
        self.assertEqual(ImageInput(png(384, 512), "image/png").mime_type, "image/png")

    def test_declined_consent_blocks_first_allocation(self):
        self.current = False
        client = self.client([])
        with self.assertRaises(ProviderError) as caught:
            self.create(client)
        self.assertEqual(caught.exception.code, "binding_not_current")
        self.assertEqual(self.transport.calls, [])

    def test_checker_requires_literal_true_and_fails_closed_on_error(self):
        client = self.client([])
        for guard in (None, lambda b: 1, lambda b: "yes", lambda b: 1/0):
            with self.subTest(guard=guard), self.assertRaises(ProviderError):
                client.create_preview(source=ImageInput(SOURCE, "image/png"), reference=ImageInput(REFERENCE, "image/png"),
                                      binding=BINDING, check_current=guard)
        self.assertEqual(self.transport.calls, [])

    def test_revocation_after_allocation_prevents_first_photo_upload(self):
        def withdraw(request):
            self.current = False
            return allocation("source", SOURCE)
        client = self.client([withdraw])
        with self.assertRaises(ProviderError):
            self.create(client)
        self.assertEqual(len(self.transport.calls), 1)

    def test_revocation_during_upload_prevents_reference_and_task_creation(self):
        def withdraw(request):
            self.current = False
            return HttpResponse(200, {}, b"")
        client = self.client([allocation("source", SOURCE), withdraw])
        with self.assertRaises(ProviderError):
            self.create(client)
        self.assertEqual(len(self.transport.calls), 2)

    def test_revocation_during_task_creation_retains_task_id_for_diagnostics(self):
        def withdraw(request):
            self.current = False
            return api({"task_id": "synthetic_created_before_revoke"})
        client = self.client(creation_steps()[:4] + [withdraw])
        with self.assertRaises(ProviderError) as caught:
            self.create(client)
        self.assertEqual(caught.exception.code, "binding_not_current")
        self.assertEqual(caught.exception.task_id, "synthetic_created_before_revoke")

    def test_revocation_during_status_check_prevents_output_download(self):
        def withdraw(request):
            self.current = False
            return success()
        client, task = self.ready([withdraw])
        with self.assertRaises(ProviderError):
            client.poll_preview(task, check_current=self.guard)
        self.assertEqual(len(self.transport.calls), 6)

    def test_revocation_during_download_prevents_returned_image(self):
        def withdraw(request):
            self.current = False
            return HttpResponse(200, {"Content-Type": "image/png"}, RESULT)
        client, task = self.ready([success(), withdraw])
        with self.assertRaises(ProviderError) as caught:
            client.poll_preview(task, check_current=self.guard)
        self.assertEqual(caught.exception.code, "binding_not_current")

    def test_every_bound_dependency_can_invalidate_before_poll(self):
        for field in ("choice_revision", "item_revision", "item_photo_revision", "source_photo_revision", "consent_revision"):
            client, task = self.ready([])
            current_binding = replace(BINDING, **{field: 2})
            with self.subTest(field=field), self.assertRaises(ProviderError):
                client.poll_preview(task, check_current=lambda b: b == current_binding)
            self.assertEqual(len(self.transport.calls), 5)

    def test_unsafe_storage_destinations_never_receive_images(self):
        urls = ["http://" + STORAGE[8:] + "/x", "https://127.0.0.1/x", "https://localhost/x",
                "https://yce-us.s3-accelerate.amazonaws.com.evil.test/x", STORAGE + ":444/x",
                "https://secret@" + STORAGE[8:] + "/x", STORAGE + "/x#fragment", STORAGE + "/x\n"]
        for url in urls:
            request = {"method": "PUT", "url": url,
                       "headers": {"Content-Type": "image/png", "Content-Length": len(SOURCE)}}
            client = self.client([allocation("source", SOURCE, requests=[request])])
            with self.subTest(url=url), self.assertRaises(ProviderError):
                self.create(client)
            self.assertEqual(len(self.transport.calls), 1)

    def test_upload_instruction_cannot_change_file_or_forward_credentials(self):
        base = {"Content-Type": "image/png", "Content-Length": str(len(SOURCE))}
        modifications = [{"headers": {**base, "Authorization": "anything"}},
                         {"headers": {**base, "Host": "evil.test"}},
                         {"headers": {**base, "Content-Length": "1"}},
                         {"headers": {**base, "Content-Type": "text/html"}},
                         {"headers": {**base, "content-type": "image/png"}},
                         {"headers": {**base, "x-amz-meta-a": "x\r\nCookie:yes"}},
                         {"method": "POST"}]
        for modification in modifications:
            request = {"method": "PUT", "url": STORAGE + "/synthetic/x", "headers": base, **modification}
            client = self.client([allocation("source", SOURCE, requests=[request])])
            with self.subTest(modification=modification), self.assertRaises(ProviderError):
                self.create(client)
            self.assertEqual(len(self.transport.calls), 1)

    def test_file_allocation_must_match_requested_content(self):
        for change in ({"file_name": "reference.png"}, {"content_type": "image/jpeg"},
                       {"file_id": "unexpected\nvalue"}, {"requests": []}):
            client = self.client([allocation("source", SOURCE, **change)])
            with self.subTest(change=change), self.assertRaises(ProviderError):
                self.create(client)
            self.assertEqual(len(self.transport.calls), 1)

    def test_upload_redirect_does_not_start_task(self):
        client = self.client([allocation("source", SOURCE), HttpResponse(307, {"Location": "https://evil.test/"}, b"")])
        with self.assertRaises(ProviderError) as caught:
            self.create(client)
        self.assertEqual(caught.exception.code, "provider_upload_failed")
        self.assertEqual(len(self.transport.calls), 2)

    def test_create_timeout_is_uncertain_and_never_retried(self):
        client = self.client(creation_steps()[:4] + [TransportError("do-not-include-url-or-token")])
        with self.assertRaises(ProviderError) as caught:
            self.create(client)
        self.assertTrue(caught.exception.creation_uncertain)
        self.assertFalse(caught.exception.retryable)
        self.assertEqual(len(self.transport.calls), 5)
        self.assertNotIn("do-not-include", str(caught.exception))

    def test_malformed_create_success_is_also_uncertain(self):
        bad = [api({}), api({"task_id": "../x"}), HttpResponse(200, {"Content-Type": "application/json"}, b"not-json"),
               HttpResponse(200, {"Content-Type": "application/json"}, b'{"status":200,"status":400,"data":{}}')]
        for result in bad:
            client = self.client(creation_steps()[:4] + [result])
            with self.subTest(body=result.body), self.assertRaises(ProviderError) as caught:
                self.create(client)
            self.assertTrue(caught.exception.creation_uncertain)
            self.assertEqual(len(self.transport.calls), 5)

    def test_credit_auth_and_rate_failures_do_not_retry_create(self):
        cases = [(400, "CreditInsufficiency", "CreditInsufficiency"),
                 (401, "InvalidAccessToken", "provider_authentication_failed"),
                 (429, None, "provider_rate_limited"), (503, {}, "provider_http_error")]
        for status, code, expected in cases:
            client = self.client(creation_steps()[:4] + [response({"status": status, "error_code": code, "error": KEY}, status)])
            with self.subTest(status=status), self.assertRaises(ProviderError) as caught:
                self.create(client)
            self.assertEqual(caught.exception.code, expected)
            self.assertFalse(caught.exception.retryable)
            self.assertEqual(caught.exception.creation_uncertain, status >= 500)
            self.assertNotIn(KEY, json.dumps(caught.exception.as_dict()))
            self.assertEqual(len(self.transport.calls), 5)

    def test_polling_respects_persisted_schedule(self):
        client = self.client(creation_steps())
        task = self.create(client)
        result = client.poll_preview(task, check_current=self.guard)
        self.assertEqual(result.status, "pending")
        self.assertEqual(result.retry_after_seconds, 10)
        self.assertEqual(result.task.poll_count, 0)
        self.assertEqual(len(self.transport.calls), 5)

    def test_deadline_and_attempt_limit_have_no_fallback(self):
        client, task = self.ready([])
        for expired in (replace(task, poll_count=60), task):
            if expired is task:
                self.clock.value = task.deadline_at
            result = client.poll_preview(expired, check_current=self.guard)
            self.assertEqual(result.status, "failed")
            self.assertEqual(result.error_code, "preview_deadline_exceeded")
            self.assertIsNone(result.output)
        self.assertEqual(len(self.transport.calls), 5)

    def test_running_does_not_accept_an_early_image(self):
        client, task = self.ready([api({"task_status": "running", "results": {"url": STORAGE + "/x"}})])
        result = client.poll_preview(task, check_current=self.guard)
        self.assertEqual(result.status, "failed")
        self.assertIsNone(result.output)
        self.assertEqual(len(self.transport.calls), 6)

    def test_terminal_error_keeps_only_known_error_code(self):
        for engine_code, expected in (("error_pose", "error_pose"), ("unknown-model-detail-" + KEY, "provider_engine_error")):
            client, task = self.ready([api({"task_status": "error", "error": engine_code, "error_message": KEY, "results": None})])
            result = client.poll_preview(task, check_current=self.guard)
            self.assertEqual(result.status, "failed")
            self.assertEqual(result.error_code, expected)
            self.assertNotIn(KEY, repr(result))

    def test_unknown_and_contradictory_states_fail_closed(self):
        bad = [{"task_status": "queued"}, {"task_status": "success", "error": "error_pose", "results": {"url": STORAGE + "/x"}},
               {"task_status": "success", "error": None, "results": None},
               {"task_status": "error", "error": {"why": "x"}},
               {"task_status": "success", "error": None, "results": {"url": "https://localhost/x"}}]
        for data in bad:
            client, task = self.ready([api(data)])
            result = client.poll_preview(task, check_current=self.guard)
            with self.subTest(data=data):
                self.assertEqual(result.status, "failed")
                self.assertIsNone(result.output)
                self.assertEqual(len(self.transport.calls), 6)

    def test_retryable_get_error_has_bounded_backoff_and_no_new_task(self):
        client, task = self.ready([response({"status": 429}, 429, {"Retry-After": "40"})])
        result = client.poll_preview(task, check_current=self.guard)
        self.assertEqual(result.status, "pending")
        self.assertEqual(result.error_code, "provider_rate_limited")
        self.assertEqual(result.task.next_poll_at, self.clock.value + 40)
        self.assertEqual(result.task.poll_count, 1)
        self.assertEqual(len(self.transport.calls), 6)
        early = client.poll_preview(result.task, check_current=self.guard)
        self.assertEqual(early.status, "pending")
        self.assertEqual(len(self.transport.calls), 6)

    def test_get_timeout_remains_pending_then_deadline_fails(self):
        client, task = self.ready([TransportError("synthetic timeout")])
        result = client.poll_preview(task, check_current=self.guard)
        self.assertEqual(result.status, "pending")
        self.clock.value = task.deadline_at
        result = client.poll_preview(result.task, check_current=self.guard)
        self.assertEqual(result.status, "failed")
        self.assertIsNone(result.output)

    def test_output_requires_matching_image_type_and_container(self):
        bad = [HttpResponse(200, {"Content-Type": "text/html"}, b"<html>not an image</html>"),
               HttpResponse(200, {"Content-Type": "image/png"}, b"<svg/>"),
               HttpResponse(200, {"Content-Type": "image/jpeg"}, RESULT),
               HttpResponse(302, {"Location": "https://evil.test/x"}, b"")]
        for download in bad:
            client, task = self.ready([success(), download])
            result = client.poll_preview(task, check_current=self.guard)
            self.assertEqual(result.status, "failed")
            self.assertIsNone(result.output)

    def test_success_arriving_after_deadline_never_returns_bytes(self):
        def late(request):
            self.clock.advance(600)
            return HttpResponse(200, {"Content-Type": "image/png"}, RESULT)
        client, task = self.ready([success(), late])
        result = client.poll_preview(task, check_current=self.guard)
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error_code, "preview_deadline_exceeded")
        self.assertIsNone(result.output)

    def test_create_returning_late_still_reports_known_task(self):
        def late(request):
            self.clock.advance(600)
            return api({"task_id": "synthetic_late_task"})
        client = self.client(creation_steps()[:4] + [late])
        with self.assertRaises(ProviderError) as caught:
            self.create(client)
        self.assertEqual(caught.exception.code, "preview_deadline_exceeded")
        self.assertEqual(caught.exception.task_id, "synthetic_late_task")

    def test_json_size_and_duplicate_keys_rejected(self):
        bad = [HttpResponse(200, {"Content-Type": "application/json"}, b"x" * 65537),
               HttpResponse(200, {"Content-Type": "application/json"}, b'{"status":200,"data":{"task_status":"success","task_status":"running"}}'),
               HttpResponse(200, {"Content-Type": "application/json"}, b'{"status":NaN,"data":{}}')]
        for reply in bad:
            client, task = self.ready([reply])
            result = client.poll_preview(task, check_current=self.guard)
            self.assertEqual(result.status, "failed")
            self.assertIsNone(result.output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
