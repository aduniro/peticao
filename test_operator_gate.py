from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import operator_gate as gate


class ImmutableDeployment(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.source=Path(self.tmp.name);self.policy='a'*64;self.commit='b'*40
        self.request={'method':'POST','path':'/v2/instances','payload':{'size':'g4c.medium','count':1}}
        self.files=['provision_steps.py','deploy_permit.py','operator_gate.py','durable_api.py',
                    'financial_guard.py','financial_runtime.py','runtime_main.py','exclusive_inventory.py',
                    'usage_observer.py','ssh_adapter.py','worker_lifecycle.py','queue_finance.py',
                    'cloud_step.py','cloud_receipt.py','operator_driver.py']
        hashes={}
        for name in self.files:
            (self.source/name).write_text('# source fixture\n')
            hashes[name]=hashlib.sha256((self.source/name).read_bytes()).hexdigest()
        self.cap=self.source/'cap.private.json';self.cap.write_text(json.dumps({'lease':'fake-test-lease','token':'test-only','fence':7,'seq':42}))
        self.notice={'seq':17,'kind':'notice','resources':[gate.DESTINATION],
                     'data':{'manifest':{'commit':self.commit,'files':self.files},'file_sha256':hashes,
                             'civo_deployment':{'policy_sha256':self.policy,'allowed_requests':[self.request]}}}
        self.cli_patch=patch.object(gate,'cli',side_effect=self.cli);self.cli_patch.start();self.addCleanup(self.cli_patch.stop)
        self.git_patch=patch.object(gate.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=self.commit+'\n'));self.git_patch.start();self.addCleanup(self.git_patch.stop)
    def cli(self,args):
        if args[0]=='check':return {'checked':True}
        if args[0]=='status':return {'leases':[{'id':'fake-test-lease','state':'active','operation':'deploy',
                  'resources':[gate.DESTINATION], 'expires':datetime.now(timezone.utc).timestamp()+600}]}
        if args[0]=='history' and args[2]=='41':return [{'data':{'manifest_event':17}}]
        if args[0]=='history' and args[2]=='16':return [self.notice]
        raise AssertionError(args)
    def issue(self,request=None,policy=None):
        return gate.issue(self.cap,17,self.source,request or self.request,policy or self.policy)
    def test_exact_reviewed_config_and_request_can_issue_bounded_permit(self):
        permit=self.issue()
        self.assertEqual(permit['policy_sha256'],self.policy)
        self.assertNotIn('token',permit)
    def test_same_code_cannot_authorize_different_policy(self):
        with self.assertRaisesRegex(ValueError,'policy digest'):self.issue(policy='c'*64)
    def test_same_code_cannot_authorize_different_resource_request(self):
        with self.assertRaisesRegex(ValueError,'request set'):
            self.issue(request={'method':'POST','path':'/v2/instances','payload':{'size':'gpu','count':1}})
    def test_missing_request_binding_is_not_inferred_from_source_review(self):
        del self.notice['data']['civo_deployment']['allowed_requests']
        with self.assertRaises(ValueError):self.issue()
    def test_source_drift_still_blocks_matching_config(self):
        (self.source/'durable_api.py').write_text('# changed')
        with self.assertRaisesRegex(ValueError,'hash mismatch'):self.issue()


if __name__=='__main__':unittest.main()
