"""Owner optional-channel policy: real ACKs, locks and historical records preserved."""
import importlib.util,json,pathlib,tempfile,unittest
SPEC=importlib.util.spec_from_file_location('coord_roles',pathlib.Path(__file__).with_name('coord.py'))
c=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(c)
class ReviewRoles(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.l=c.Ledger(pathlib.Path(self.tmp.name)/'test.sqlite')
  for a in ['root','apoio','executor61']:self.l.register(a,'fixture-'+a,[])
 def policy(self,**changes):
  data={'version':1,'optional_actors':['executor61'],'owner_reference':'Direct owner instruction, fixture','owner_evidence_sha256':'a'*64};data.update(changes)
  with self.l.db(True) as d:self.l.event(d,'root','reviewer_policy_changed','Owner makes Executor optional',data,['coord:review-policy'])
 def manifest(self):
  return self.l.announce('root','Fixture manifest',['code:'],{'manifest':{'commit':'a'*40,'files':['fixture'],'tests':['passed'],'api_contracts':'unchanged','database':'unchanged','destination':'fixture'}})['seq']
 def test_old_policy_unchanged_until_explicit_owner_event(self):
  n=self.manifest();self.l.ack('apoio',n)
  with self.assertRaisesRegex(RuntimeError,'executor61'):self.l.acquire('root',['deploy:fixture'],'deploy',manifest_event=n)
 def test_optional_executor_does_not_block_but_registry_and_acks_preserved(self):
  n=self.manifest();self.l.ack('apoio',n);self.policy()
  with self.l.db() as d:
   before=[tuple(r) for r in d.execute('SELECT * FROM acks')]
   self.assertIn('executor61',self.l.active_actors(d));self.assertEqual(set(self.l.required_reviewers(d)),{'root','apoio'})
  lease=self.l.acquire('root',['deploy:fixture'],'deploy',manifest_event=n)
  self.l.release('root',lease['lease'],lease['token'],lease['fence'])
  with self.l.db() as d:self.assertEqual(before,[tuple(r) for r in d.execute('SELECT * FROM acks')])
 def test_real_apoio_ack_still_required(self):
  self.policy();n=self.manifest()
  with self.assertRaisesRegex(RuntimeError,'apoio'):self.l.acquire('root',['deploy:fixture'],'deploy',manifest_event=n)
 def test_optional_ack_still_possible_and_visible(self):
  self.policy();n=self.manifest();self.l.ack('executor61',n)
  with self.l.db() as d:self.assertIsNotNone(d.execute('SELECT 1 FROM acks WHERE actor=? AND seq=?',('executor61',n)).fetchone())
  actor=next(a for a in self.l.status()['actors'] if a['id']=='executor61')
  self.assertTrue(actor['active']);self.assertFalse(actor['review_required'])
 def test_no_active_or_uncertain_lock_bypass(self):
  self.policy();held=self.l.acquire('root',['code:fixture'])
  with self.assertRaisesRegex(RuntimeError,'resource_busy'):self.l.acquire('apoio',['code:fixture'])
  with self.l.db(True) as d:d.execute('UPDATE leases SET expires=0 WHERE id=?',(held['lease'],))
  with self.assertRaisesRegex(RuntimeError,'resource_busy'):self.l.acquire('apoio',['code:fixture'])
 def test_two_real_coordinators_still_required(self):
  self.policy()
  with self.l.db(True) as d:d.execute("DELETE FROM actors WHERE id='apoio'")
  n=self.manifest()
  with self.assertRaisesRegex(RuntimeError,'two_coordinators_required'):self.l.acquire('root',['deploy:fixture'],'deploy',manifest_event=n)
 def test_normal_reconciliation_no_longer_needs_optional_actor(self):
  self.policy();held=self.l.acquire('root',['code:fixture'])
  with self.l.db(True) as d:d.execute('UPDATE leases SET expires=0 WHERE id=?',(held['lease'],))
  r=self.l.propose_resolution('root',held['lease'],'completed','Fixture actual proof')
  self.assertTrue(self.l.confirm_resolution('apoio',r['resolution'])['confirmed'])
 def test_invalid_policy_fails_closed(self):
  self.policy(optional_actors=['apoio','executor61'])
  with self.l.db() as d:
   with self.assertRaisesRegex(RuntimeError,'invalid_owner_reviewer_policy'):self.l.required_reviewers(d)
 def test_required_pending_only_excludes_optional_without_deleting_notice(self):
  self.policy();n=self.manifest();self.l.ack('apoio',n)
  self.assertFalse(self.l.status()['pending_ack'])
  with self.l.db() as d:self.assertIsNotNone(d.execute('SELECT 1 FROM events WHERE seq=?',(n,)).fetchone())
if __name__=='__main__':unittest.main()
