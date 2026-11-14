import importlib.util,json,shlex,tempfile,time,unittest,hashlib,shutil
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import caller as c

class CallerBoundaries(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=c.SOURCE.parent);self.addCleanup(self.tmp.cleanup)
  self.state=Path(self.tmp.name);p=patch.object(c,'STATE',self.state);p.start();self.addCleanup(p.stop)
  self.args=SimpleNamespace(phase='status',manifest_event=1)
  self.gate=({}, {'live_expires':time.time()+3600}, {})
 def test_expired_gate_blocks_ssh(self):
  with patch.object(c,'gate',side_effect=RuntimeError('expired')),patch.object(c.subprocess,'run') as run:
   with self.assertRaisesRegex(RuntimeError,'expired'):c.dispatch(self.args,'fixture')
   run.assert_not_called()
 def test_build_requires_full_runtime_lease_budget(self):
  with patch.object(c,'gate',return_value=({}, {'live_expires':time.time()+1800},{})),patch.object(c.subprocess,'run') as run:
   with self.assertRaisesRegex(RuntimeError,'budget'):c.dispatch(self.args,'fixture',floor=2100)
   run.assert_not_called()
 def test_ssh_is_exact_azure_builder_and_pinned_key(self):
  a=c.ssh_args();self.assertEqual(a[-1],'root@100.122.224.82');self.assertIn('StrictHostKeyChecking=yes',a);self.assertIn('HostKeyAlias=peticao-civo.tail1a6d71.ts.net',a);self.assertIn('/dev/null',a)
  self.assertIn('/dev/null',a)
 def test_second_build_submission_refuses_before_dispatch(self):
  self.args.phase='start';c.save(self.state/'start.intent.json',{'state':'submitting'},exclusive=True)
  with patch.object(c,'dispatch') as run:
   with self.assertRaisesRegex(RuntimeError,'already_attempted'):c.phase(self.args)
   run.assert_not_called()
 def test_remote_commands_compile_and_transport_failure_preserves_intent(self):
  for phase in ['prepare','start','status','evidence']:
   self.args.phase=phase
   def fail(args,command,**kwargs):
    compile(shlex.split(command)[-1],'<remote>', 'exec')
    return SimpleNamespace(returncode=1,stdout=b'{"fixture":"failed"}',stderr=b'')
   with patch.object(c,'dispatch',side_effect=fail):
    with self.assertRaisesRegex(RuntimeError,'remote_phase_failed'):c.phase(self.args)
   if phase in ['prepare','start']:self.assertEqual(json.loads((self.state/(phase+'.intent.json')).read_text())['state'],'submitting')
 def test_gate_requires_real_root_ack_and_matching_lease_notice(self):
  source=c.SOURCE
  for name in ['caller.py','runner.py','policy.json','known_hosts','test_runner.py','test_caller.py','test_adaptations.py','qa-driver.mjs','requirements.lock']:shutil.copyfile(source/name,self.state/name)
  cap={'lease':'fixture','token':'fictitious-not-secret','fence':1,'seq':12};(self.state/'cap.json').write_text(json.dumps({'result':cap}))
  args=SimpleNamespace(lease_file=str(self.state/'cap.json'),manifest_event=10)
  body={'manifest':{'commit':'a'*40},'file_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.state.iterdir() if p.name!='cap.json'},'qualification':{'policy_sha256':hashlib.sha256((self.state/'policy.json').read_bytes()).hexdigest()}}
  def ledger(argv):
   if argv[0]=='check':return {'valid':True,'expires':time.time()+3600}
   if argv[0]=='status':return {'leases':[{'id':'fixture','actor':'apoio','operation':'test','resources':[c.DEST]}]}
   if argv[0]=='history' and argv[2]=='11':return [{'data':{'manifest_event':10}}]
   if argv[0]=='history' and argv[2]=='9':return [{'seq':10,'kind':'notice','data':body}]
   return [{'kind':'ack','actor':'admin-recuperacao','data':{'event_seq':10}}]
  with patch.object(c,'SOURCE',self.state),patch.object(c,'cli',side_effect=ledger),patch.object(c.subprocess,'check_output',return_value='a'*40):
   self.assertEqual(c.gate(args)[0]['target'],'peticao-civo')
  def noack(argv):return [] if argv[0]=='history' and argv[2]=='10' else ledger(argv)
  with patch.object(c,'SOURCE',self.state),patch.object(c,'cli',side_effect=noack),patch.object(c.subprocess,'check_output',return_value='a'*40):
   with self.assertRaisesRegex(RuntimeError,'Root_ACK'):c.gate(args)
  def wrongacq(argv):return [{'data':{'manifest_event':9}}] if argv[0]=='history' and argv[2]=='11' else ledger(argv)
  with patch.object(c,'SOURCE',self.state),patch.object(c,'cli',side_effect=wrongacq),patch.object(c.subprocess,'check_output',return_value='a'*40):
   with self.assertRaisesRegex(RuntimeError,'lease_notice'):c.gate(args)
if __name__=='__main__':unittest.main()
