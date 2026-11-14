import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from cloud_receipt import reconcile
from provision_steps import HOSTNAME,NETWORK


class DurableAllocation(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);(self.root/'journal').mkdir()
        self.ident='11111111-1111-4111-8111-111111111111'
        self.request={'method':'POST','path':'/v2/instances','payload':{'size':'g4c.medium'}}
        self.entry={'state':'completed','request':self.request,
                    'request_sha256':hashlib.sha256(json.dumps(self.request,sort_keys=True).encode()).hexdigest(),
                    'response':{'id':self.ident}}
        self.save()
        (self.root/'allocation-clock.json').write_text(json.dumps({'allocated_at':'2026-11-14T17:00:00+00:00'}))
        self.policy={'account_scope_id':'a','grant':dict(initial_usd='250',baseline_spent_usd='0',
                    currency='USD',provenance='authenticated_owner',account_scope_id='a',grant_evidence_id='g',
                    expires_at='2026-12-31T00:00:00Z'),
                    'quote':dict(currency='USD',complete_mandatory_costs=True,hourly_usd='0.410752')}
    def save(self):
        (self.root/'journal/create-instance.json').write_text(json.dumps(self.entry))
    def test_dropped_ssh_response_can_rebuild_from_completed_cloud_journal(self):
        result=reconcile(self.root,self.policy)
        self.assertTrue(result['receipt_durable']);self.assertEqual(result['instance_id'],self.ident)
        again=reconcile(self.root,self.policy);self.assertEqual(result,again)
    def test_pending_post_cannot_become_owned_instance_by_name(self):
        self.entry['state']='pending';self.save()
        with self.assertRaises(ValueError):reconcile(self.root,self.policy)
        self.assertFalse((self.root/'allocation.json').exists())
    def test_missing_clock_cannot_be_inferred_from_current_time(self):
        (self.root/'allocation-clock.json').unlink()
        with self.assertRaises(ValueError):reconcile(self.root,self.policy)
    def test_existing_allocation_cannot_be_rebased_to_larger_credit(self):
        reconcile(self.root,self.policy);self.policy['grant']['initial_usd']='1000'
        with self.assertRaises(ValueError):reconcile(self.root,self.policy)


if __name__=='__main__':unittest.main()
