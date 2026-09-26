"""Independent offline backend regressions. No live provider or real credentials."""

from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.model import Actor, Conflict, NotFound
from backend.server import APIError, Application
from provider import youcam
from test_youcam import SOURCE, REFERENCE, RESULT, png


class OfflineProvider:
    configured = True

    def __init__(self):
        self.calls = []
        self.during_create = None
        self.during_poll = None
        self.failure_code = None

    def create_preview(self, *, source, reference, binding, check_current):
        self.calls.append((source, reference, binding))
        if self.during_create:
            self.during_create()
        if check_current(binding) is not True:
            raise youcam.ProviderError("binding_not_current")
        instant = time.time()
        return youcam.ProviderTask("synthetic_review_" + str(len(self.calls)), binding,
                                   instant, instant + 600, instant,
                                   hashlib.sha256(source.data).hexdigest(), hashlib.sha256(reference.data).hexdigest())

    def poll_preview(self, task, *, check_current):
        if self.during_poll:
            self.during_poll()
        if check_current(task.binding) is not True:
            raise youcam.ProviderError("binding_not_current")
        if self.failure_code:
            return youcam.PreviewOutcome("failed", task, error_code=self.failure_code)
        return youcam.PreviewOutcome("succeeded", replace(task, poll_count=task.poll_count + 1),
                                    output=youcam.PreviewOutput(RESULT, "image/png", hashlib.sha256(RESULT).hexdigest(), 512, 384))


class BackendReviewTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "review.sqlite3"
        self.provider = OfflineProvider()
        self.app = Application(self.path, seed_demo=False, provider=self.provider, provider_module=youcam)
        self.app.closet.create_appointment("Invented reviewer appointment", "appointment")
        self.actor = Actor("client", "appointment")
        self.app.closet.create_item("A", "Invented jacket A", "Test rack 1", "Fixture")
        self.app.closet.create_item("B", "Invented jacket B", "Test rack 2", "Fixture")
        self.reference_a = self.app.closet.upload_media("garment", "image/png", REFERENCE)
        self.reference_b_bytes = png(colour=(7, 17, 27))
        self.reference_b = self.app.closet.upload_media("garment", "image/png", self.reference_b_bytes)
        self.app.closet.edit_item(Actor("stylist"), "A", photo_ref=self.reference_a["url"])
        self.app.closet.edit_item(Actor("stylist"), "B", photo_ref=self.reference_b["url"])
        self.source = self.app.closet.upload_media("source", "image/png", SOURCE, "appointment")
        self.app.closet.consent(self.actor, self.source["url"])
        self.app.closet.choose(self.actor, "A", 2)

    def tearDown(self):
        self.directory.cleanup()

    def test_choice_change_before_preview_snapshot_never_mislabels_reference(self):
        original = self.app.closet.request_preview
        def change_before_snapshot(*args, **kwargs):
            self.app.closet.choose(self.actor, "B", 2)
            return original(*args, **kwargs)
        self.app.closet.request_preview = change_before_snapshot
        try:
            self.app.create_preview("appointment", {})
        except (APIError, Conflict):
            return  # Rejecting a stale request before upload is also correct.
        self.assertEqual(len(self.provider.calls), 1)
        _, reference, binding = self.provider.calls[0]
        self.assertEqual(binding.item_id, "B")
        self.assertEqual(reference.data, self.reference_b_bytes,
                         "Binding B was paired with previously read image A")

    def test_source_change_before_preview_snapshot_never_mislabels_source(self):
        alternate_bytes = png(colour=(31, 71, 121))
        alternate = self.app.closet.upload_media("source", "image/png", alternate_bytes, "appointment")
        original = self.app.closet.request_preview
        def change_before_snapshot(*args, **kwargs):
            self.app.closet.consent(self.actor, alternate["url"])
            return original(*args, **kwargs)
        self.app.closet.request_preview = change_before_snapshot
        try:
            self.app.create_preview("appointment", {})
        except (APIError, Conflict):
            return
        source, _, binding = self.provider.calls[0]
        self.assertEqual(binding.source_photo_revision, 2)
        self.assertEqual(source.data, alternate_bytes,
                         "New consent/source revision was paired with old source bytes")

    def test_duplicate_pending_start_does_not_create_two_billable_tasks(self):
        first = self.app.create_preview("appointment", {})
        try:
            second = self.app.create_preview("appointment", {})
        except (APIError, Conflict):
            second = None
        self.assertEqual(len(self.provider.calls), 1, "Repeated identical start created a second provider task")
        if second is not None:
            self.assertEqual(second["id"], first["id"])

    def test_key_cleared_during_create_invalidates_old_provider_operation(self):
        self.provider.during_create = lambda: self.app.configure_provider({"api_key": None})
        try:
            result = self.app.create_preview("appointment", {})
        except APIError:
            result = None
        self.assertFalse(self.app.capability()["configured"])
        if result is not None:
            self.assertNotEqual(result["status"], "pending", "Old-key task remained pending after the key was cleared")

    def test_key_switched_during_poll_never_commits_old_inflight_result(self):
        local = self.app.create_preview("appointment", {})
        self.provider.during_poll = lambda: self.app.configure_provider({"api_key": "synthetic-review-new-key"})
        try:
            result = self.app.refresh_preview(local["id"])
        except APIError:
            result = self.app.preview_view(local["id"])
        self.assertFalse(result["displayable"], "Old-key in-flight image was committed after key replacement")
        self.assertIsNone(result["result_url"])

    def test_existing_success_becomes_unservable_after_choice_changes(self):
        local = self.app.create_preview("appointment", {})
        result = self.app.refresh_preview(local["id"])
        self.assertTrue(result["displayable"])
        media_id = result["result_url"].removeprefix("/media/")
        self.app.closet.choose(self.actor, "B", 2)
        self.assertFalse(self.app.preview_view(local["id"])["displayable"])
        with self.assertRaises(NotFound):
            self.app.closet.media(media_id, for_display=True)

    def test_revocation_removes_current_source_and_output_access(self):
        local = self.app.create_preview("appointment", {})
        result = self.app.refresh_preview(local["id"])
        media_id = result["result_url"].removeprefix("/media/")
        self.app.closet.consent(self.actor, None)
        for identifier in (self.source["id"], media_id):
            with self.assertRaises(NotFound):
                self.app.closet.media(identifier, for_display=True)
        self.assertFalse(self.app.preview_view(local["id"])["displayable"])

    def test_failed_provider_result_never_displays_synthetic_fixture(self):
        self.provider.failure_code = "error_pose"
        local = self.app.create_preview("appointment", {})
        result = self.app.refresh_preview(local["id"])
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["displayable"])
        self.assertIsNone(result["result_url"])
        self.assertEqual(result["provider"]["error"]["code"], "error_pose")

    def test_memory_key_not_echoed_or_persisted_in_database(self):
        key = "synthetic-review-memory-only-key-never-real"
        result = self.app.configure_provider({"api_key": key})
        self.assertTrue(result["provider"]["configured"])
        self.assertNotIn(key, json.dumps(result))
        self.assertNotIn(key, json.dumps(self.app.state()))
        self.app.configure_provider({"api_key": None})
        for path in Path(self.directory.name).iterdir():
            if path.is_file():
                self.assertNotIn(key.encode(), path.read_bytes())


if __name__ == "__main__":
    unittest.main(verbosity=2)
