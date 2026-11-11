import unittest,json,ast,hashlib
from pathlib import Path
from unittest import mock
import local_controller as c, docker_control as d
ROOT=Path(__file__).parent
NONCE='012345abcdef';CID='c'*64;NID='b'*64
class LocalHistoryTests(unittest.TestCase):
 def test_no_worker_identity_in_sources(self):
  for name in ['local_controller.py','functional_smoke.py','docker_control.py']:
   text=(ROOT/name).read_text();ast.parse(text);self.assertNotIn('WorkerContext',text);self.assertNotIn('from executor_context',text);self.assertNotIn('from native_pg',text)
 def test_controller_bridge_loopback_limits(self):
  args=d.container_args(NONCE,NID);self.assertIn('127.0.0.1:55485:5432',args);self.assertIn('cluster_name='+NONCE,args);self.assertIn('--pull=never',args);self.assertIn('--memory=512m',args);self.assertIn('--cpus=1',args);self.assertNotIn('--mount',args);self.assertNotIn('--volume',args);self.assertNotIn('--internal',d.network_args(NONCE))
 def test_scope_exact19_and_two_successful_logins(self):
  self.assertEqual(len(c.EXPECTED_CHECKS),19);self.assertEqual(dict(c.EXPECTED_CHECKS)['synthetic owner login'],303);self.assertEqual(dict(c.EXPECTED_CHECKS)['reader login'],303);self.assertEqual(dict(c.EXPECTED_CHECKS)['wrong password'],303)
  text=(ROOT/'functional_smoke.py').read_text();self.assertIn("result['syntheticStepup']=fixture('stepup-fixture')",text);self.assertIn("result['readerStepup']=fixture('stepup-fixture')",text)
 def test_real_container_namespace_not_native_host(self):
  text=(ROOT/'functional_smoke.py').read_text();guard=(ROOT/'functional-guard.mjs').read_text();self.assertIn("'FUNCTIONAL_PGDATA':'/var/lib/postgresql/data'",text);self.assertIn("assert.equal(process.env.FUNCTIONAL_PGDATA, '/var/lib/postgresql/data')",guard)
 def test_only_guard_namespace_assert_changed(self):
  prov=json.loads((ROOT/'PROVENANCE.json').read_text());self.assertTrue(prov['httpBlockByteIdentical']);self.assertTrue(prov['fixtureByteIdentical'])
  guard=(ROOT/'functional-guard.mjs').read_text();old=guard.replace("assert.equal(process.env.FUNCTIONAL_PGDATA, '/var/lib/postgresql/data');","assert.equal(process.env.FUNCTIONAL_PGDATA, run + '/postgres');")
  self.assertEqual(hashlib.sha256(old.encode()).hexdigest(),'c36d4cdfbf7c892f3696b1a5e2521955651a7057eb6cd33783d36724a00ee62f')
 def test_no_second_runtime_extraction_or_copy(self):
  text=(ROOT/'functional_smoke.py').read_text();self.assertEqual(text.count("shutil.copytree(RUNTIME_SOURCE,run/'runtime')"),1);self.assertNotIn('extract_verified',text);self.assertIn('statfs.f_bavail',text)
 def test_cancel_during_work_raises_and_cleanup_records(self):
  state=c.CancellationState()
  with self.assertRaises(c.Cancelled):state.handle(15,None)
  state.cleaning=True;state.handle(15,None);self.assertEqual(state.signals,2)
 def test_replaced_known_id_never_removed(self):
  obj={'Id':CID,'Name':'/peticao-r0004-'+NONCE+'-pg','Image':d.IMAGE,'Config':{'Labels':d.owned_labels(NONCE)}}
  with mock.patch.object(d,'docker',return_value=mock.Mock(stdout='visible\n'))as docker,mock.patch.object(d,'inspect_owned',return_value=obj):result=d.cleanup(NONCE,expected_cid='d'*64,expected_nid=NID)
  self.assertIn('cleanupErrors',result);self.assertFalse(any('rm'in call.args for call in docker.call_args_list))
 def test_remaining_unknown_create_never_becomes_clean_success(self):
  pg=c.DockerPG(ROOT/'runs'/NONCE,NONCE,'/fake',{},Path('/fake/node'),{});pg.attempted=True;pg.uncertain=True
  with mock.patch.object(d,'cleanup',return_value={'containerAbsent':True,'networkAbsent':True}),mock.patch.object(c.socket,'socket')as sock:
   sock.return_value.__enter__.return_value.connect_ex.return_value=111;result=pg.stop()
  self.assertFalse(result['stopped']);self.assertTrue(result['requiresManualDockerReconciliation'])

 def pg(self):return c.DockerPG(ROOT/'runs'/NONCE,NONCE,'/fake',{},Path('/fake/node'),{})
 def handshake(self):return {'version':'170011','cluster':NONCE,'database':'fixture_only','dataDirectory':'/var/lib/postgresql/data','containerPort':5432}
 def test_host_nonce_mismatch_fails_before_schema(self):
  pg=self.pg();pg.started=True;expected=self.handshake()
  with mock.patch.object(pg,'fence'),mock.patch.object(pg,'sql',return_value=json.dumps(expected)),mock.patch.object(c.subprocess,'run',return_value=mock.Mock(stdout=json.dumps({**expected,'cluster':'foreign'}))):
   with self.assertRaisesRegex(ValueError,'HOST TCP'):pg.bootstrap()
 def test_bootstrap_before_start_never_calls_sql_or_node(self):
  pg=self.pg()
  with mock.patch.object(pg,'fence'),mock.patch.object(pg,'sql')as sql,mock.patch.object(c.subprocess,'run')as node:
   with self.assertRaises(ValueError):pg.bootstrap()
  sql.assert_not_called();node.assert_not_called()
 def test_start_reinspects_running_exact_cid_before_return(self):
  pg=self.pg();pg.cid=CID;pg.nid=NID
  with mock.patch.object(pg,'fence'),mock.patch.object(d,'docker')as docker,mock.patch.object(d,'inspect_owned',return_value={'mock':True})as inspect,mock.patch.object(d,'validate_container')as validate:
   pg.start()
  docker.assert_called_once_with('start',CID,timeout=20);inspect.assert_called_once();validate.assert_called_once_with({'mock':True},NONCE,NID,phase='after_start',expected_cid=CID);self.assertTrue(pg.started)
 def test_fixed_snapshot_config_local_flag(self):
  cfg=json.loads((ROOT/'config.json').read_text());self.assertTrue(cfg['local_only']);self.assertFalse(cfg['workerJob']);self.assertTrue(cfg['expected_cgroup'].endswith('/'+c.UNIT));self.assertEqual(cfg['node_sha256'],'b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac')
if __name__=='__main__':unittest.main()
