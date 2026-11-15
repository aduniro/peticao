import copy
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock
import bundle_builder as b

class PublicInputTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=b.HERE,prefix='bundle-fixture-');self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def file(self,name,data):
        p=self.root/name;b.newfile(p,data);return dict(b.pin(data),path=str(p))
    def tar(self,entries):
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w:gz')as t:
            for name,data in entries:
                m=tarfile.TarInfo(name);m.size=len(data);t.addfile(m,io.BytesIO(data))
        return self.file('public.tar.gz',out.getvalue())
    def test_same_fd_input_rejects_content_replacement_and_symlink(self):
        ref=self.file('source',b'first')
        with self.assertRaises(PermissionError):
            with b.source(ref):
                path=Path(ref['path']);path.rename(self.root/'original');b.newfile(path,b'first')
        Path(ref['path']).unlink();Path(ref['path']).symlink_to(self.root/'original')
        with self.assertRaises(OSError):b.raw(ref)
    def test_identity_pin_and_input_hash_are_both_enforced(self):
        ref=self.file('source',b'first');ref['source_identity']=list(b.signature(Path(ref['path']).stat()));self.assertEqual(b.raw(ref),b'first')
        ref['source_identity'][1]+=1
        with self.assertRaises(PermissionError):b.raw(ref)
        del ref['source_identity'];ref['sha256']='0'*64
        with self.assertRaises(ValueError):b.raw(ref)
    def test_exclusive_new_files_never_overwrite(self):
        ref=self.file('kept',b'original');ino=Path(ref['path']).stat().st_ino
        with self.assertRaises(FileExistsError):b.newfile(ref['path'],b'changed')
        self.assertEqual(Path(ref['path']).stat().st_ino,ino);self.assertEqual(b.raw(ref),b'original')
    def test_exact_public_member_is_data_only_mode600(self):
        ref=self.tar([('package/a',b'public'),('package/b',b'other')]);target=self.root/'projected';pin=b.pin(b'public');result=b.copy_member(ref,'package/a',pin,target)
        self.assertEqual(b.raw(result),b'public');self.assertEqual(target.stat().st_mode&0o777,0o600)
    def test_duplicate_or_wrong_member_fails_preserving_partial(self):
        ref=self.tar([('package/a',b'public'),('package/a',b'public')]);target=self.root/'partial'
        with self.assertRaises(ValueError):b.copy_member(ref,'package/a',b.pin(b'public'),target)
        self.assertEqual(target.read_bytes(),b'public')
        with self.assertRaises(FileExistsError):b.copy_member(ref,'package/a',b.pin(b'public'),target)
    def test_release_gate_uses_actual_ack_schema_and_never_fabricates_it(self):
        expected=json.loads((b.HERE/'RELEASE-EXPECTED.json').read_bytes())
        event={'seq':3435,'actor':'admin-recuperacao','data':expected,'kind':'notice'}
        ack={'seq':3441,'actor':'apoio','kind':'ack','data':{'event_seq':3435}}
        def output(events):return mock.Mock(stdout=json.dumps({'result':events}))
        with mock.patch.object(b.subprocess,'run',return_value=output([event])):
            with self.assertRaises(PermissionError):b.check_release()
        with mock.patch.object(b.subprocess,'run',return_value=output([event,ack])):b.check_release()
        invalid=copy.deepcopy(event);invalid['data']['host_execution_authorized']=True
        with mock.patch.object(b.subprocess,'run',return_value=output([invalid,ack])):
            with self.assertRaises(PermissionError):b.check_release()

class ActualPinnedPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec=json.loads((b.HERE/'BUILD-SPEC.json').read_bytes());cls.contract,cls.sealed,cls.freeze=b.reviewed_modules(cls.spec)
    def inputs(self):
        spec=self.spec;family=json.loads(b.raw(spec['verified_family_inventory']))
        files={name:{k:row[k]for k in ('sha256','bytes')}for name,row in family['files'].items()}
        files['node20']={k:spec['node'][k]for k in ('sha256','bytes')}
        files['pdfjs/package.tgz']={'sha256':spec['pdfjs']['tar_sha256'],'bytes':spec['pdfjs']['tar_bytes']}
        files.update({name:{k:row[k]for k in ('sha256','bytes')}for name,row in spec['source_wheels'].items()})
        helpers={n:b.pin(b.raw(ref))for n,ref in spec['helpers'].items()};qa={n:b.pin(b.raw(ref))for n,ref in spec['qa'].items()};qa['qa/python-runtime.json']=b.pin(b.raw(spec['qa_runtime_override']))
        proof=json.loads(b.raw(spec['inputs']['inputs/full-integrity-proof.json']))
        return files,helpers,qa,proof
    def test_real_pinned_policy_and_pure_render_have_three_not_qualified_candidates(self):
        args=self.inputs();policy=b.policy_for(self.contract,self.sealed,self.spec,*args)
        rendered=self.freeze.render(b.raw(self.spec['reviewed_render_source']['driver.py']),policy,args[1]['sealed_policy.py']['sha256'])
        self.assertEqual(set(rendered),{'driver.py','driver-policy.json','catalog.candidates.json'})
        self.assertNotIn(b"POLICY_SHA256 = '0' * 64",rendered['driver.py']);self.assertFalse(policy['qualified']);self.assertFalse(policy['operationalReady'])
        self.assertEqual(policy['qualification_release_event'],3435)
        self.assertIn('pdfjs/package.tgz',policy['toolchain_inventory']['files'])
        self.assertEqual(len([n for n in args[0]if n.endswith('.whl')]),4)
    def test_missing_source_wheel_or_python_inventory_file_is_rejected(self):
        for member in ('python-wheels/'+self.spec['source_wheels'].__iter__().__next__().split('/',1)[1],next(n for n in self.inputs()[0]if n.startswith('python-wheels/site/'))):
            files,helpers,qa,proof=self.inputs();files.pop(member)
            with self.assertRaises(PermissionError):b.policy_for(self.contract,self.sealed,self.spec,files,helpers,qa,proof)

if __name__=='__main__':unittest.main()
