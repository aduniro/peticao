import unittest
from datetime import datetime, timezone, timedelta
from financial_guard import deadlines, admit


class FinancialCoverage(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 11, 14, 18, tzinfo=timezone.utc)
        self.grant = dict(initial_usd='250', baseline_spent_usd='0', currency='USD',
                          provenance='authenticated_owner', expires_at='2026-12-31T00:00:00Z',
                          account_scope_id='test-account-a', grant_evidence_id='owner-evidence-a')
        self.quote = dict(hourly_usd='0.410752', currency='USD', complete_mandatory_costs=True)
        self.schedule = deadlines(self.grant, self.quote, self.start.isoformat())
        self.charges = dict(account_total_usd='0', grant_initial_usd='250',
                            observed_at=self.start.isoformat(), complete_account_scope=True,
                            currency='USD', account_scope_id='test-account-a', grant_evidence_id='owner-evidence-a')

    def test_large_quoted_worker_preserves_reserve_and_markup(self):
        from decimal import Decimal
        end = datetime.fromisoformat(self.schedule['delete_by'])
        cost = Decimal(str((end-self.start).total_seconds())) / 3600 * Decimal('0.410752') * Decimal('1.20')
        self.assertLessEqual(cost, Decimal('200'))
        self.assertEqual(self.schedule['reserved_usd'], '50.00')

    def test_expiry_caps_allocation_even_with_large_credit(self):
        self.grant['expires_at'] = '2026-11-20T00:00:00Z'
        s = deadlines(self.grant, self.quote, self.start.isoformat())
        self.assertEqual(s['delete_by'], '2026-11-19T00:00:00+00:00')

    def test_incomplete_price_prevents_provisioning(self):
        self.quote['complete_mandatory_costs'] = False
        with self.assertRaises(ValueError): deadlines(self.grant, self.quote, self.start.isoformat())

    def test_healthy_eight_hour_job_is_covered(self):
        self.assertTrue(admit(self.schedule, self.start, 8*3600, charges=self.charges)['allowed'])

    def test_stale_account_observation_does_not_refresh_itself(self):
        self.assertFalse(admit(self.schedule, self.start+timedelta(hours=2), 3600, charges=self.charges)['allowed'])

    def test_incomplete_account_inventory_refuses_admission(self):
        self.charges['complete_account_scope'] = False
        self.assertFalse(admit(self.schedule, self.start, 3600, charges=self.charges)['allowed'])

    def test_lagging_provider_bill_still_counts_elapsed_allocation(self):
        now = self.start+timedelta(days=5)
        self.charges['observed_at'] = now.isoformat()
        self.assertFalse(admit(self.schedule, now, 3600, charges=self.charges, other_reservations_usd='120')['allowed'])

    def test_other_queue_reservations_cannot_double_spend(self):
        self.assertFalse(admit(self.schedule, self.start, 3600, charges=self.charges, other_reservations_usd='190')['allowed'])

    def test_charge_observer_cannot_expand_owner_credit(self):
        self.charges.update(account_total_usd='249', grant_initial_usd='1000')
        self.assertFalse(admit(self.schedule, self.start, 3600, charges=self.charges)['allowed'])

    def test_other_account_currency_or_evidence_cannot_replace_binding(self):
        for key, value in [('account_scope_id', 'other-account'), ('currency', 'BRL'),
                           ('grant_evidence_id', 'other-grant')]:
            with self.subTest(key=key):
                obs = dict(self.charges, **{key:value})
                self.assertFalse(admit(self.schedule, self.start, 3600, charges=obs)['allowed'])

    def test_grant_without_account_binding_is_not_usable(self):
        del self.grant['account_scope_id']
        with self.assertRaises(ValueError): deadlines(self.grant, self.quote, self.start.isoformat())


if __name__ == '__main__': unittest.main()
