"""Fictitious public ZIP/metadata fixtures only, actual UID1000, no Root seam.

No real Chrome ZIP is opened/materialized by these tests. Fake ELF bytes are
never executed and no browser/vendor code is imported.
"""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

import browser_copy as producer

TMP=Path(__file__).resolve().parent/'test-state/tmp'
ROWS=[('chrome-linux64/chrome',b'\x7fELFfake-chrome-never-execute',stat.S_IFREG|0o755),
      ('chrome-linux64/resources/',b'',stat.S_IFDIR|0o755),
      ('chrome-linux64/resources/credits',b'public fixture credits',stat.S_IFREG|0o644),
      ('chrome-linux64/locales/en-US.pak',b'fake locale data',stat.S_IFREG|0o644),
      ('chrome-linux64/libEGL.so',b'\x7fELFfake-library-never-load',stat.S_IFREG|0o755)]


def fixtures(rows):
    raw=io.BytesIO();data={name:value for name,value,mode in rows}
    with zipfile.ZipFile(raw,'w',compression=zipfile.ZIP_STORED) as archive:
        for name,value,mode in rows:
            info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=mode<<16;archive.writestr(info,value)
    payload=raw.getvalue();entries=[]
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for info in archive.infolist():
            directory=info.is_dir()
            entries.append({'path':info.filename,'canonical_path':info.filename.rstrip('/') if directory else info.filename,
                'bytes':info.file_size,'compressed_bytes':info.compress_size,'crc32_expected_hex':format(info.CRC,'08x'),
                'crc32_verified':True,'create_system':info.create_system,'kind':'directory' if directory else 'file',
                'path_safe':True,'sha256':None if directory else hashlib.sha256(data[info.filename]).hexdigest(),
                'unix_mode_octal':oct(info.external_attr>>16)})
    counts={'members':len(entries),'regular_files':sum(row['kind']=='file' for row in entries),
            'directories':sum(row['kind']=='directory' for row in entries),'unpacked_bytes':sum(row['bytes'] for row in entries)}
    document={'version':1,'archive':{'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload)},'counts':counts,'inventory':entries,
              'classifications':{key:[] for key in ('unsafe_paths','duplicate_paths','symlinks','special_or_type_conflicts','privileged_modes_require_review')},
              'qualified':False,'operationalReady':False}
    return payload,document


@unittest.skipUnless(os.geteuid()==1000,'intentional actual local UID1000 requirement')
class BrowserCopyTests(unittest.TestCase):
    def setUp(self):
        TMP.parent.mkdir(mode=0o700,exist_ok=True);TMP.mkdir(mode=0o700,exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(prefix='browser-copy-fixture-',dir=TMP);self.root=Path(self.tmp.name)
        self.archive=self.root/'public.zip';self.inventory=self.root/'BROWSER-INPUTS.json';self.output=self.root/'browser-data-1'
        self.patcher=None;self.prepare()

    def tearDown(self):
        if self.patcher:self.patcher.stop()
        self.tmp.cleanup()

    def prepare(self,rows=ROWS,change=None):
        if self.patcher:self.patcher.stop()
        payload,document=fixtures(rows)
        if change:change(document)
        raw=json.dumps(document,sort_keys=True).encode()
        self.archive.write_bytes(payload);self.archive.chmod(0o600);self.inventory.write_bytes(raw);self.inventory.chmod(0o600)
        main=next((row for row in document['inventory'] if row['canonical_path']=='chrome-linux64/chrome'),None)
        self.document=document
        self.patcher=mock.patch.multiple(producer,ARCHIVE_SHA256=hashlib.sha256(payload).hexdigest(),ARCHIVE_BYTES=len(payload),
            INPUTS_SHA256=hashlib.sha256(raw).hexdigest(),INPUTS_BYTES=len(raw),EXPECTED_COUNTS=copy.deepcopy(document['counts']),
            CHROME_SHA256=main['sha256'] if main else 'a'*64,CHROME_BYTES=main['bytes'] if main else 1)
        self.patcher.start()

    def derive(self):return producer.derive(self.archive,self.inventory,self.output)

    def test_complete_new_data_tree_preserves_all_vendor_bytes_and_manifest(self):
        source=self.archive.read_bytes();receipt=self.derive();root=self.output/'chromium'
        manifest=json.loads((self.output/'BROWSER-DATA-MANIFEST.json').read_text());actual={}
        for path in root.rglob('*'):
            i=path.lstat()
            if path.is_dir():self.assertEqual(stat.S_IMODE(i.st_mode),0o700)
            else:
                self.assertEqual(stat.S_IMODE(i.st_mode),0o600);self.assertEqual(i.st_nlink,1);self.assertEqual(i.st_uid,1000)
                actual[path.relative_to(root).as_posix()]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':i.st_size}
        self.assertEqual(actual,manifest['files']);self.assertEqual(self.archive.read_bytes(),source)
        self.assertEqual(manifest['future_chromium_root'],'/opt/peticao-dev-profile-tools-v1/chromium')
        for name,value,mode in ROWS:
            if not stat.S_ISDIR(mode):self.assertEqual((root/name).read_bytes(),value)
        self.assertIs(receipt['vendor_bytes_retained'],True);self.assertEqual(receipt['vendor_content_projection_or_exclusions'],[])
        for key in ('qualified','operationalReady','Root_installation','Chrome_Native','package_import_execution_or_browser_launch','library_symlink_aliases_created'):
            self.assertIs(receipt[key],False)
        self.assertIs(receipt['mode0600_is_not_absolute_execution_denial'],True)
        self.assertEqual(json.loads((self.output/'DERIVATION-RECEIPT.json').read_text()),receipt)

    def test_manifest_and_receipt_written_only_after_input_exit_stat(self):
        original=producer._copy
        def mutate(stream,expected,chrome):original(stream,expected,chrome);self.archive.chmod(0o640)
        with mock.patch.object(producer,'_copy',side_effect=mutate),self.assertRaisesRegex(producer.CopyRejected,'source_changed_before_exit'):self.derive()
        self.assertTrue((self.output/'INTENT.json').exists());self.assertFalse((self.output/'BROWSER-DATA-MANIFEST.json').exists())
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())

    def test_archive_and_inventory_pins_and_private_modes_fail_closed(self):
        with mock.patch.object(producer,'ARCHIVE_SHA256','0'*64),self.assertRaises(producer.CopyRejected):self.derive()
        with mock.patch.object(producer,'INPUTS_SHA256','0'*64),self.assertRaises(producer.CopyRejected):self.derive()
        self.archive.chmod(0o620)
        with self.assertRaises(PermissionError):self.derive()
        self.assertFalse(self.output.exists())

    def test_empty_directory_accepts_none_or_exact_empty_sha(self):
        for expected_sha in (None,producer.EMPTY_SHA256):
            with self.subTest(expected_sha=expected_sha):
                self.prepare(change=lambda d:[row.update(sha256=expected_sha)for row in d['inventory']if row['kind']=='directory'])
                with io.BytesIO(self.inventory.read_bytes())as stream:
                    _,expected=producer._load_inventory(stream)
                self.assertTrue(any(row['kind']=='directory'for row in expected.values()))
        self.assertFalse(self.output.exists())

    def test_empty_sha_directories_derive_fictitious_data_only(self):
        self.prepare(change=lambda d:[row.update(sha256=producer.EMPTY_SHA256)for row in d['inventory']if row['kind']=='directory'])
        receipt=self.derive()
        self.assertFalse(receipt['qualified'])
        self.assertFalse(receipt['package_import_execution_or_browser_launch'])

    def test_directory_other_sha_nonzero_size_compressed_or_crc_refused(self):
        cases=({'sha256':'a'*64},{'sha256':''},{'sha256':[]},{'sha256':True},
            {'sha256':producer.EMPTY_SHA256,'bytes':1},
            {'sha256':producer.EMPTY_SHA256,'compressed_bytes':1},
            {'sha256':producer.EMPTY_SHA256,'crc32_expected_hex':'00000001'},
            {'sha256':None,'compressed_bytes':1},{'sha256':None,'crc32_expected_hex':'00000001'})
        for changed in cases:
            with self.subTest(changed=changed):
                self.prepare(change=lambda d:[row.update(changed)for row in d['inventory']if row['kind']=='directory'])
                with io.BytesIO(self.inventory.read_bytes())as stream,self.assertRaises(producer.CopyRejected):
                    producer._load_inventory(stream)
                self.assertFalse(self.output.exists())

    def test_pinned_real_metadata_empty_directory_hashes_only_no_real_zip(self):
        if self.patcher:self.patcher.stop();self.patcher=None
        metadata=producer.PROJECT/'metadata/browser/BROWSER-INPUTS.json'
        with producer._input(metadata,producer.INPUTS_SHA256,producer.INPUTS_BYTES,producer.MAX_METADATA)as stream:
            _,inventory=producer._load_inventory(stream)
        directories=[row for row in inventory.values()if row['kind']=='directory']
        self.assertEqual(len(directories),5)
        self.assertTrue(all(row['bytes']==0 and row['compressed_bytes']==0
            and row['crc32_expected_hex']=='00000000'and row['sha256']==producer.EMPTY_SHA256 for row in directories))
        self.assertFalse(self.output.exists())

    def test_inventory_member_sha_and_crc_must_match_actual_zip(self):
        for field,value in (('sha256','0'*64),('crc32_expected_hex','00000000'),('compressed_bytes',1)):
            self.prepare(change=lambda d:d['inventory'][2].update({field:value}))
            with self.assertRaises(producer.CopyRejected):self.derive()
            self.assertFalse(self.output.exists())

    def test_unsafe_paths_and_unapproved_prefixes_rejected_before_output(self):
        for name in ('../outside','/outside','chrome-linux64/../outside','chrome-linux64\\outside','chrome-linux64//outside','other/chrome'):
            self.prepare(ROWS+[(name,b'fixture',stat.S_IFREG|0o644)])
            with self.assertRaises(producer.CopyRejected):self.derive()
            self.assertFalse(self.output.exists());self.assertFalse((self.root/'outside').exists())

    def test_symlink_special_and_privileged_source_metadata_rejected(self):
        for mode in (stat.S_IFLNK|0o777,stat.S_IFIFO|0o600,stat.S_IFREG|0o4755):
            self.prepare(ROWS+[('chrome-linux64/forbidden',b'fixture',mode)])
            with self.assertRaises(producer.CopyRejected):self.derive()
            self.assertFalse(self.output.exists())

    def test_duplicate_member_path_refused(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning);self.prepare(ROWS+[ROWS[2]])
        with self.assertRaises(producer.CopyRejected):self.derive()
        self.assertFalse(self.output.exists())

    def test_parent_file_collision_refused(self):
        self.prepare(ROWS+[('chrome-linux64/file',b'fixture',stat.S_IFREG|0o644),('chrome-linux64/file/child',b'fixture',stat.S_IFREG|0o644)])
        with self.assertRaisesRegex(producer.CopyRejected,'beneath_file'):self.derive()
        self.assertFalse(self.output.exists())

    def test_counts_and_budgets_are_exact_and_bounded(self):
        self.prepare(change=lambda d:d['counts'].update({'unpacked_bytes':1}))
        with self.assertRaises(producer.CopyRejected):self.derive()
        self.prepare()
        with mock.patch.object(producer,'MAX_FILE',1),self.assertRaises(producer.CopyRejected):self.derive()
        self.assertFalse(self.output.exists())

    def test_input_symlink_and_existing_destination_never_followed_or_overwritten(self):
        saved=self.root/'saved.zip';self.archive.rename(saved);self.archive.symlink_to(saved)
        with self.assertRaises(OSError):self.derive()
        self.archive.unlink();saved.rename(self.archive)
        self.output.mkdir(mode=0o700);(self.output/'foreign').write_bytes(b'untouched')
        with self.assertRaises(FileExistsError):self.derive()
        self.assertEqual((self.output/'foreign').read_bytes(),b'untouched')

    def test_io_partial_preserved_and_replay_refused(self):
        def fail(stream,expected,chrome):
            child=os.open('partial',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=chrome)
            os.write(child,b'partial');os.close(child);raise OSError('fixture_error')
        with mock.patch.object(producer,'_copy',side_effect=fail),self.assertRaises(OSError):self.derive()
        self.assertEqual((self.output/'chromium/chrome-linux64/partial').read_bytes(),b'partial')
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        with self.assertRaises(FileExistsError):self.derive()

    def test_chrome_root_alias_during_copy_never_receives_subsequent_bytes(self):
        original=producer._member_parent;injected=[]
        def rename(fd,name):
            value=original(fd,name)
            if not injected:
                injected.append(True);chrome=self.output/'chromium/chrome-linux64'
                chrome.rename(self.output/'chromium/retained-chrome');chrome.mkdir(mode=0o700)
                (chrome/'foreign').write_bytes(b'untouched')
            return value
        with mock.patch.object(producer,'_member_parent',side_effect=rename),self.assertRaisesRegex(producer.CopyRejected,'output_lineage_changed'):self.derive()
        alias=self.output/'chromium/chrome-linux64'
        self.assertEqual({p.name for p in alias.iterdir()},{'foreign'})
        self.assertEqual((alias/'foreign').read_bytes(),b'untouched')
        self.assertEqual((self.output/'chromium/retained-chrome/chrome').read_bytes(),ROWS[0][1])
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())

    def test_output_root_rename_replacement_is_never_written(self):
        original=producer._copy;moved=self.root/'retained-root'
        def rename(stream,expected,chrome):
            original(stream,expected,chrome);self.output.rename(moved);self.output.mkdir(mode=0o700)
            (self.output/'foreign').write_bytes(b'untouched')
        with mock.patch.object(producer,'_copy',side_effect=rename),self.assertRaisesRegex(producer.CopyRejected,'output_lineage_changed'):self.derive()
        self.assertEqual({p.name for p in self.output.iterdir()},{'foreign'})
        for directory in (self.output,moved):self.assertFalse((directory/'DERIVATION-RECEIPT.json').exists())

    def test_parent_rename_replacement_detected(self):
        original=producer._copy;moved=self.root.with_name(self.root.name+'-retained')
        self.addCleanup(lambda:shutil.rmtree(moved) if moved.exists() else None)
        def rename(stream,expected,chrome):
            original(stream,expected,chrome);self.root.rename(moved);self.root.mkdir(mode=0o700)
            (self.root/'foreign').write_bytes(b'untouched')
        with mock.patch.object(producer,'_copy',side_effect=rename),self.assertRaisesRegex(producer.CopyRejected,'output_lineage_changed'):self.derive()
        self.assertEqual({p.name for p in self.root.iterdir()},{'foreign'})
        self.assertFalse((moved/'browser-data-1/DERIVATION-RECEIPT.json').exists())

    def test_alias_after_manifest_rejected_before_receipt(self):
        original=producer._new_json;moved=self.root/'retained-after-manifest'
        def rename(fd,name,value):
            result=original(fd,name,value)
            if name=='BROWSER-DATA-MANIFEST.json':
                self.output.rename(moved);self.output.mkdir(mode=0o700);(self.output/'foreign').write_bytes(b'untouched')
            return result
        with mock.patch.object(producer,'_new_json',side_effect=rename),self.assertRaisesRegex(producer.CopyRejected,'output_lineage_changed'):self.derive()
        self.assertTrue((moved/'BROWSER-DATA-MANIFEST.json').exists())
        self.assertFalse((moved/'DERIVATION-RECEIPT.json').exists())
        self.assertEqual({p.name for p in self.output.iterdir()},{'foreign'})

    def test_final_post_fsync_alias_check_refuses_completion(self):
        original=producer._new_json;moved=self.root/'retained-final-candidate'
        def rename(fd,name,value):
            result=original(fd,name,value)
            if name=='DERIVATION-RECEIPT.json':
                self.output.rename(moved);self.output.mkdir(mode=0o700);(self.output/'foreign').write_bytes(b'untouched')
            return result
        with mock.patch.object(producer,'_new_json',side_effect=rename),self.assertRaisesRegex(producer.CopyRejected,'output_lineage_changed'):self.derive()
        self.assertTrue((moved/'DERIVATION-RECEIPT.json').exists())
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        self.assertEqual({p.name for p in self.output.iterdir()},{'foreign'})

    def test_unknown_or_missing_empty_output_directories_refused(self):
        self.prepare(ROWS+[('chrome-linux64/empty/',b'',stat.S_IFDIR|0o755)])
        original=producer._copy
        def remove(stream,expected,chrome):original(stream,expected,chrome);os.rmdir('empty',dir_fd=chrome)
        with mock.patch.object(producer,'_copy',side_effect=remove),self.assertRaisesRegex(producer.CopyRejected,'complete_output_directory'):self.derive()
        self.assertFalse((self.output/'BROWSER-DATA-MANIFEST.json').exists())

    def test_closed_cli_has_no_pin_owner_or_run_override(self):
        base=['browser_copy','derive','--archive',str(self.archive),'--inventory',str(self.inventory),'--output',str(self.output)]
        for argv in ([base[0]],base+['--sha256','a'*64],base+['--expected-uid','0'],base+['--run']):
            with mock.patch.object(sys,'argv',argv),mock.patch('sys.stderr',new=io.StringIO()),mock.patch.object(producer,'derive') as derive:
                with self.assertRaises(SystemExit):producer.main()
                derive.assert_not_called()
        self.assertFalse(self.output.exists())


if __name__=='__main__':unittest.main()
