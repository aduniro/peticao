import unittest,copy
from pathlib import Path
from package_http import verify_reconciled_state,verify_document_preservation
class ReconciliationStateTests(unittest.TestCase):
 def setUp(self):
  self.decision={'ok':True,'complete':True,'updated':2};self.snapshot={'batches':[{'id':2,'status':'sent','sent_at':'2026-11-11T00:00:00Z','approval_code_hash':None}],'sends':[{'batch_id':2,'ok':True}]}
 def test_f555_two_changes_not_one(self):
  self.assertTrue(verify_reconciled_state(self.decision,self.snapshot,2));self.assertFalse(eval((Path(__file__).parent/'baseline-reconciliation-assertion.txt').read_text(),{'__builtins__':{}},{'decision':self.decision})) # Exact baseline01c expression rejects valid f555 result2.
 def test_one_change_not_sufficient_for_this_fixture(self):
  self.decision['updated']=1
  with self.assertRaises(RuntimeError):verify_reconciled_state(self.decision,self.snapshot,2)
 def test_still_prepared_is_not_reconciled(self):
  self.snapshot['batches'][0]['status']='prepared'
  with self.assertRaises(RuntimeError):verify_reconciled_state(self.decision,self.snapshot,2)
 def test_sent_timestamp_required(self):
  self.snapshot['batches'][0]['sent_at']=None
  with self.assertRaises(RuntimeError):verify_reconciled_state(self.decision,self.snapshot,2)
 def test_unconsumed_code_rejected(self):
  self.snapshot['batches'][0]['approval_code_hash']='a'*64
  with self.assertRaises(RuntimeError):verify_reconciled_state(self.decision,self.snapshot,2)
 def test_duplicate_or_unaccepted_recipient_rejected(self):
  self.snapshot['sends'].append({'batch_id':2,'ok':True})
  with self.assertRaises(RuntimeError):verify_reconciled_state(self.decision,self.snapshot,2)
  self.snapshot['sends']=[{'batch_id':2,'ok':False}]
  with self.assertRaises(RuntimeError):verify_reconciled_state(self.decision,self.snapshot,2)
class DocumentPreservationTests(unittest.TestCase):
 def setUp(self):
  self.before={n:'a'*64 for n in ['batches','batch_document_versions','batch_packages','petition_base_artifacts','petition_base_validations','petition_base_selections']}
 def test_equal_complete_byte_inventory_passes(self):self.assertTrue(verify_document_preservation(self.before,self.before.copy()))
 def test_changed_actual_document_fingerprint_fails(self):
  after=self.before.copy();after['batch_document_versions']='b'*64
  with self.assertRaises(RuntimeError):verify_document_preservation(self.before,after)
 def test_missing_base_or_empty_inventory_fails(self):
  after=self.before.copy();del after['petition_base_artifacts']
  with self.assertRaises(RuntimeError):verify_document_preservation(self.before,after)
  with self.assertRaises(RuntimeError):verify_document_preservation({},{})
if __name__=='__main__':unittest.main()
