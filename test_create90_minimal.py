"""Actual controller branches with all Docker calls, clocks, sockets and fences mocked."""
import unittest,tempfile,json,subprocess
from pathlib import Path
from unittest import mock
import local_controller as c,docker_control as d
N='012345abcdef';NID='b'*64;CID='c'*64
class ControllerTests(unittest.TestCase):
 def scenario(self,fail=None,run_start=False):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);run=root/'runs'/N;run.mkdir(parents=True);state=c.CancellationState();clock=[0];calls=[];running=False
   with mock.patch.object(c,'ROOT',root),mock.patch.object(c.DockerPG,'fence'),mock.patch.object(c.time,'monotonic',side_effect=lambda:clock[0]):
    pg=c.DockerPG(run,N,'/mock',{},Path('/node'),{},600,state);pg.prepared=True
    def docker(*args,**kw):
     nonlocal running
     calls.append((args,kw,pg.uncertain))
     if args[:2]==('network','create'):
      self.assertTrue(pg.uncertain)
      if fail=='network-timeout':raise subprocess.TimeoutExpired('MOCK',15)
      if fail=='network-signal':raise c.Cancelled('MOCK-SIGNAL')
      return mock.Mock(stdout=NID)
     if args[:2]==('network','inspect'):
      if fail=='network-inspect':raise RuntimeError('MOCK-METADATA')
      return mock.Mock(stdout=json.dumps([{'Id':NID,'Name':'peticao-r0015-'+N+'-net','Labels':d.owned_labels(N),'Driver':'bridge','Internal':False,'Containers':{}}]))
     if args[0]=='create':
      self.assertEqual(kw['timeout'],90);self.assertTrue(pg.uncertain)
      if fail=='create-timeout':raise subprocess.TimeoutExpired('MOCK',90)
      if fail=='create-signal':raise c.Cancelled('MOCK-SIGNAL')
      return mock.Mock(stdout=CID)
     if args[0]=='start':
      self.assertTrue(pg.uncertain)
      if fail=='start-timeout':raise subprocess.TimeoutExpired('MOCK',20)
      running=True;return mock.Mock(stdout=CID)
     if args[0]=='inspect':
      if fail=='container-inspect'or fail=='start-inspect'and running:raise RuntimeError('MOCK-INSPECT')
      if fail=='cancel-after-inspect':state.signals=1
      if fail=='deadline-after-inspect':clock[0]=600
      obj={'Id':'d'*64 if fail=='id-drift'else CID,'Name':'/peticao-r0015-'+N+'-pg','Config':{'Labels':{}if fail=='foreign-label'else d.owned_labels(N)},'Image':d.IMAGE,'HostConfig':{'PortBindings':{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55495'}]},'Memory':512*1024**2,'NanoCpus':10**9,'PidsLimit':128,'ReadonlyRootfs':True,'Binds':None,'Tmpfs':{'/var/lib/postgresql/data':'','/var/run/postgresql':'','/tmp':''},'NetworkMode':NID},'NetworkSettings':{'Networks':{'peticao-r0015-'+N+'-net':{'NetworkID':NID if running else''}}},'State':{'Status':'running'if running else'created','Running':running}}
      return mock.Mock(stdout=json.dumps([obj]))
     raise AssertionError('unreviewed Docker call '+str(args))
    if fail=='cancel-before':state.signals=1
    if fail=='deadline-before':clock[0]=599
    with mock.patch.object(d,'docker',side_effect=docker),mock.patch.object(d,'cleanup',return_value={'containerRemoved':True,'networkRemoved':True})as cleanup,mock.patch.object(c.socket,'socket')as sock:
     sock.return_value.__enter__.return_value.connect_ex.return_value=111
     if fail:
      with self.assertRaises(c.Cancelled):
       pg.initialize()
       if run_start:pg.start()
      self.assertTrue(pg.uncertain);proof=pg.stop();self.assertFalse(proof['cleanupAttempted']);self.assertTrue(proof['dependencyHeld']);self.assertFalse(proof['resourceAbsenceEstablished']);cleanup.assert_not_called()
     else:
      pg.initialize();self.assertFalse(pg.uncertain);self.assertEqual(pg.cid,CID)
      if run_start:pg.start();self.assertFalse(pg.uncertain);self.assertTrue(pg.started)
      pg.stop();cleanup.assert_called_once_with(N,expected_cid=CID,expected_nid=NID)
    return calls
 def test_normal_create90_and_verified_start(self):self.scenario(run_start=True)
 def test_normal_created_not_started_cleanup_known_ids(self):self.scenario()
 def test_timeout90_keeps_network_and_never_retries(self):
  calls=self.scenario('create-timeout');self.assertEqual(sum(a[0]=='create'for a,k,u in calls),1);self.assertFalse(any(a[0]=='start'for a,k,u in calls))
 def test_network_timeout_keeps_dependency(self):self.scenario('network-timeout')
 def test_signal_during_network_mutation_keeps_dependency(self):self.scenario('network-signal')
 def test_signal_during_container_mutation_keeps_dependency(self):self.scenario('create-signal')
 def test_inspect_error_after_network_mutation_keeps_dependency(self):self.scenario('network-inspect')
 def test_inspect_error_after_container_mutation_keeps_dependency(self):self.scenario('container-inspect')
 def test_start_timeout_never_cleans_uncertain_running_object(self):self.scenario('start-timeout',True)
 def test_start_inspection_error_keeps_dependency(self):self.scenario('start-inspect',True)
 def test_id_drift_refuses_cleanup(self):self.scenario('id-drift')
 def test_foreign_object_refuses_cleanup(self):self.scenario('foreign-label')
 def test_cancel_before_admission_has_no_docker_mutation(self):self.assertEqual(self.scenario('cancel-before'),[])
 def test_deadline_before_admission_has_no_docker_mutation(self):self.assertEqual(self.scenario('deadline-before'),[])
 def test_cancel_during_metadata_never_clears_uncertain(self):self.scenario('cancel-after-inspect')
 def test_deadline_during_metadata_never_clears_uncertain(self):self.scenario('deadline-after-inspect')
if __name__=='__main__':unittest.main()
