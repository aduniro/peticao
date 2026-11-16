import copy
import json
from pathlib import Path
import tempfile
import unittest
from protocol import ValidationError, validate_job, validate_config, validate_branch, validate_result,validate_ready,canonical_sha256
from tests.helpers import fixture_config,job_data,result,ready,Clock

class ProtocolTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.c=fixture_config(self.root);self.job=job_data(self.c)
    def tearDown(self):self.tmp.cleanup()
    def test_spec_is_canonical_and_returns_detached_data(self):
        spec=validate_job(self.job,self.c);same=validate_job(dict(reversed(list(self.job.items()))),self.c);self.assertEqual(spec.payload_sha256,same.payload_sha256)
        spec.data['source']['commit']='9'*40;self.assertEqual(spec.data['source']['commit'],'1'*40)
    def test_live_paths_and_branch_names_are_always_rejected(self):
        for ref in ['main','master','production','deploy/x','refs/heads/main','integration/admin-v2-x..y','integration/admin-v2-x.lock','worker/admin-v2-x;echo']:
            with self.subTest(ref=ref),self.assertRaises(ValidationError):validate_branch(ref)
        for path in ['/opt/peticao/app','/home/adunir/peticao-stage/site','/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109','/var/lib/postgresql/base']:
            j=copy.deepcopy(self.job);j['source']['repository_path']=path
            with self.subTest(path=path),self.assertRaises(ValidationError):validate_job(j,self.c)
    def test_symlink_escape_does_not_turn_live_app_into_worker_repo(self):
        base=Path(self.c['hosts']['santiago']['repository_root']);base.mkdir();(base/'alias').symlink_to('/opt/peticao',target_is_directory=True)
        j=copy.deepcopy(self.job);j['source']['repository_path']=str(base/'alias/app')
        with self.assertRaises(ValidationError):validate_job(j,self.c)
    def test_no_arbitrary_env_commands_roles_or_retry(self):
        mutations=[lambda j:j['env'].update(API_KEY='FAKE'),lambda j:j.update(command='ssh production'),lambda j:j.update(target_worker='sao_paulo'),lambda j:j['safety'].update(automatic_retry=True),lambda j:j['safety'].update(production=0),lambda j:j['runtime'].update(assets_count=202.0),lambda j:j.update(schema_version=True),lambda j:j['runtime'].update(node_version='22.0.0')]
        for mutate in mutations:
            j=copy.deepcopy(self.job);mutate(j)
            with self.assertRaises(ValidationError):validate_job(j,self.c)
    def test_config_does_not_activate_production_or_write_state_into_app(self):
        for mutate in [lambda c:c['hosts']['sao_paulo'].update(enabled=True),lambda c:c.update(state_path='/opt/peticao/queue.sqlite'),lambda c:c['hosts']['santiago'].update(machine_id_sha256=None),lambda c:c['allowed_branch_prefixes'].append('main'),lambda c:c['required_checks'].update(qualification_delivery=['http']),lambda c:c.update(protected_paths=['/some/other/root'])]:
            c=copy.deepcopy(self.c);mutate(c)
            with self.assertRaises(ValidationError):validate_config(c)
    def test_result_requires_exact_commit_complete_checks_real_hashes_and_owned_artifacts(self):
        row={'claim_id':'00000000-0000-4000-8000-000000000001','generation':1};r=result(self.c,self.job,row);spec=validate_job(self.job,self.c)
        self.assertEqual(validate_result(spec,r,self.c,self.c['artifact_root']),r)
        for mutate in [lambda v:v.update(commit='9'*40),lambda v:v.update(build_commit='8'*40),lambda v:v['checks'].update(data_invariants=False),lambda v:v['coverage'].pop(),lambda v:v['artifacts'][0].update(path='../execution.json'),lambda v:v['artifacts'][0].update(sha256='0'*64)]:
            v=copy.deepcopy(r);mutate(v)
            with self.assertRaises(ValidationError):validate_result(spec,v,self.c,self.c['artifact_root'])
        (Path(self.c['artifact_root'])/r['execution_artifact']).write_text('{}')
        with self.assertRaises(ValidationError):validate_result(spec,r,self.c,self.c['artifact_root'])

    def test_ready_can_bind_local_transport_but_never_production(self):
        clock=Clock();h=ready(self.c,clock);h.update(worker_id='local',role='coordinator',repository_root=self.c['hosts']['local']['repository_root'])
        self.assertEqual(validate_ready(h,self.c,clock())['worker_id'],'local')
        h['worker_id']='sao_paulo';h['role']='production_read_only';h['repository_root']=None
        with self.assertRaises(ValidationError):validate_ready(h,self.c,clock())
