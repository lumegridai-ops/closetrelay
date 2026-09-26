"""Independent deterministic scheduler checks. All provider calls are offline."""

from dataclasses import replace
import json
import unittest

import test_backend_review as original_review
from backend.server import APIError
from provider import youcam


class SchedulerReviewTests(unittest.TestCase):
    setUp = original_review.BackendReviewTests.setUp
    tearDown = original_review.BackendReviewTests.tearDown

    def capture_polls(self):
        calls = []
        original = self.provider.poll_preview
        def track(task, **kwargs):
            calls.append(task.task_id)
            return original(task, **kwargs)
        self.provider.poll_preview = track
        return calls

    def make_scheduled(self):
        local = self.app.create_preview("appointment", {})
        remote = youcam.ProviderTask.from_dict(json.loads(self.app.closet.provider_job(local["id"])["task_json"]))
        scheduled = replace(remote, next_poll_at=remote.created_at + 20)
        self.app.closet.record_provider_job(local["id"], task=scheduled.as_dict(), status="pending")
        return local, scheduled

    def test_tick_obeys_persisted_next_poll_and_never_starts_another_job(self):
        polls = self.capture_polls()
        local, remote = self.make_scheduled()
        self.assertEqual(self.app.poll_due_once(at=remote.next_poll_at - 0.01), {"polled": 0, "discarded": 0, "errors": 0})
        self.assertEqual(polls, [])
        self.assertEqual(self.app.poll_due_once(at=remote.next_poll_at), {"polled": 1, "discarded": 0, "errors": 0})
        self.assertEqual(polls, [remote.task_id])
        self.assertEqual(len(self.provider.calls), 1)
        self.assertTrue(self.app.preview_view(local["id"])["displayable"])
        self.assertEqual(self.app.poll_due_once(at=remote.deadline_at), {"polled": 0, "discarded": 0, "errors": 0})
        self.assertEqual(len(self.provider.calls), 1)

    def test_no_key_tick_never_contacts_the_old_provider(self):
        polls = self.capture_polls()
        local, remote = self.make_scheduled()
        self.app.configure_provider({"api_key": None})
        self.assertEqual(self.app.poll_due_once(at=remote.next_poll_at), {"polled": 0, "discarded": 0, "errors": 0})
        self.assertEqual(polls, [])
        self.assertFalse(self.app.preview_view(local["id"])["displayable"])

    def test_stopped_worker_cannot_start_new_provider_work(self):
        self.app.poll_stop.set()
        self.assertFalse(self.app.capability()["enabled"])
        with self.assertRaises(APIError):
            self.app.create_preview("appointment", {})
        self.assertEqual(self.provider.calls, [])
        self.assertEqual(self.app.poll_due_once(at=1_900_000_000), {"polled": 0, "discarded": 0, "errors": 0})

    def test_stale_choice_is_discarded_before_status_network(self):
        polls = self.capture_polls()
        local, remote = self.make_scheduled()
        self.app.closet.choose(self.actor, "B", 2)
        self.assertEqual(self.app.poll_due_once(at=remote.next_poll_at), {"polled": 0, "discarded": 1, "errors": 0})
        self.assertEqual(polls, [])
        current = self.app.preview_view(local["id"])
        self.assertEqual(current["status"], "discarded")
        self.assertFalse(current["displayable"])

    def test_pending_result_schedule_is_persisted_between_ticks(self):
        polls = []
        def pending(task, **kwargs):
            self.assertTrue(kwargs["check_current"](task.binding))
            polls.append(task.task_id)
            return youcam.PreviewOutcome("pending", replace(task, poll_count=task.poll_count + 1,
                                                             next_poll_at=task.next_poll_at + 10),
                                         retry_after_seconds=10)
        self.provider.poll_preview = pending
        local, remote = self.make_scheduled()
        self.app.poll_due_once(at=remote.next_poll_at)
        stored = json.loads(self.app.closet.provider_job(local["id"])["task_json"])
        self.assertEqual(stored["poll_count"], 1)
        self.assertEqual(stored["next_poll_at"], remote.next_poll_at + 10)
        self.app.poll_due_once(at=remote.next_poll_at + 9)
        self.assertEqual(len(polls), 1)
        self.app.poll_due_once(at=remote.next_poll_at + 10)
        self.assertEqual(len(polls), 2)
        self.assertEqual(len(self.provider.calls), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
