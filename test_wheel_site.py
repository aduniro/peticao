"""Fictitious ZIP fixtures only, actual local UID1000, no root-owner seam.

No real public wheel is derived here. Pin digests/sizes are monkeypatched to
four locally generated fixtures; distribution names remain the fixed names.
Payload .py files deliberately raise if imported; they are only copied as data.
"""
import base64
import copy
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import shutil
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

import wheel_site as producer

TMP=producer.PROJECT/'wheel-site-source/test-state/tmp'


def make_wheel(pin,additional=(),bad_record=False,duplicate=False,omit_record=False):
    package,version=pin['name'].split('-',2)[:2]
    dist=package+'-'+version+'.dist-info'
    data=[(package+'/__init__.py',b'raise RuntimeError("FIXTURE MUST NEVER IMPORT")',stat.S_IFREG|0o644),
          (dist+'/METADATA',('Metadata-Version: 2.1\nName: '+package+'\nVersion: '+version+'\n\n').encode(),stat.S_IFREG|0o644),
          (dist+'/WHEEL',b'Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n',stat.S_IFREG|0o644)]
    if package=='playwright':data.append(('playwright/driver/node',b'\x7fELFfixture-vendor-node-never-execute',stat.S_IFREG|0o755))
    data.extend(additional)
    rows=[]
    for name,value,mode in data:
        value_hash=base64.urlsafe_b64encode(hashlib.sha256(value).digest()).rstrip(b'=').decode()
        rows.append([name,'sha256='+('wrong' if bad_record else value_hash),str(len(value))])
    if not omit_record:
        rows.append([dist+'/RECORD','',''])
        text=io.StringIO();csv.writer(text,lineterminator='\n').writerows(rows)
        data.append((dist+'/RECORD',text.getvalue().encode(),stat.S_IFREG|0o644))
    if duplicate:data.append(data[0])
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_STORED) as archive:
        for name,value,mode in data:
            item=zipfile.ZipInfo(name);item.create_system=3;item.external_attr=mode<<16
            archive.writestr(item,value)
    return output.getvalue()


