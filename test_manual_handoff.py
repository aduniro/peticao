import copy
import hashlib
import json
import tempfile
import unittest
from manual_handoff import candidate
from financial_runtime import owned_resources


class ManualHandoff(unittest.TestCase):
    def setUp(self):
        self.now='2026-11-14T19:00:00+00:00'
        self.ident='11111111-1111-4111-8111-111111111111'
        self.owner=dict(kind='owner_created_handoff',source_ref='owner-message:test-only',
                        instance_id=self.ident,account_scope_id='account-test',region='NYC1',
                        allocated_at='2026-11-14T18:00:00+00:00',
                        expected=dict(hostname='peticao-civo',size='g4c.medium'))
        self.live=dict(id=self.ident,hostname='peticao-civo',size='g4c.medium',
                       created_at=self.owner['allocated_at'],account_id='account-test')
        self.proof=dict(account_scope_id='account-test',identity_verified=True,
                        region='NYC1',observed_at=self.now)
        self.policy=dict(account_scope_id='account-test',grant=dict(initial_usd='250',
                         baseline_spent_usd='0',currency='USD',provenance='authenticated_owner',
                         account_scope_id='account-test',grant_evidence_id='test-grant',
                         expires_at='2026-12-31T00:00:00Z'),quote=dict(currency='USD',
                         complete_mandatory_costs=True,hourly_usd='0.380952'))

    def make(self,sha=None):
        raw=json.dumps(self.owner,sort_keys=True).encode()
        return candidate(raw,sha or hashlib.sha256(raw).hexdigest(),self.live,self.proof,
                         observed_at=self.now,policy=self.policy)

    def test_valid_manual_handoff_remains_observation_only(self):
        x=self.make()
        self.assertEqual(x['allowed_operations'],['observe'])
        for key in ['cleanup_authorized','creation_response_bound','ssh_access_verified','development_jobs_enabled']:
            self.assertIs(x[key],False)
        self.assertEqual(x['proposed_schedule']['allocated_at'],self.owner['allocated_at'])
        self.assertNotIn('creation_key',x)

    def test_cannot_feed_manual_candidate_into_destructive_controller(self):
        x=self.make()
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):owned_resources(x,root,'account-test')

    def test_name_only_handoff_is_rejected(self):
        del self.owner['instance_id']
        with self.assertRaises(ValueError):self.make()

    def test_another_instance_with_same_name_is_rejected(self):
        self.live['id']='22222222-2222-4222-8222-222222222222'
        with self.assertRaises(ValueError):self.make()

    def test_other_account_or_region_or_stale_identity_is_rejected(self):
        for key,value in [('account_scope_id','other'),('region','LON1'),
                          ('identity_verified',False),('observed_at','2026-11-14T18:54:59+00:00')]:
            with self.subTest(key=key):
                old=copy.deepcopy(self.proof);self.proof[key]=value
                with self.assertRaises(ValueError):self.make()
                self.proof=old

    def test_start_cannot_be_rebased_to_now(self):
        self.owner['allocated_at']=self.now
        with self.assertRaises(ValueError):self.make()

    def test_edited_owner_evidence_rejected(self):
        with self.assertRaises(ValueError):self.make('0'*64)

    def test_changed_shape_rejected(self):
        self.live['size']='g4c.large'
        with self.assertRaises(ValueError):self.make()

    def test_missing_api_creation_timestamp_is_not_guessed(self):
        del self.live['created_at']
        with self.assertRaises(ValueError):self.make()


if __name__=='__main__':unittest.main()
