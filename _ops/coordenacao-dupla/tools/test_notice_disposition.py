import importlib.util,json,pathlib,subprocess,sys,tempfile,time,unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('coord_disposition',pathlib.Path(__file__).with_name('coord.py'))
coord=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(coord)

class NoticeDispositionTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=pathlib.Path(self.tmp.name)/'ledger.sqlite';self.l=coord.Ledger(self.db)
  for actor in ('a','b'):self.l.register(actor,'session-'+actor,[self.tmp.name])
 def tearDown(self):self.tmp.cleanup()
 def notice(self,summary='Fixture publication notice',author='a'):
  manifest={'commit':'a'*40,'files':['site/src/fixture.ts'],'api_contracts':'fixture unchanged','database':'fixture additive','tests':['fixture checks passed'],'destination':'private fixture'}
  return self.l.announce(author,summary,['code:'],{'manifest':manifest})['seq']
 def propose(self,target,kind='withdrawn',replacement=None,actor='a'):
  digest=self.l.notice_fingerprint(target)['sha256']
  return self.l.propose_notice_disposition(actor,target,digest,kind,'Fixture operation is no longer executable','Retained fixture source and review evidence',replacement)
 def confirm(self,proposal,actor='b'):
  return self.l.confirm_notice_disposition(actor,proposal['proposal_event'],proposal['target_sha256'])
 def acquire(self,target):return self.l.acquire('a',['deploy:fixture'],operation='deploy',manifest_event=target)
 def release(self,lease):self.l.release('a',lease['lease'],lease['token'],lease['fence'])
 def test_pending_requires_peer_and_never_changes_original_acks(self):
  old=self.notice();new=self.notice('New qualified fixture');self.l.ack('b',new)
  with self.l.db() as d:before=dict(d.execute('SELECT * FROM events WHERE seq=?',(old,)).fetchone());acks=[tuple(r) for r in d.execute('SELECT * FROM acks')]
  proposal=self.propose(old)
  with self.assertRaises(PermissionError):self.confirm(proposal,'a')
  with self.assertRaisesRegex(RuntimeError,'pending_ack'):self.acquire(new)
  self.assertTrue(any(x['event']==old for x in self.l.status()['pending_ack']))
  self.assertTrue(self.confirm(proposal)['confirmed'])
  self.release(self.acquire(new))
  with self.l.db() as d:
   self.assertEqual(dict(d.execute('SELECT * FROM events WHERE seq=?',(old,)).fetchone()),before)
   self.assertEqual([tuple(r) for r in d.execute('SELECT * FROM acks')],acks)
  self.assertFalse(any(x['event']==old for x in self.l.status()['pending_ack']))
 def test_disposed_target_cannot_be_reused_even_after_late_ack(self):
  old=self.notice();proposal=self.propose(old,'rejected');self.confirm(proposal);self.l.ack('b',old)
  with self.assertRaisesRegex(RuntimeError,'critical_manifest_notice_inactive'):self.acquire(old)
 def test_replacement_still_needs_own_ack(self):
  old=self.notice();new=self.notice('Replacement notice');proposal=self.propose(old,'superseded',new);self.confirm(proposal)
  with self.assertRaisesRegex(RuntimeError,'pending_ack'):self.acquire(new)
  self.l.ack('b',new);self.release(self.acquire(new))
 def test_other_pending_notice_not_removed(self):
  old=self.notice();materials=self.notice('Materials union review remains pending');new=self.notice('Release fixture');self.l.ack('b',new)
  self.confirm(self.propose(old,'rejected'))
  self.assertTrue(any(x['event']==materials for x in self.l.status()['pending_ack']))
  with self.assertRaisesRegex(RuntimeError,'pending_ack'):self.acquire(new)
 def test_three_active_coordinators_require_all_real_confirmations(self):
  self.l.register('c','session-c',[self.tmp.name]);target=self.notice();proposal=self.propose(target)
  self.assertFalse(self.confirm(proposal,'b')['confirmed'])
  self.assertFalse(self.confirm(proposal,'b')['confirmed'])
  self.assertTrue(any(x['event']==target for x in self.l.status()['pending_ack']))
  self.assertTrue(self.confirm(proposal,'c')['confirmed'])
 def test_inactive_replacement_refused_and_no_cyclic_supersession(self):
  old=self.notice();replacement=self.notice('Replacement fixture');proposal=self.propose(old,'superseded',replacement)
  self.confirm(self.propose(replacement))
  with self.assertRaisesRegex(RuntimeError,'replacement_notice_inactive'):self.confirm(proposal)
  self.assertTrue(any(x['event']==old for x in self.l.status()['pending_ack']))
 def test_live_and_uncertain_leases_are_not_resolved_by_disposition(self):
  target=self.notice();self.l.ack('b',target);lease=self.acquire(target)
  with self.assertRaisesRegex(RuntimeError,'live_or_uncertain'):self.propose(target)
  with patch.object(coord.time,'time',return_value=time.time()+3600):self.l.status()
  with self.assertRaisesRegex(RuntimeError,'live_or_uncertain'):self.propose(target)
  self.assertEqual(next(x for x in self.l.status()['leases'] if x['id']==lease['lease'])['state'],'uncertain')
 def test_confirmation_checks_lease_acquired_after_proposal(self):
  target=self.notice();self.l.ack('b',target);proposal=self.propose(target);lease=self.acquire(target)
  with self.assertRaisesRegex(RuntimeError,'live_or_uncertain'):self.confirm(proposal)
  self.release(lease);self.assertTrue(self.confirm(proposal)['confirmed'])
 def test_invalid_digest_replacement_and_non_notice_refused(self):
  target=self.notice();digest=self.l.notice_fingerprint(target)['sha256']
  with self.assertRaisesRegex(ValueError,'digest_mismatch'):self.l.propose_notice_disposition('a',target,'0'*64,'withdrawn','Fixture reason retained','Fixture evidence retained')
  with self.assertRaises(ValueError):self.propose(target,'superseded',target)
  with self.assertRaises(ValueError):self.l.notice_fingerprint(1)
  proposal=self.propose(target)
  with self.assertRaisesRegex(ValueError,'digest_mismatch'):self.l.confirm_notice_disposition('b',proposal['proposal_event'],'0'*64)
  self.assertTrue(self.confirm(proposal)['confirmed'])
  with self.assertRaises(RuntimeError):self.propose(target)
 def test_retired_actor_cannot_confirm_or_supply_proposal_quorum(self):
  target=self.notice();old=self.propose(target);self.l.register('c','session-c',[self.tmp.name])
  n=self.l.announce('c','Owner-authorized fixture succession',['coord:actors'],{'actor_handoff':{'prior':'a','replacement':'c','session':'session-c','owner_reference':'Fixture owner succession'}})['seq']
  self.l.ack('b',n);self.l.handoff('c','a',n)
  with self.assertRaises(PermissionError):self.confirm(old,'a')
  with self.assertRaisesRegex(RuntimeError,'proposal_actor_retired'):self.confirm(old,'b')
  proposal=self.propose(target,actor='c');self.assertTrue(self.confirm(proposal)['confirmed'])
 def test_cli_round_trip_and_new_checkout_canonical_mapping(self):
  target=self.notice();digest=self.l.notice_fingerprint(target)['sha256'];script=str(pathlib.Path(__file__).with_name('coord.py'))
  def cli(*args):
   p=subprocess.run([sys.executable,script,'--db',str(self.db),*args],capture_output=True,text=True);self.assertEqual(p.returncode,0,p.stdout+p.stderr);return json.loads(p.stdout)['result']
  p=cli('propose-notice-disposition','--actor','a','--event',str(target),'--digest',digest,'--disposition','withdrawn','--reason','Fixture operation withdrawn','--evidence','Fixture evidence retained')
  self.assertTrue(cli('confirm-notice-disposition','--actor','b','--proposal-event',str(p['proposal_event']),'--digest',digest)['confirmed'])
  self.assertEqual(coord.resource('/mnt/apps/peticao-final/peticao-release/site/src/lib/db.ts'),'code:site/src/lib/db.ts')

if __name__=='__main__':unittest.main()
