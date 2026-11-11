"""Main lifecycle with Docker/Node/PG fully mocked; no network or real signals."""
from pathlib import Path
import json,tempfile,unittest,os
from unittest import mock
import local_runner as r
CID='c'*64;NID='b'*64;NONCE='012345abcdef'
REG=json.loads((Path(__file__).parent/'local-registry.json').read_text())
class MainLifecycleTests(unittest.TestCase):
 def test_main_uses_same_r7_names_through_create_inspect_start_reinspect(self):
  with tempfile.TemporaryDirectory(dir=Path(__file__).parent)as temp:
   root=Path(temp);(root/'local-manifest.json').write_text('{"files":{}}');(root/'local-registry.json').write_text(json.dumps(REG));events=[];running=False
   def fake(*args,**kw):
    nonlocal running
    if args[:2]==('network','create'):events.append(('network-create',args[-1]));return mock.Mock(stdout=NID)
    if args[:2]==('network','inspect'):
     events.append(('network-inspect',args[-1]));self.assertEqual(args[-1],'peticao-r0008-'+NONCE+'-net');return mock.Mock(stdout=json.dumps([{'Id':NID,'Name':args[-1],'Labels':r.owned_labels(NONCE),'Driver':'bridge','Internal':False,'Containers':{}}]))
    if args[0]=='create':events.append(('container-create',args[args.index('--name')+1]));return mock.Mock(stdout=CID)
    if args[0]=='inspect':
     events.append(('container-inspect',args[-1]));self.assertEqual(args[-1],'peticao-r0008-'+NONCE+'-pg')
     obj={'Id':CID,'Name':'/'+args[-1],'Image':r.IMAGE,'Config':{'Labels':r.owned_labels(NONCE)},'State':{'Status':'running'if running else'created','Running':running},'HostConfig':{'PortBindings':{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55487'}]},'Memory':512*1024**2,'NanoCpus':10**9,'PidsLimit':128,'ReadonlyRootfs':True,'Binds':None,'Tmpfs':{'/var/lib/postgresql/data':'','/var/run/postgresql':'','/tmp':''},'NetworkMode':NID},'NetworkSettings':{'Networks':{'peticao-r0008-'+NONCE+'-net':{'NetworkID':NID if running else''}}}}
     return mock.Mock(stdout=json.dumps([obj]))
    if args[0]=='start':events.append(('start',args[1]));running=True;return mock.Mock(stdout=CID)
    if args[0]=='exec':events.append(('sql-would-start',CID));raise RuntimeError('MOCK END: no PostgreSQL or Node executed')
    raise AssertionError(args)
   original=Path.read_text
   def read(path,*a,**k):return ''if str(path)=='/sys/fs/cgroup/mock/cgroup.procs'else original(path,*a,**k)
   context={'cgroup':'/mock','pid':os.getpid()}
   with mock.patch.object(r,'ROOT',root),mock.patch.object(r,'pinned'),mock.patch.object(r,'unit_context',return_value=context),mock.patch.object(r,'check_context'),mock.patch.object(r,'verify_inputs',return_value={}),mock.patch.object(r,'expected_inventory',return_value={}),mock.patch.object(r,'verify_reused',return_value=True),mock.patch.object(r,'docker',side_effect=fake),mock.patch.object(r,'cleanup',return_value={'containerRemoved':True,'networkRemoved':True})as clean,mock.patch.object(r,'drain',return_value={'nodeGroupDrained':True}),mock.patch.object(r,'export'),mock.patch.object(r,'verify_export'),mock.patch.object(r.socket,'socket')as sock,mock.patch.object(Path,'read_text',read),mock.patch.object(r.signal,'alarm'),mock.patch.object(r.uuid,'uuid4',return_value=mock.Mock(hex=NONCE+'0'*20)):
    sock.return_value.__enter__.return_value.connect_ex.return_value=111
    self.assertEqual(r.main('a'*64),1)
   self.assertEqual(events,[('network-create','peticao-r0008-'+NONCE+'-net'),('network-inspect','peticao-r0008-'+NONCE+'-net'),('container-create','peticao-r0008-'+NONCE+'-pg'),('container-inspect','peticao-r0008-'+NONCE+'-pg'),('start',CID),('container-inspect','peticao-r0008-'+NONCE+'-pg'),('sql-would-start',CID)])
   clean.assert_called_once_with(NONCE,expected_cid=CID,expected_nid=NID)
if __name__=='__main__':unittest.main()

class CleanupCancellationTests(unittest.TestCase):
 def run_cleanup(self,phase):
  with tempfile.TemporaryDirectory(dir=Path(__file__).parent)as temp:
   root=Path(temp);run=root/'runs'/NONCE;run.mkdir(parents=True);state=r.CancellationState();proof={'exit':0,'classification':'MOCK','cancelSignals':0};original_read=Path.read_text;original_write=r.write
   def read(path,*a,**kw):return ''if str(path)=='/sys/fs/cgroup/mock/cgroup.procs'else original_read(path,*a,**kw)
   def node(*args):
    if phase=='node':state.handle(15,None)
    return {'nodeGroupDrained':True}
   def pg(*args,**kw):
    if phase=='docker':state.handle(15,None)
    return {'containerRemoved':True,'networkRemoved':True}
   def export(*args):
    if phase=='export':state.handle(2,None);state.handle(15,None)
   def write(path,value):
    if phase=='receipt'and path.name=='outer-result.json':state.handle(15,None)
    return original_write(path,value)
   with mock.patch.object(r,'ROOT',root),mock.patch.object(r,'drain',side_effect=node)as drain,mock.patch.object(r,'cleanup',side_effect=pg)as cleanup,mock.patch.object(r,'export',side_effect=export)as out,mock.patch.object(r,'verify_export'),mock.patch.object(r,'write',side_effect=write),mock.patch.object(r.socket,'socket')as sock,mock.patch.object(Path,'read_text',read),mock.patch.object(r.signal,'alarm'):
    sock.return_value.__enter__.return_value.connect_ex.return_value=111
    r.finish_run(run,proof,None,{'cgroup':'/mock'},None,NONCE,CID,NID,True,'a'*32,state)
   drain.assert_called_once();cleanup.assert_called_once();out.assert_called_once();self.assertFalse(state.cleaning);self.assertEqual(proof['exit'],1);self.assertGreaterEqual(state.signals,1);stored=json.loads((run/'outer-result.json').read_text());self.assertEqual(stored['exit'],1);self.assertEqual(stored['cancelSignals'],state.signals)
 def test_term_during_node_cleanup_still_attempts_docker_and_export(self):self.run_cleanup('node')
 def test_term_during_docker_cleanup_does_not_skip_export(self):self.run_cleanup('docker')
 def test_repeated_signals_during_export_force_failure(self):self.run_cleanup('export')
 def test_signal_during_outer_receipt_rewrites_failure(self):self.run_cleanup('receipt')
 def test_outside_cleanup_signal_raises_and_counts(self):
  state=r.CancellationState()
  with self.assertRaises(InterruptedError):state.handle(15,None)
  self.assertEqual(state.signals,1)
