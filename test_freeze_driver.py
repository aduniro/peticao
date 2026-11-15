"""Pure candidate rendering and mocked public inputs; never install/execute."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import driver_contract as c
import freeze_driver as f
import sealed_policy as s

TMP = Path('/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp')


def complete_policy():
    value = s.template()
    deps = c.dependencies_reference()
    deps['normalized_archive'].update(sha256='a'*64, bytes=12345)
    for row in deps['toolchain'].values():
        if row['sha256'] is None: row['sha256'] = 'b'*64
        if row['bytes'] is None: row['bytes'] = 10
    value['helpers'] = {name: {'sha256':'c'*64,'bytes':1} for name in s.HELPERS}
    value['qa_inventory'] = {name: {'sha256':'d'*64,'bytes':1} for name in s.QA_FILES}
    value['toolchain_inventory']['files'] = {row['path'][len(c.TOOLS)+1:]:{key:row[key] for key in ('sha256','bytes')} for row in deps['toolchain'].values()}
    deps['normalization_receipt_sha256'] = 'e'*64
    deps['qa_closure_sha256'] = c.digest(value['qa_inventory'])
    deps['toolchain_inventory_sha256'] = c.digest(value['toolchain_inventory'])
    deps['full_integrity_attestation'] = {'manifest_event':42,'inventory_sha256':'f'*64,'evidence_sha256':'e'*64}
    value.update(execution_enabled=True, qualification_release_event=43, dependencies_ref=deps)
    value['plans'] = {kind:c.plan(kind,deps) for kind in c.KINDS}
    return value


class Freeze(unittest.TestCase):
    def setUp(self):
        self.template = Path(__file__).with_name('driver.py').read_bytes()
        self.policy = complete_policy()

    def test_render_binds_policy_and_program_without_self_hash_cycle(self):
        files = f.render(self.template, self.policy, 'c'*64)
        self.assertEqual(set(files), {'driver.py','driver-policy.json','catalog.candidates.json'})
        program_sha = hashlib.sha256(files['driver.py']).hexdigest()
        policy_sha = hashlib.sha256(files['driver-policy.json']).hexdigest()
        self.assertIn(("POLICY_SHA256 = '" + policy_sha + "'").encode(), files['driver.py'])
        self.assertNotIn(b"POLICY_SHA256 = '0' * 64", files['driver.py'])
        self.assertNotIn(program_sha.encode(), files['driver-policy.json'])
        for item in json.loads(files['catalog.candidates.json']).values():
            self.assertIs(item['qualified'], False); self.assertIs(item['operationalReady'],False)
            self.assertEqual(item['worker_descriptor']['program_sha256'],program_sha)
            self.assertEqual(item['profile_sha256'], c.digest(item['worker_descriptor']))

    def test_incomplete_or_unreleased_policy_cannot_render(self):
        for policy in (s.template(), {**self.policy,'execution_enabled':False},
                       {**self.policy,'qualification_release_event':None},
                       {**self.policy,'qualification_release_event':True}):
            with self.subTest(policy=policy.get('qualification_release_event')):
                with self.assertRaises((ValueError, PermissionError)):
                    f.render(self.template, policy, 'c'*64)

    def test_marker_missing_or_duplicate_refused(self):
        for raw in (self.template.replace(b"POLICY_SHA256 = '0' * 64",b'POLICY_SHA256 = None'),
                    self.template + b"\nPOLICY_SHA256 = '0' * 64\n"):
            with self.assertRaises(ValueError): f.render(raw,self.policy,'c'*64)

    def test_verifier_and_plan_substitution_refused(self):
        with self.assertRaises(ValueError): f.render(self.template,self.policy,'d'*64)
        value = copy.deepcopy(self.policy); value['plans']['admin-build-v1']['layout']['tmp']='elsewhere'
        with self.assertRaises(ValueError): f.render(self.template,value,'c'*64)

    def test_render_does_not_mutate_policy(self):
        before = copy.deepcopy(self.policy); f.render(self.template,self.policy,'c'*64)
        self.assertEqual(before,self.policy)

    def test_producer_exclusive_outputs_and_no_install(self):
        with tempfile.TemporaryDirectory(dir=TMP,prefix='freeze-') as temp:
            out=Path(temp)/'candidate'; raw=(c.canonical(self.policy)+'\n').encode()
            with mock.patch.object(s,'read_verified',side_effect=[self.template,raw]) as reader, mock.patch.object(s,'verify_closure') as verifier:
                result=f.produce('/public/template.py','a'*64,'/public/policy.json','b'*64,out)
            self.assertEqual(reader.call_count,2); verifier.assert_called_once()
            self.assertEqual(result['classification'],'PINNED_CANDIDATES_NOT_INSTALLED_NOT_QUALIFIED')
            self.assertIs(result['qualified'],False)
            for path in out.iterdir(): self.assertEqual(path.stat().st_mode & 0o777,0o600)
            with mock.patch.object(s,'read_verified',side_effect=[self.template,raw]), mock.patch.object(s,'verify_closure'):
                with self.assertRaises(FileExistsError): f.produce('/public/template.py','a'*64,'/public/policy.json','b'*64,out)

    def test_closure_refusal_precedes_output(self):
        with tempfile.TemporaryDirectory(dir=TMP,prefix='freeze-denied-') as temp:
            out=Path(temp)/'candidate'; raw=(c.canonical(self.policy)+'\n').encode()
            with mock.patch.object(s,'read_verified',side_effect=[self.template,raw]), mock.patch.object(s,'verify_closure',side_effect=PermissionError('pending')):
                with self.assertRaises(PermissionError): f.produce('/public/template.py','a'*64,'/public/policy.json','b'*64,out)
            self.assertFalse(out.exists())

    def test_output_swap_cannot_redirect_privileged_writes(self):
        with tempfile.TemporaryDirectory(dir=TMP,prefix='freeze-swap-') as temp:
            parent=Path(temp); out=parent/'candidate'; moved=parent/'preserved'; foreign=parent/'foreign'
            foreign.mkdir(); raw=(c.canonical(self.policy)+'\n').encode()
            real_open=os.open; swapped=False
            def swap(path, flags, *args, **kwargs):
                nonlocal swapped
                if path=='driver.py' and kwargs.get('dir_fd') is not None and not swapped:
                    swapped=True; out.rename(moved); out.symlink_to(foreign,target_is_directory=True)
                return real_open(path,flags,*args,**kwargs)
            with mock.patch.object(s,'read_verified',side_effect=[self.template,raw]), mock.patch.object(s,'verify_closure'), mock.patch.object(os,'open',side_effect=swap):
                with self.assertRaisesRegex(PermissionError,'replaced'):
                    f.produce('/public/template.py','a'*64,'/public/policy.json','b'*64,out)
            self.assertTrue(swapped)
            self.assertEqual(list(foreign.iterdir()),[])
            self.assertTrue((moved/'driver.py').is_file())


if __name__=='__main__': unittest.main()