@unittest.skipUnless(os.geteuid()==1000,'producer intentionally supports actual UID1000 only')
class WheelSiteTests(unittest.TestCase):
    def setUp(self):
        TMP.parent.mkdir(mode=0o700,exist_ok=True);TMP.parent.chmod(0o700)
        TMP.mkdir(mode=0o700,exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(prefix='wheel-site-fixture-',dir=TMP)
        self.root=Path(self.tmp.name);self.inputs=self.root/'wheels';self.inputs.mkdir(mode=0o700)
        self.output=self.root/'python-wheel-site-1'
        self.pins=copy.deepcopy(list(producer.FIXED_WHEELS));self.source={}
        self.write_fixtures()
        self.patches=mock.patch.object(producer,'FIXED_WHEELS',tuple(self.pins));self.patches.start()

    def tearDown(self):
        self.patches.stop();self.tmp.cleanup()

    def write_fixtures(self,change=None):
        for index,pin in enumerate(self.pins):
            options=change(index) if change else {}
            value=make_wheel(pin,**options);path=self.inputs/pin['name']
            path.write_bytes(value);path.chmod(0o600)
            pin['sha256']=hashlib.sha256(value).hexdigest();pin['bytes']=len(value);self.source[path]=value

    def derive(self):return producer.derive(self.inputs,self.output)

    def test_complete_data_tree_manifest_and_source_records_preserved(self):
        receipt=self.derive();site=self.output/'sites'
        manifest=json.loads((self.output/'python-runtime.json').read_text())
        self.assertEqual(set(manifest),{'version','site_root','source_wheels','files'})
        self.assertEqual(manifest['site_root'],producer.FUTURE_SITE_ROOT)
        self.assertEqual(manifest['source_wheels'],self.pins)
        actual={}
        for path in site.rglob('*'):
            info=path.lstat()
            if path.is_dir():self.assertEqual(stat.S_IMODE(info.st_mode),0o700)
            else:
                self.assertTrue(stat.S_ISREG(info.st_mode));self.assertEqual(info.st_uid,1000)
                self.assertEqual(info.st_nlink,1);self.assertEqual(stat.S_IMODE(info.st_mode),0o600)
                actual[path.relative_to(site).as_posix()]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':info.st_size}
        self.assertEqual(actual,manifest['files'])
        for path,value in self.source.items():self.assertEqual(path.read_bytes(),value)
        for pin in self.pins:
            with zipfile.ZipFile(self.inputs/pin['name']) as archive:
                for item in archive.infolist():self.assertEqual((site/item.filename).read_bytes(),archive.read(item))
        self.assertIs(receipt['qualified'],False)
        self.assertIs(receipt['source_exit_stat_validated_before_manifest_and_receipt'],True)
        self.assertIs(receipt['source_wheel_and_RECORD_bytes_preserved'],True)
        self.assertEqual(receipt['projection_or_exclusions'],[])
        self.assertIs(receipt['mode0600_is_not_absolute_execution_denial'],True)
        self.assertIs(receipt['package_import_pip_install_entrypoint_or_vendor_elf_execution'],False)

    def test_vendor_node_kept_as_data_without_absolute_denial_claim(self):
        receipt=self.derive();node=self.output/'sites/playwright/driver/node'
        self.assertEqual(node.read_bytes(),b'\x7fELFfixture-vendor-node-never-execute')
        self.assertFalse(node.stat().st_mode&0o111)
        self.assertEqual(receipt['bundled_node'][0]['path'],'playwright/driver/node')
        self.assertIs(receipt['bundled_node'][0]['absolute_execution_prevention_claimed'],False)
        self.assertIs(receipt['native_proof_playwright_node_override'],False)
        self.assertEqual(receipt['required_future_native_override'],'PLAYWRIGHT_NODEJS_PATH=/opt/peticao-dev-profile-tools-v1/node20')

    def test_no_replay_and_prior_files_unchanged(self):
        self.derive();before=(self.output/'DERIVATION-RECEIPT.json').read_bytes()
        with self.assertRaises(FileExistsError):self.derive()
        self.assertEqual((self.output/'DERIVATION-RECEIPT.json').read_bytes(),before)

    def test_malformed_record_refused_before_output(self):
        self.write_fixtures(lambda i:{'bad_record':True} if i==1 else {})
        with self.assertRaisesRegex(producer.DerivationRejected,'record_hash'):self.derive()
        self.assertFalse(self.output.exists())

    def test_missing_record_refused_before_output(self):
        self.write_fixtures(lambda i:{'omit_record':True} if i==2 else {})
        with self.assertRaisesRegex(producer.DerivationRejected,'single_record'):self.derive()
        self.assertFalse(self.output.exists())

    def test_paths_pth_pyc_cache_dotenv_and_data_scheme_refused(self):
        cases=['../outside','/outside','C:/outside','pyee/../outside','pyee\\outside','pyee//outside',
               'pyee/load.pth','pyee/cache.pyc','pyee/__pycache__/module','pyee/.env','pyee/.env.example','pyee/secrets/file','pyee.data/scripts/tool']
        for name in cases:
            with self.subTest(name=name):
                self.write_fixtures(lambda i:{'additional':[(name,b'fixture',stat.S_IFREG|0o644)]} if i==2 else {})
                with self.assertRaises(producer.DerivationRejected):self.derive()
                self.assertFalse(self.output.exists())

    def test_symlink_and_special_metadata_refused(self):
        for mode in (stat.S_IFLNK|0o777,stat.S_IFIFO|0o600,stat.S_IFSOCK|0o600):
            self.write_fixtures(lambda i:{'additional':[('pyee/link-or-special',b'other',mode)]} if i==2 else {})
            with self.assertRaisesRegex(producer.DerivationRejected,'links_or_special'):self.derive()
            self.assertFalse(self.output.exists())

    def test_duplicate_zip_entries_refused(self):
        with __import__('warnings').catch_warnings():
            __import__('warnings').simplefilter('ignore',UserWarning)
            self.write_fixtures(lambda i:{'duplicate':True} if i==0 else {})
        with self.assertRaisesRegex(producer.DerivationRejected,'duplicate_zip_path'):self.derive()
        self.assertFalse(self.output.exists())

    def test_duplicate_paths_between_four_wheels_refused(self):
        self.write_fixtures(lambda i:{'additional':[('shared.py',b'fixture',stat.S_IFREG|0o644)]} if i in {0,2} else {})
        with self.assertRaisesRegex(producer.DerivationRejected,'duplicate_paths_between'):self.derive()
        self.assertFalse(self.output.exists())

    def test_parent_file_collision_refused_before_output(self):
        self.write_fixtures(lambda i:{'additional':[('shared',b'file',stat.S_IFREG|0o644),('shared/child',b'file',stat.S_IFREG|0o644)]} if i==0 else {})
        with self.assertRaisesRegex(producer.DerivationRejected,'beneath_nondirectory'):self.derive()
        self.assertFalse(self.output.exists())

    def test_hash_size_and_group_writable_inputs_refused(self):
        first=self.inputs/self.pins[0]['name'];value=first.read_bytes();first.write_bytes(value+b'x')
        with self.assertRaises((producer.DerivationRejected,PermissionError)):self.derive()
        first.write_bytes(value);first.chmod(0o620)
        with self.assertRaises(PermissionError):self.derive()
        self.assertFalse(self.output.exists())

    def test_same_fd_exit_stat_change_keeps_partial_without_completed_manifest(self):
        original=producer._copy;source=self.inputs/self.pins[0]['name']
        def change(stream,rows,site):
            original(stream,rows,site);source.chmod(0o640)
        with mock.patch.object(producer,'_copy',side_effect=change):
            with self.assertRaisesRegex(producer.DerivationRejected,'wheel_changed_before_exit'):self.derive()
        self.assertTrue((self.output/'INTENT.json').exists());self.assertTrue((self.output/'sites').exists())
        self.assertFalse((self.output/'python-runtime.json').exists());self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        with self.assertRaises(FileExistsError):self.derive()

    def test_io_failure_preserves_intent_and_partial_no_reinitialization(self):
        def fail(stream,rows,site):
            out=os.open('partial',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=site)
            os.write(out,b'partial');os.close(out);raise OSError('fixture_io_error')
        with mock.patch.object(producer,'_copy',side_effect=fail),self.assertRaises(OSError):self.derive()
        self.assertEqual((self.output/'sites/partial').read_bytes(),b'partial')
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        with self.assertRaises(FileExistsError):self.derive()

    def test_source_symlink_and_output_alias_rejected(self):
        path=self.inputs/self.pins[0]['name'];replacement=self.inputs/'saved';path.rename(replacement);path.symlink_to(replacement)
        with self.assertRaises(OSError):self.derive()
        path.unlink();replacement.rename(path)
        self.output.symlink_to(self.inputs,target_is_directory=True)
        with self.assertRaises(FileExistsError):self.derive()
        self.assertFalse((self.inputs/'INTENT.json').exists())

    def test_complete_site_verifier_rejects_injected_unknown_or_executable_data(self):
        original=producer._copy
        def change(stream,rows,site):
            original(stream,rows,site)
            if rows[0]['name'].startswith('greenlet/'):
                parent,leaf=producer._member_parent(site,rows[0]['name'])
                os.chmod(leaf,0o700,dir_fd=parent);os.close(parent)
        with mock.patch.object(producer,'_copy',side_effect=change),self.assertRaisesRegex(producer.DerivationRejected,'private_data_regular'):self.derive()
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())

    def test_global_budgets_are_bounded_before_output(self):
        with mock.patch.object(producer,'MAX_FILES',1),self.assertRaises(producer.DerivationRejected):self.derive()
        self.assertFalse(self.output.exists())
        with mock.patch.object(producer,'MAX_TOTAL',1),self.assertRaises(producer.DerivationRejected):self.derive()
        self.assertFalse(self.output.exists())

    def test_output_rename_replacement_never_gets_manifest_or_receipt(self):
        original=producer._copy;moved=self.root/'retained-original';injected=[]
        def replace(stream,rows,site):
            original(stream,rows,site)
            if not injected:
                injected.append(True);self.output.rename(moved);self.output.mkdir(mode=0o700)
                foreign=self.output/'foreign';foreign.write_bytes(b'untouched');foreign.chmod(0o600)
                injected.append(producer.signature(foreign.stat()))
        with mock.patch.object(producer,'_copy',side_effect=replace):
            with self.assertRaisesRegex(producer.DerivationRejected,'output_directory_identity_changed'):self.derive()
        self.assertEqual({item.name for item in self.output.iterdir()},{'foreign'})
        self.assertEqual((self.output/'foreign').read_bytes(),b'untouched')
        self.assertEqual(producer.signature((self.output/'foreign').stat()),injected[1])
        self.assertTrue((moved/'INTENT.json').exists());self.assertTrue((moved/'sites').is_dir())
        for directory in (self.output,moved):
            self.assertFalse((directory/'python-runtime.json').exists())
            self.assertFalse((directory/'DERIVATION-RECEIPT.json').exists())

    def test_parent_rename_replacement_fails_lexical_parent_identity(self):
        original=producer._copy;moved=self.root.with_name(self.root.name+'-retained-parent');injected=[]
        self.addCleanup(lambda:shutil.rmtree(moved) if moved.exists() else None)
        def replace(stream,rows,site):
            original(stream,rows,site)
            if not injected:
                injected.append(True);self.root.rename(moved);self.root.mkdir(mode=0o700)
                (self.root/'foreign').write_bytes(b'untouched')
        with mock.patch.object(producer,'_copy',side_effect=replace):
            with self.assertRaisesRegex(producer.DerivationRejected,'output_directory_identity_changed'):self.derive()
        self.assertEqual({item.name for item in self.root.iterdir()},{'foreign'})
        self.assertEqual((self.root/'foreign').read_bytes(),b'untouched')
        retained=moved/'python-wheel-site-1'
        self.assertTrue((retained/'INTENT.json').exists())
        self.assertFalse((retained/'python-runtime.json').exists())
        self.assertFalse((retained/'DERIVATION-RECEIPT.json').exists())

    def test_sites_rename_replacement_fails_original_site_identity(self):
        original=producer._copy;injected=[]
        def replace(stream,rows,site):
            original(stream,rows,site)
            if not injected:
                injected.append(True);(self.output/'sites').rename(self.output/'retained-sites')
                (self.output/'sites').mkdir(mode=0o700);(self.output/'sites/foreign').write_bytes(b'untouched')
        with mock.patch.object(producer,'_copy',side_effect=replace):
            with self.assertRaisesRegex(producer.DerivationRejected,'output_directory_identity_changed'):self.derive()
        self.assertEqual({item.name for item in (self.output/'sites').iterdir()},{'foreign'})
        self.assertEqual((self.output/'sites/foreign').read_bytes(),b'untouched')
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        self.assertFalse((self.output/'python-runtime.json').exists())

    def test_alias_after_manifest_is_rejected_before_receipt(self):
        original=producer._new_json;moved=self.root/'retained-after-manifest'
        def replace(fd,name,value):
            pin=original(fd,name,value)
            if name=='python-runtime.json':
                self.output.rename(moved);self.output.mkdir(mode=0o700)
                (self.output/'foreign').write_bytes(b'untouched')
            return pin
        with mock.patch.object(producer,'_new_json',side_effect=replace):
            with self.assertRaisesRegex(producer.DerivationRejected,'output_directory_identity_changed'):self.derive()
        self.assertTrue((moved/'python-runtime.json').exists())
        self.assertFalse((moved/'DERIVATION-RECEIPT.json').exists())
        self.assertEqual({item.name for item in self.output.iterdir()},{'foreign'})
        self.assertEqual((self.output/'foreign').read_bytes(),b'untouched')

    def test_alias_after_receipt_write_is_rejected_by_final_anchor_check(self):
        original=producer._new_json;moved=self.root/'retained-final-candidate'
        def replace(fd,name,value):
            pin=original(fd,name,value)
            if name=='DERIVATION-RECEIPT.json':
                self.output.rename(moved);self.output.mkdir(mode=0o700)
                (self.output/'foreign').write_bytes(b'untouched')
            return pin
        with mock.patch.object(producer,'_new_json',side_effect=replace):
            with self.assertRaisesRegex(producer.DerivationRejected,'output_directory_identity_changed'):self.derive()
        # Candidate bytes remain in the preserved original directory, but the
        # operation fails and never acknowledges completion or writes its alias.
        self.assertTrue((moved/'DERIVATION-RECEIPT.json').exists())
        self.assertEqual({item.name for item in self.output.iterdir()},{'foreign'})
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        self.assertEqual((self.output/'foreign').read_bytes(),b'untouched')

    def test_cli_has_no_pin_owner_or_execute_override_and_requires_action(self):
        base=['wheel_site','derive','--wheels-dir',str(self.inputs),'--output',str(self.output)]
        for argv in (['wheel_site'],base+['--expected-uid','0'],base+['--sha256','a'*64],base+['--execute']):
            with mock.patch.object(sys,'argv',argv),mock.patch('sys.stderr',new=io.StringIO()),mock.patch.object(producer,'derive') as derive:
                with self.assertRaises(SystemExit):producer.main()
                derive.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_manifest_and_receipt_pin_exact_output_and_umask_restored(self):
        prior=os.umask(0o022);os.umask(prior)
        receipt=self.derive();after=os.umask(prior);os.umask(after)
        self.assertEqual(prior,after)
        manifest=(self.output/'python-runtime.json').read_bytes()
        self.assertEqual(receipt['runtime_manifest'],{'sha256':hashlib.sha256(manifest).hexdigest(),'bytes':len(manifest)})
        self.assertEqual(receipt['producer_code_sha256'],hashlib.sha256(Path(producer.__file__).read_bytes()).hexdigest())
        fd=os.open(self.output/'sites',os.O_RDONLY|os.O_DIRECTORY)
        try:self.assertEqual(set(json.loads(manifest)['files']),set(producer._verify_site(fd,json.loads(manifest)['files'])))
        finally:os.close(fd)


if __name__=='__main__':unittest.main()
