from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest
from tests.helpers import ROOT,fixture_config,job_data

class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.c=fixture_config(self.root,False)
        self.config=self.root/'config.json';self.config.write_text(json.dumps(self.c));self.job=self.root/'job.json';self.job.write_text(json.dumps(job_data(self.c)))
    def tearDown(self):self.tmp.cleanup()
    def run_cli(self,*args):
        r=subprocess.run([sys.executable,str(ROOT/'cli.py'),'--config',str(self.config),*args],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(r.stderr,'');return r.returncode,json.loads(r.stdout)
    def test_status_and_default_dry_run_do_not_create_state(self):
        code,value=self.run_cli('status');self.assertEqual(code,0);self.assertFalse(value['exists'])
        code,value=self.run_cli('enqueue','--job',str(self.job));self.assertEqual(code,0);self.assertTrue(value['dry_run']);self.assertFalse(value['local_metadata_changed']);self.assertFalse(Path(self.c['state_path']).exists())
        code,value=self.run_cli('validate','--job',str(self.job));self.assertEqual(code,0);self.assertTrue(value['valid_protocol']);self.assertFalse(value['provenance_verified'])
    def test_local_apply_only_queues_metadata_and_disabled_claim_cannot_execute(self):
        job_id=json.loads(self.job.read_text())['job_id'];code,value=self.run_cli('enqueue','--job',str(self.job),'--apply-local');self.assertEqual(code,0);self.assertEqual(value['job']['status'],'ready');self.assertFalse(value['remote_execution'])
        code,value=self.run_cli('claim','--job-id',job_id,'--worker','santiago','--expected-version','1','--apply-local');self.assertEqual(code,2);self.assertEqual(value['error'],'activation_disabled')
        _,status=self.run_cli('status');self.assertEqual(status['jobs'][0]['status'],'ready');self.assertEqual(status['jobs'][0]['generation'],0)
    def test_duplicate_json_keys_and_production_target_are_rejected(self):
        self.job.write_text('{"schema_version":1,"schema_version":1}')
        code,value=self.run_cli('validate','--job',str(self.job));self.assertEqual(code,2);self.assertEqual(value['error'],'duplicate_json_key')
        value=job_data(self.c);value['target_worker']='sao_paulo';self.job.write_text(json.dumps(value));code,value=self.run_cli('validate','--job',str(self.job));self.assertEqual(code,2)
        self.assertFalse(Path(self.c['state_path']).exists())
