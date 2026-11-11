"""Harmless local mocks: no Docker, sockets, application, PG or network execution."""
import json,unittest,hashlib,ast
from pathlib import Path
from unittest import mock
import local_runner as r
NONCE='012345abcdef';ID='a'*64
class LocalDraftTests(unittest.TestCase):
 def obj(self,kind='container'):
  labels=r.owned_labels(NONCE);name='peticao-r0003-'+NONCE+('-net'if kind=='network'else'-pg')
  return {'Id':ID,'Name':name,'Labels':labels,'Driver':'bridge','Internal':False}if kind=='network'else{'Id':ID,'Name':'/'+name,'Config':{'Labels':labels}}
 def test_fixed_exclusive_bridge_network(self):
  args=r.network_args(NONCE);self.assertNotIn('--internal',args);self.assertEqual(args[:4],['network','create','--driver','bridge']);self.assertNotIn('--attachable',args)
 def test_fixed_container_image_port_budget_no_mount(self):
  args=r.container_args(NONCE,ID)
  self.assertIn('--pull=never',args);self.assertIn(r.IMAGE,args);self.assertIn('127.0.0.1:55487:5432',args);self.assertIn('--cpus=1',args);self.assertIn('--memory=512m',args);self.assertIn('--read-only',args);self.assertNotIn('--volume',args);self.assertNotIn('--mount',args);self.assertNotIn('--privileged',args);self.assertNotIn('--restart',args)
 def test_ownership_exact_nonce_uid_id_name(self):
  self.assertEqual(r.verify_owned(self.obj(),NONCE,'container'),ID)
  for mutation in ['nonce','name','id','uid']:
   obj=self.obj()
   if mutation=='nonce':obj['Config']['Labels'][r.LABEL]='foreign'
   if mutation=='uid':obj['Config']['Labels'][r.LABEL+'.uid']='foreign'
   if mutation=='name':obj['Name']='/foreign'
   if mutation=='id':obj['Id']='short'
   with self.subTest(mutation=mutation),self.assertRaises(ValueError):r.verify_owned(obj,NONCE,'container')
 def test_foreign_resource_never_removed(self):
  calls=[]
  def fake(*args,**kwargs):calls.append(args);return mock.Mock(stdout='visible\n')
  with mock.patch.object(r,'docker',side_effect=fake),mock.patch.object(r,'inspect_owned',side_effect=ValueError('foreign')):
   result=r.cleanup(NONCE)
  self.assertEqual(len(result['cleanupErrors']),2);self.assertFalse(any('rm'in c for c in calls))
 def test_network_cleanup_attempted_after_container_failure(self):
  calls=[]
  def fake(*args,**kwargs):
   calls.append(args)
   if args[0]=='ps':return mock.Mock(stdout='visible\n')
   if args[:2]==('network','ls'):return mock.Mock(stdout='visible\n'if sum(c[:2]==('network','ls')for c in calls)==1 else'')
   return mock.Mock(stdout='')
  def inspected(name,nonce,kind):
   if kind=='container':raise ValueError('container identity uncertain')
   return self.obj('network')
  with mock.patch.object(r,'docker',side_effect=fake),mock.patch.object(r,'inspect_owned',side_effect=inspected):result=r.cleanup(NONCE)
  self.assertIn(('network','rm',ID),calls);self.assertTrue(result['networkRemoved']);self.assertIn('cleanupErrors',result)
 def test_absent_resource_uses_no_control_command(self):
  with mock.patch.object(r,'docker',return_value=mock.Mock(stdout=''))as docker:proof=r.cleanup(NONCE)
  self.assertTrue(proof['containerAbsent']);self.assertTrue(proof['networkAbsent']);self.assertFalse(any('rm'in call.args for call in docker.call_args_list))
 def test_fixed_environment_has_no_inherited_keys(self):
  with mock.patch.dict(r.os.environ,OPENAI_API_KEY='FAKE-CALLER',DATABASE_URL='FAKE-PRODUCTION'):
   env=r.environment(Path('/qa/run'),Path('/qa/run/site'))
  self.assertNotIn('OPENAI_API_KEY',env);self.assertEqual(env['DATABASE_URL'],'postgres://fixture_only:fixture_only@127.0.0.1:55487/fixture_only');self.assertEqual(env['MAIL_PROVIDER'],'dev');self.assertEqual(env['MAIL_PROVIDERS'],'dev')
  for name in ['CONTACT_BCC','RECIPIENTS','APPROVER_EMAIL','CRON_SECRET']:self.assertEqual(env[name],'')
  for name in ['SECRETS_DIR','PETICAO_CONFIG_DIR','CREDENTIALS_DIRECTORY','GEO_DIR']:self.assertEqual(env[name],'/qa/run/empty')

 def container(self,phase='created',network_id=''):
  obj=self.obj();obj.update(Image=r.IMAGE,State={'Status':phase,'Running':phase=='running'},HostConfig={'PortBindings':{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55487'}]},'Memory':512*1024**2,'NanoCpus':10**9,'PidsLimit':128,'ReadonlyRootfs':True,'Binds':None,'Tmpfs':{'/var/lib/postgresql/data':'rw,size=256m','/var/run/postgresql':'rw,size=16m','/tmp':'rw,size=16m'},'NetworkMode':'b'*64},NetworkSettings={'Networks':{'peticao-r0003-'+NONCE+'-net':{'NetworkID':network_id}}});return obj
 def test_created_empty_endpoint_is_valid_before_start(self):
  self.assertEqual(r.validate_container(self.container(),NONCE,'b'*64),ID)
  obj=self.container();obj['NetworkSettings']['Networks']={'b'*64:{'NetworkID':''}}
  self.assertEqual(r.validate_container(obj,NONCE,'b'*64),ID)
 def test_already_started_is_not_valid_before_start(self):
  with self.assertRaises(ValueError):r.validate_container(self.container('running','b'*64),NONCE,'b'*64)
 def test_foreign_network_rejected_before_start(self):
  with self.assertRaises(ValueError):r.validate_container(self.container('created','c'*64),NONCE,'b'*64)
 def test_poststart_requires_real_endpoint_running_and_same_id(self):
  for phase,network_id in [('created','b'*64),('running','')]:
   with self.subTest(phase=phase,network_id=network_id),self.assertRaises(ValueError):r.validate_container(self.container(phase,network_id),NONCE,'b'*64,phase='after_start',expected_cid=ID)
  self.assertEqual(r.validate_container(self.container('running','b'*64),NONCE,'b'*64,phase='after_start',expected_cid=ID),ID)
  with self.assertRaises(ValueError):r.validate_container(self.container('running','b'*64),NONCE,'b'*64,phase='after_start',expected_cid='f'*64)
 def test_cleanup_rejects_same_name_and_nonce_with_changed_id(self):
  calls=[]
  def fake(*args,**kwargs):calls.append(args);return mock.Mock(stdout='visible\n')
  with mock.patch.object(r,'docker',side_effect=fake),mock.patch.object(r,'inspect_owned',side_effect=lambda name,nonce,kind:self.container()if kind=='container'else self.obj('network')):
   result=r.cleanup(NONCE,expected_cid='d'*64,expected_nid='e'*64)
  self.assertEqual(len(result['cleanupErrors']),2);self.assertFalse(any('rm'in call for call in calls))
 def test_source_no_worker_context_or_shell_or_npm(self):
  text=(r.ROOT/'local_runner.py').read_text();ast.parse(text)
  self.assertNotIn('WorkerContext',text);self.assertNotIn('shell=True',text);self.assertNotIn('npm',text.replace("'npmExecuted':False",''));self.assertIn('LOCAL_REAL_ROUTE_QA_NOT_SANTIAGO',text)
 def test_node_guard_remains_frozen(self):
  registry=json.loads((r.ROOT/'local-registry.json').read_text());self.assertEqual(registry['harness_commit'],'58cb9ce6d90cfb5f8b7fe456810948a4c99bb6f9');self.assertEqual(registry['node_sha256'],'b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac')
  pins=json.loads((r.ROOT/'frozen-pins.json').read_text())
  for name,pin in pins.items():self.assertEqual(hashlib.sha256((r.ROOT/'frozen'/name).read_bytes()).hexdigest(),pin)
if __name__=='__main__':unittest.main()
