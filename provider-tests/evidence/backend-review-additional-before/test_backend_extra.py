"""Additional offline checks, separate from the original frozen nine regressions."""

import json
import unittest
from unittest.mock import patch

import test_backend_review as original_review
from backend import server
from provider import youcam


class AdditionalBackendTests(unittest.TestCase):
    setUp = original_review.BackendReviewTests.setUp
    tearDown = original_review.BackendReviewTests.tearDown

    def test_engine_failure_preserves_real_task_status_and_provenance(self):
        self.provider.failure_code = "error_pose"
        local = self.app.create_preview("appointment", {})
        result = self.app.refresh_preview(local["id"])
        self.assertEqual(result["provider"]["status"], "failed")
        job = self.app.closet.provider_job(local["id"])
        self.assertEqual(job["provider_task_id"], "synthetic_review_1")
        self.assertEqual(json.loads(job["task_json"])["task_id"], "synthetic_review_1")

    def test_memory_only_restart_does_not_implicitly_load_environment_key(self):
        # Replace the environment object for this isolated constructor. The
        # user's environment or keys are never inspected or copied by this test.
        with patch.object(server.os, "environ", {"YOUCAM_API_KEY": "synthetic-ambient-token"}):
            restarted = server.Application(self.path, seed_demo=False, provider_module=youcam)
        self.assertFalse(restarted.capability()["configured"],
                         "Default startup restored an ambient key despite memory-only configuration")

    def test_two_application_instances_coalesce_the_same_pending_request(self):
        first = self.app.create_preview("appointment", {})
        another_provider = original_review.OfflineProvider()
        another_app = server.Application(self.path, seed_demo=False, provider=another_provider, provider_module=youcam)
        second = another_app.create_preview("appointment", {})
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(another_provider.calls, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
