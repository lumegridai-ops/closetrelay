"""Real HTTP/SQLite tests. Provider test doubles are explicitly offline fixtures."""
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
import hashlib
import http.client
import json
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.server import Application, make_server  # noqa: E402
from provider import youcam  # noqa: E402


def diagnostic_png():
    """A flat test image, not a person/garment photo or provider result."""
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    pixels = (b"\x00" + b"\x80\x80\x80" * 512) * 384
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 512, 384, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


PNG = diagnostic_png()


class DisabledProvider:
    configured = False


class OfflineAdapterDouble:
    """Never uses network. Exercises backend's adapter contract only."""
    configured = True

    def __init__(self, before_result=None, uncertain=False):
        self.before_result, self.uncertain = before_result, uncertain
        self.creates, self.polls = 0, 0

    def create_preview(self, *, source, reference, binding, check_current):
        self.creates += 1
        if not check_current(binding):
            raise youcam.ProviderError("stale_binding")
        if self.uncertain:
            raise youcam.ProviderError("network_error", stage="task_create", creation_uncertain=True)
        stamp = time.time()
        return youcam.ProviderTask(task_id="offline-test-task", binding=binding, created_at=stamp,
                                   deadline_at=stamp + 600, next_poll_at=stamp,
                                   source_sha256=hashlib.sha256(source.data).hexdigest(),
                                   reference_sha256=hashlib.sha256(reference.data).hexdigest())

    def poll_preview(self, task, *, check_current):
        self.polls += 1
        if not check_current(task.binding):
            raise youcam.ProviderError("stale_binding")
        if self.before_result:
            self.before_result()
        output = youcam.PreviewOutput(data=PNG, mime_type="image/png", sha256=hashlib.sha256(PNG).hexdigest(), width=512, height=384)
        return youcam.PreviewOutcome(status="succeeded", task=replace(task, poll_count=task.poll_count + 1), output=output)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "ledger.sqlite3"
        self.ui = Path(self.temp.name) / "ui"
        self.ui.mkdir()
        (self.ui / "index.html").write_text("<!doctype html><title>Fixture UI</title>")
        self.start()

    def start(self, provider=None):
        self.app = Application(self.database, self.ui, provider=provider or DisabledProvider(), provider_module=youcam)
        self.server = make_server(self.app, 0, background=False)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def tearDown(self):
        self.stop()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        request_headers = dict(headers or {})
        if raw is None and body is not None:
            raw = json.dumps(body).encode()
        if raw is not None:
            request_headers.setdefault("Content-Type", "application/json")
        connection.request(method, path, body=raw, headers=request_headers)
        response = connection.getresponse()
        data = response.read()
        status, mime = response.status, response.getheader("Content-Type", "")
        connection.close()
        return status, json.loads(data) if "application/json" in mime else data

    def ok(self, method, path, body=None, expected=200):
        status, result = self.request(method, path, body)
        self.assertEqual(status, expected, result)
        return result

    def state(self):
        return self.ok("GET", "/api/state")

    def choose(self, appointment="demo-appointment-a", item="DEMO-JKT-01"):
        state = self.state()
        ap = next(row for row in state["appointments"] if row["id"] == appointment)
        garment = next(row for row in state["items"] if row["id"] == item)
        return self.ok("POST", f"/api/appointments/{appointment}/choice", {
            "item_id": item, "expected_version": garment["version"], "expected_choice_revision": ap["choice_revision"]}, 201)

    def hold(self, approval):
        return self.ok("POST", f"/api/appointments/{approval['appointment_id']}/hold", {"approval_id": approval["id"]})

    def ready_photos(self):
        encoded = base64.b64encode(PNG).decode()
        source = self.ok("POST", "/api/uploads", {"purpose": "source", "appointment_id": "demo-appointment-a",
                         "mime_type": "image/png", "data_base64": encoded}, 201)
        garment = self.ok("POST", "/api/uploads", {"purpose": "garment", "mime_type": "image/png", "data_base64": encoded}, 201)
        self.ok("PATCH", "/api/items/DEMO-JKT-01", {"expected_version": 1, "photo_id": garment["id"]})
        self.choose()
        self.ok("POST", "/api/appointments/demo-appointment-a/consent", {"consent": True, "source_id": source["id"]})
        return source, garment

    def test_first_start_seeds_labeled_cards_without_photographs(self):
        state = self.state()
        self.assertEqual(len(state["items"]), 4)
        self.assertTrue(all(row["is_demo"] and row["photo_ref"] is None for row in state["items"]))
        self.assertEqual(state["scope"]["mode"], "local_operator")
        self.assertFalse(state["scope"]["authentication"])
        self.assertFalse(state["provider"]["enabled"])
        status, page = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Fixture UI", page)

    def test_private_database_permissions_without_changing_existing_parent(self):
        fresh_path = Path(self.temp.name) / "new-private" / "private.sqlite3"
        Application(fresh_path, seed_demo=False, provider=DisabledProvider(), provider_module=youcam)
        self.assertEqual(fresh_path.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(fresh_path.stat().st_mode & 0o777, 0o600)
        existing_parent = Path(self.temp.name) / "existing-parent"
        existing_parent.mkdir(mode=0o755)
        existing_path = existing_parent / "private.sqlite3"
        Application(existing_path, seed_demo=False, provider=DisabledProvider(), provider_module=youcam)
        self.assertEqual(existing_parent.stat().st_mode & 0o777, 0o755)
        self.assertEqual(existing_path.stat().st_mode & 0o777, 0o600)
        with closing(sqlite3.connect(existing_path)) as connection:
            connection.execute("INSERT INTO settings VALUES('test-sidecars','1')")
            connection.commit()
            for suffix in ("-wal", "-shm"):
                self.assertTrue(Path(str(existing_path) + suffix).exists())
                self.assertEqual(Path(str(existing_path) + suffix).stat().st_mode & 0o777, 0o600)

    def test_background_worker_starts_and_stops_without_a_key(self):
        self.app.start_background_polling()
        self.assertTrue(self.app.poll_thread.is_alive())
        self.assertEqual(self.app.poll_due_once(at=time.time()), {"polled": 0, "discarded": 0, "errors": 0})
        self.app.provider = OfflineAdapterDouble()
        self.app.stop_background_polling()
        self.assertFalse(self.app.poll_thread.is_alive())
        self.assertFalse(self.app.capability()["enabled"])
        status, result = self.request("POST", "/api/appointments/demo-appointment-a/previews", {})
        self.assertEqual(status, 503)
        self.assertEqual(result["error"]["code"], "server_stopping")

    def test_persisted_handoff_and_created_records_survive_server_restart(self):
        appointment = self.ok("POST", "/api/appointments", {"name": "Local test appointment"}, 201)
        item = self.ok("POST", "/api/items", {"id": "HTTP-ITEM", "label": "Test inventory record", "location": "Bin 1", "condition": "Test card"}, 201)
        self.assertFalse(item["is_demo"])
        approval = self.choose(appointment["id"], item["id"])
        hold = self.hold(approval)
        handoff = self.ok("POST", f"/api/holds/{hold['id']}/pack", {"item_id": item["id"], "request_key": "persist-me"})
        self.stop()
        self.start()
        state = self.state()
        self.assertEqual(len(state["items"]), 5)
        ap = next(row for row in state["appointments"] if row["id"] == appointment["id"])
        self.assertEqual(ap["handoffs"], [handoff])
        self.assertEqual(ap["approval"]["state"], "fulfilled")

    def test_two_http_holds_compete_atomically(self):
        approvals = [self.choose("demo-appointment-a"), self.choose("demo-appointment-b")]
        barrier = threading.Barrier(2)
        def compete(approval):
            barrier.wait(timeout=5)
            return self.request("POST", f"/api/appointments/{approval['appointment_id']}/hold", {"approval_id": approval["id"]})
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(compete, approvals))
        self.assertEqual(sorted(status for status, _ in results), [200, 409], results)
        state = self.state()
        self.assertEqual(sum(len(ap["active_holds"]) for ap in state["appointments"]), 1)
        self.assertEqual(next(row for row in state["items"] if row["id"] == "DEMO-JKT-01")["state"], "held")

    def test_exact_item_pack_and_concurrent_retries_yield_one_handoff(self):
        hold = self.hold(self.choose())
        path = f"/api/holds/{hold['id']}/pack"
        status, _ = self.request("POST", path, {"item_id": "DEMO-JKT-02", "request_key": "wrong-item"})
        self.assertEqual(status, 409)
        barrier = threading.Barrier(2)
        def pack(index):
            barrier.wait(timeout=5)
            return self.request("POST", path, {"item_id": "DEMO-JKT-01", "request_key": f"http-pack-{index}"})
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(pack, [1, 2]))
        self.assertEqual([status for status, _ in results], [200, 200], results)
        self.assertEqual(results[0][1]["id"], results[1][1]["id"])
        ap = next(row for row in self.state()["appointments"] if row["id"] == "demo-appointment-a")
        self.assertEqual(len(ap["handoffs"]), 1)
        self.assertEqual(ap["active_holds"], [])

    def test_stale_browser_choice_cannot_replace_current_held_choice(self):
        approval = self.choose()
        hold = self.hold(approval)
        status, result = self.request("POST", "/api/appointments/demo-appointment-a/choice", {
            "item_id": "DEMO-JKT-02", "expected_version": 1, "expected_choice_revision": 0})
        self.assertEqual(status, 409, result)
        ap = self.ok("GET", "/api/appointments/demo-appointment-a")
        self.assertEqual(ap["approval"]["id"], approval["id"])
        self.assertEqual(ap["active_holds"][0]["id"], hold["id"])

    def test_item_edit_invalidates_hold_and_rejects_stale_revision(self):
        approval = self.choose()
        hold = self.hold(approval)
        changed = self.ok("PATCH", "/api/items/DEMO-JKT-01", {"expected_version": 1, "condition": "New damage reported"})
        self.assertEqual(changed["version"], 2)
        status, _ = self.request("POST", f"/api/holds/{hold['id']}/pack", {"item_id": "DEMO-JKT-01", "request_key": "stale-pack"})
        self.assertEqual(status, 409)
        status, _ = self.request("PATCH", "/api/items/DEMO-JKT-01", {"expected_version": 1, "condition": "Stale edit"})
        self.assertEqual(status, 409)
        self.assertEqual(self.ok("GET", "/api/appointments/demo-appointment-a")["approval"]["state"], "needs_review")

    def test_condition_edit_does_not_silently_restore_unavailable_inventory(self):
        self.ok("PATCH", "/api/items/DEMO-JKT-01", {"expected_version": 1, "unavailable": True})
        changed = self.ok("PATCH", "/api/items/DEMO-JKT-01", {"expected_version": 2, "condition": "Still missing"})
        self.assertEqual(changed["state"], "unavailable")

    def test_release_retires_approval_until_fresh_choice(self):
        approval = self.choose()
        hold = self.hold(approval)
        self.ok("POST", f"/api/holds/{hold['id']}/release", {})
        status, _ = self.request("POST", "/api/appointments/demo-appointment-a/hold", {"approval_id": approval["id"]})
        self.assertEqual(status, 409)
        fresh = self.choose()
        self.assertNotEqual(fresh["id"], approval["id"])
        self.hold(fresh)

    def test_request_boundaries_reject_cross_origin_host_bad_types_and_fields(self):
        before = self.state()
        status, _ = self.request("POST", "/api/appointments", {"name": "Should not exist"}, {"Origin": "https://unrelated.example"})
        self.assertEqual(status, 403)
        status, _ = self.request("GET", "/api/state", headers={"Host": "unrelated.example"})
        self.assertEqual(status, 403)
        for raw in (b'{"name":"A","name":"B"}', b'{"name":NaN}', b'not-json'):
            status, _ = self.request("POST", "/api/appointments", raw=raw)
            self.assertEqual(status, 400)
        status, _ = self.request("POST", "/api/appointments", {"name": "No role spoofing", "actor": "admin"})
        self.assertEqual(status, 400)
        status, _ = self.request("POST", "/api/appointments/demo-appointment-a/choice", {
            "item_id": "DEMO-JKT-01", "expected_version": True, "expected_choice_revision": 0})
        self.assertEqual(status, 400)
        status, _ = self.request("GET", "/%2e%2e/ledger.sqlite3")
        self.assertEqual(status, 404)
        self.assertEqual(self.state()["appointments"], before["appointments"])

    def test_no_key_disables_preview_before_creating_task(self):
        self.ready_photos()
        status, result = self.request("POST", "/api/appointments/demo-appointment-a/previews", {})
        self.assertEqual(status, 503)
        self.assertEqual(result["error"]["code"], "preview_disabled")
        self.assertEqual(self.app.closet.diagnostic_rows("previews"), [])
        status, _ = self.request("POST", "/api/previews/anything/complete", {"result": "fabricated"})
        self.assertEqual(status, 404)

    def test_upload_media_persists_and_revocation_removes_local_rows(self):
        source, garment = self.ready_photos()
        self.assertEqual(self.request("GET", source["url"]), (200, PNG))
        self.stop()
        self.start()
        self.assertEqual(self.request("GET", source["url"]), (200, PNG))
        result = self.ok("POST", "/api/appointments/demo-appointment-a/consent", {"consent": False})
        self.assertIn("no upstream deletion", result["provider_deletion"])
        self.assertEqual(self.request("GET", source["url"])[0], 404)
        self.assertEqual(self.request("GET", garment["url"]), (200, PNG))

    def test_key_entry_is_memory_only_and_never_echoed(self):
        key = "OFFLINE_TEST_KEY_DO_NOT_USE"
        result = self.ok("POST", "/api/provider/configure", {"api_key": key})
        self.assertTrue(result["provider"]["configured"])
        self.assertEqual(result["storage"], "process_memory_only")
        self.assertNotIn(key, json.dumps(result) + json.dumps(self.state()))
        with closing(sqlite3.connect(self.database)) as connection:
            dump = "\n".join(connection.iterdump())
        self.assertNotIn(key, dump)
        with patch.dict("os.environ", {}, clear=True):
            fresh = Application(self.database, self.ui)
            self.assertFalse(fresh.capability()["configured"])
        self.assertFalse(self.ok("POST", "/api/provider/configure", {"api_key": None})["provider"]["configured"])

    def test_offline_adapter_contract_persists_task_then_hides_old_output(self):
        self.app.provider = OfflineAdapterDouble()
        self.ready_photos()
        created = self.ok("POST", "/api/appointments/demo-appointment-a/previews", {}, 201)
        self.assertEqual(created["provider"]["task_id"], "offline-test-task")
        self.stop()
        self.start(OfflineAdapterDouble())
        finished = self.ok("POST", f"/api/previews/{created['id']}/refresh", {})
        self.assertTrue(finished["displayable"])
        self.assertEqual(self.request("GET", finished["result_url"]), (200, PNG))
        self.choose(item="DEMO-JKT-02")
        stale = self.ok("GET", f"/api/previews/{created['id']}")
        self.assertFalse(stale["displayable"])
        self.assertIsNone(stale["result_url"])
        self.assertEqual(self.request("GET", finished["result_url"])[0], 404)

    def test_offline_late_output_after_withdrawal_is_not_stored(self):
        self.ready_photos()
        def revoke_during_poll():
            self.ok("POST", "/api/appointments/demo-appointment-a/consent", {"consent": False})
        self.app.provider = OfflineAdapterDouble(before_result=revoke_during_poll)
        created = self.ok("POST", "/api/appointments/demo-appointment-a/previews", {}, 201)
        finished = self.ok("POST", f"/api/previews/{created['id']}/refresh", {})
        self.assertFalse(finished["displayable"])
        self.assertEqual(finished["status"], "revoked")
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM media WHERE purpose IN ('source','preview')").fetchone()[0], 0)
        self.assertIsNone(self.app.closet.provider_job(created["id"])["task_json"])

    def test_uncertain_create_is_recorded_without_automatic_retry(self):
        self.ready_photos()
        self.app.provider = OfflineAdapterDouble(uncertain=True)
        status, result = self.request("POST", "/api/appointments/demo-appointment-a/previews", {})
        self.assertEqual(status, 502)
        self.assertTrue(result["error"]["details"]["creation_uncertain"])
        self.assertEqual(self.app.provider.creates, 1)
        preview = self.ok("GET", f"/api/previews/{result['error']['details']['preview_id']}")
        self.assertEqual(preview["status"], "failed")
        self.assertIsNone(preview["provider"]["task_id"])
        self.assertFalse(preview["displayable"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
