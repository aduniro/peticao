import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import runtime_main as main


@unittest.skipUnless(os.geteuid()==0,'Root-owned runtime policy tests run in isolated cloud QA')
class RootPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.source=self.root/'source';self.source.mkdir(mode=0o700)
        self.patch=patch.object(main,'SOURCE',self.source);self.patch.start();self.addCleanup(self.patch.stop)
        files=['runtime_main.py','durable_api.py','financial_guard.py','financial_runtime.py','usage_observer.py','ssh_adapter.py','exclusive_inventory.py']
        hashes={}
        for name in files:
            p=self.source/name;p.write_text('# test fixture only\n');p.chmod(0o500)
            hashes[name]=hashlib.sha256(p.read_bytes()).hexdigest()
        self.policy=self.root/'policy.json'
        self.policy.write_text(json.dumps(dict(state='reviewed-active',scope='owned-civo-lifecycle-only',region='NYC1',
                new_resource_creation_allowed=False,deployment_manifest_event=1,
                required_reviewers=['admin-recuperacao','apoio'],source_sha256=hashes)))
        self.policy.chmod(0o600);self.sha=hashlib.sha256(self.policy.read_bytes()).hexdigest()

    def test_default_dry_run_never_constructs_api_client(self):
        with patch.object(main,'Api',side_effect=AssertionError('API must not be constructed')):
            result=main.run(SimpleNamespace(policy=self.policy,policy_sha256=self.sha,execute_cleanup=False))
        self.assertEqual(result['api_mutations'],0)

    def test_changed_source_blocks_even_dry_run(self):
        p=self.source/'durable_api.py';p.chmod(0o600);p.write_text('# changed')
        with self.assertRaises(ValueError):main.read_policy(self.policy,self.sha)

    def test_wrong_policy_digest_cannot_activate_authority(self):
        with self.assertRaises(ValueError):main.read_policy(self.policy,'0'*64)

    def test_policy_readable_by_other_users_is_rejected(self):
        self.policy.chmod(0o644)
        with self.assertRaises(ValueError):main.read_policy(self.policy,self.sha)


if __name__=='__main__':unittest.main()
