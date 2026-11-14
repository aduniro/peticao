import copy
from datetime import timedelta
import unittest
from budget_policy import Budget, admit, instant, lifecycle, money


class FinancialPolicyTests(unittest.TestCase):
    def setUp(self):
        self.now = instant("2026-11-14T11:00:00Z")
        self.b = dict(verified=True, initial="200", remaining="200", committed="0",
                      fixed_remaining="20", hourly="0.688", expiry="2026-12-14T00:13:41Z",
                      verified_at="2026-11-14T10:55:00Z", quantum_seconds=1)
        self.s = dict(queue_primary_verified=True, provider_state="running", queued=0,
                      running=0, finalizing=0, exports_pending=0, budget=self.b,
                      billing_policy="deallocate_saves_compute", idle_since="2026-11-14T10:49:59Z")

    def test_covered_job_and_twenty_percent_reserve(self):
        b = Budget.from_dict(self.b)
        self.assertEqual(str(b.usable()), "140.00")
        d = admit(b, self.now, 3600)
        self.assertTrue(d["allowed"])
        self.assertEqual(money(d["reserve_usd"]), money("1.376"))

    def test_hourly_provider_rounds_up(self):
        self.b.update(hourly="0.380952", quantum_seconds=3600)
        self.assertEqual(Budget.from_dict(self.b).cost(3601), money("0.761904"))

    def test_other_reserved_jobs_and_storage_reduce_budget(self):
        self.b.update(committed="139.5")
        self.assertFalse(admit(Budget.from_dict(self.b), self.now, 3600)["allowed"])

    def test_missing_timeout_and_unverified_credit(self):
        self.assertFalse(admit(Budget.from_dict(self.b), self.now, None)["allowed"])
        self.b["verified"] = False
        with self.assertRaises(ValueError): Budget.from_dict(self.b)

    def test_expiry_requires_cleanup_time(self):
        self.b["expiry"] = "2026-11-14T13:00:00Z"
        self.assertEqual(admit(Budget.from_dict(self.b), self.now, 3600)["reason"], "credit_expires_before_cleanup")

    def test_stale_and_future_observations_fail_closed(self):
        b = Budget.from_dict(self.b)
        self.assertFalse(admit(b, self.now + timedelta(hours=2), 60)["allowed"])
        self.assertFalse(admit(b, self.now - timedelta(hours=2), 60)["allowed"])

    def test_invalid_money_rejected(self):
        for v in ["NaN", "Infinity", "-1", None]:
            with self.subTest(v=v), self.assertRaises(ValueError): money(v)

    def test_azure_idle_deallocates_but_civo_does_not(self):
        self.assertEqual(lifecycle(self.s, self.now)["action"], "deallocate")
        self.s["billing_policy"] = "allocated_until_destroyed"
        self.assertEqual(lifecycle(self.s, self.now)["action"], "keep")

    def test_export_or_finalization_blocks_idle_shutdown(self):
        for key in ["queued", "running", "finalizing", "exports_pending"]:
            s = copy.deepcopy(self.s); s[key] = 1
            self.assertEqual(lifecycle(s, self.now)["action"], "keep")

    def test_provider_uncertainty_never_duplicates_start(self):
        self.s.update(provider_state="uncertain", queued=2)
        self.assertEqual(lifecycle(self.s, self.now)["action"], "reconcile")

    def test_financial_cutoff_drains_exports_then_retires(self):
        self.b["remaining"] = "40"
        self.s["running"] = 1
        self.assertEqual(lifecycle(self.s, self.now)["action"], "drain")
        self.s["running"] = 0
        self.assertEqual(lifecycle(self.s, self.now)["action"], "export")
        self.s["backup_verified"] = True
        self.assertEqual(lifecycle(self.s, self.now)["action"], "retire")

    def test_unknown_authority_missing_counts_and_future_idle_hold(self):
        for update in [dict(queue_primary_verified=False), dict(queued=None), dict(idle_since="2026-11-15T00:00:00Z")]:
            s = copy.deepcopy(self.s); s.update(update)
            self.assertEqual(lifecycle(s, self.now)["action"], "hold")

    def test_real_work_wakes_deallocated_worker(self):
        self.s.update(provider_state="deallocated", queued=1)
        self.assertEqual(lifecycle(self.s, self.now)["action"], "start")

    def test_permanent_central_never_retires_with_trial_workers(self):
        self.b["remaining"] = "0"
        self.s["billing_policy"] = "permanent_existing"
        self.assertEqual(lifecycle(self.s, self.now)["action"], "keep")


if __name__ == "__main__": unittest.main()
