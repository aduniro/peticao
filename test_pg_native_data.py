"""Fictitious DATA fixtures only; no PG/native executables or real candidate writes."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

import pg_native_data as pg

HERE=Path(__file__).absolute().parent
TMP=HERE/'test-state'/'tmp'
TMP.parent.mkdir(mode=0o700,exist_ok=True)
TMP.mkdir(mode=0o700,exist_ok=True)


def digest(raw):return hashlib.sha256(raw).hexdigest()


def put(path,raw):
    path.write_bytes(raw);path.chmod(0o600)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pg-fictitious-',dir=TMP)
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source';self.source.mkdir(mode=0o700)
        put(self.source/'pg_native_data.py',b'fixture closure bytes, never executed\n')
        self.archive=self.root/'fake.tar.gz';self.receipt=self.root/'receipt.json';self.inventory=self.source/'INPUT-INVENTORY.json'
        self.payload={pg.PREFIX+'/bin/postgres':b'fictitious PG bytes, never executed',
                      pg.PREFIX+'/lib/libfake.so.1':b'fictitious lib bytes',
                      'node':b'not executable','package-lock.json':b'{}','package.tgz':b'fake package'}
        self._tar()
        with pg.Input(pg.PROVIDER,pg.PROVIDER_SHA,pg.PROVIDER_BYTES) as source:
            self.parser=pg._provider(source.stream)
        with self.archive.open('rb') as stream:self.manifest=self.parser.archive_manifest(stream,'deps')
        rows=[];entries=[];aliases={}
        for entry in self.manifest['entries']:
            n=entry['name'];row={'name':n,'output_type':entry['type'],'output_size':entry['size'],'normalized_mode':entry['mode']}
            if entry['type']=='file':row['output_content_sha256']=digest(self.payload[n])
            if entry['type']=='symlink':
                row.update(parent_linkname=entry['linkname'],resolved_target=entry['resolved_target'],final_target=entry['final_target'])
            rows.append(row)
            if not pg._inside(n):continue
            rel=pg._relative(n);item={'name':rel,'type':entry['type']}
            if entry['type']=='file':item.update(bytes=entry['size'],sha256=row['output_content_sha256'])
            if entry['type']=='symlink':
                raw=self.payload[entry['final_target']]
                alias={'linkname':entry['linkname'],'target':pg._relative(entry['final_target']),'bytes':len(raw),'sha256':digest(raw)}
                item.update(alias);aliases[rel]=alias
            entries.append(item)
        archive_raw=self.archive.read_bytes()
        self.receipt_value={'output_sha256':digest(archive_raw),'output_bytes':len(archive_raw),'entrymap':rows}
        self.inventory_value={'archive':{'sha256':digest(archive_raw),'bytes':len(archive_raw)},
            'archive_members':self.manifest['members'],'archive_unpacked_bytes':self.manifest['unpacked_bytes'],
            'entries':entries,'aliases':aliases,'counts':{'directories':3,'regulars':2,'aliases_materialized':1,'output_regulars':3},
            'output_regular_bytes':sum(x.get('bytes',0) for x in entries)}
        put(self.receipt,pg.canonical(self.receipt_value));put(self.inventory,pg.canonical(self.inventory_value))
        self.output=self.root/'candidate';self.policy=self.source/'PG-POLICY.json';self.live=self.root/'PG-EXECUTION-POLICY.json'
        changes={'SOURCE':self.source,'POLICY':self.policy,'EXEC_POLICY':self.live,'ARCHIVE':self.archive,
                 'RECEIPT':self.receipt,'INVENTORY':self.inventory,'OUTPUT':self.output,
                 'ARCHIVE_SHA':digest(archive_raw),'ARCHIVE_BYTES':len(archive_raw),
                 'RECEIPT_SHA':digest(self.receipt.read_bytes()),'RECEIPT_BYTES':self.receipt.stat().st_size,
                 'INVENTORY_SHA':digest(self.inventory.read_bytes()),'INVENTORY_BYTES':self.inventory.stat().st_size}
        self.patch=mock.patch.multiple(pg,**changes);self.patch.start();self.addCleanup(self.patch.stop)
        self.value={'version':1,'role':pg.ROLE,'uid':1000,'execute':False,'archive_sha256':pg.ARCHIVE_SHA,'archive_bytes':pg.ARCHIVE_BYTES,
                    'receipt_sha256':pg.RECEIPT_SHA,'receipt_bytes':pg.RECEIPT_BYTES,'provider_sha256':pg.PROVIDER_SHA,'provider_bytes':pg.PROVIDER_BYTES,
                    'inventory_sha256':pg.INVENTORY_SHA,'inventory_bytes':pg.INVENTORY_BYTES,'source_sha256':digest((self.source/'pg_native_data.py').read_bytes()),'output':str(self.output)}
        put(self.policy,pg.canonical(self.value))

    def _tar(self,hardlink=False,bad_alias=False):
        with tarfile.open(self.archive,'w:gz') as tar:
            for name in ['node_modules',pg.PREFIX,pg.PREFIX+'/bin',pg.PREFIX+'/lib']:
                info=tarfile.TarInfo(name);info.type=tarfile.DIRTYPE;info.mode=0o755;tar.addfile(info)
            for name,raw in self.payload.items():
                info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o755;tar.addfile(info,io.BytesIO(raw))
            info=tarfile.TarInfo(pg.PREFIX+'/lib/libfake.so');info.type=tarfile.LNKTYPE if hardlink else tarfile.SYMTYPE
            info.mode=0o755;info.linkname='../../../../../../../outside' if bad_alias else 'libfake.so.1';tar.addfile(info)
        self.archive.chmod(0o600)

    def enable(self):
        put(self.live,pg.canonical({**self.value,'execute':True}))

    def plan(self):return pg._plan(self.manifest,self.receipt_value,self.inventory_value)

    def test_default_template_blocks_before_output(self):
        value,_,path=pg.load_policy();self.assertFalse(value['execute']);self.assertEqual(path,self.policy)
        with self.assertRaises(PermissionError):pg.produce()
        self.assertFalse(self.output.exists())

    def test_invalid_live_never_falls_back_and_template_true_not_bypass(self):
        put(self.live,b'{bad json')
        with self.assertRaises(ValueError):pg.load_policy()
        self.live.unlink();put(self.policy,pg.canonical({**self.value,'execute':True}))
        with self.assertRaises(PermissionError):pg.load_policy()
        self.assertFalse(self.output.exists())

    def test_live_policy_closed_and_owned(self):
        self.enable();put(self.live,pg.canonical({**self.value,'execute':True,'arbitrary_path':'/elsewhere'}))
        with self.assertRaises(PermissionError):pg.load_policy()
        self.enable();self.live.chmod(0o666)
        with self.assertRaises(PermissionError):pg.load_policy()

    def test_complete_fake_projection_materializes_aliases_without_links(self):
        self.enable();result=pg.produce()
        self.assertEqual(result['files'],3);self.assertFalse(result['qualified'])
        target=self.output/'postgres/lib/libfake.so.1';alias=self.output/'postgres/lib/libfake.so'
        self.assertEqual(alias.read_bytes(),target.read_bytes());self.assertNotEqual(alias.stat().st_ino,target.stat().st_ino)
        for path in self.output.rglob('*'):
            self.assertFalse(path.is_symlink())
            self.assertEqual(path.stat().st_mode&0o777,0o700 if path.is_dir() else 0o600)
            if path.is_file():self.assertEqual(path.stat().st_nlink,1)
        receipt=json.loads((self.output/'DERIVATION-RECEIPT.json').read_text())
        for key in ('qualified','root_integrity_approved','root_install_performed','native_execution_performed'):
            self.assertIs(receipt[key],False)
        with self.assertRaises(FileExistsError):pg.produce()

    def test_archive_hash_failure_precedes_destination(self):
        self.enable()
        with self.archive.open('ab') as stream:stream.write(b'changed')
        with self.assertRaises(pg.Rejected):pg.produce()
        self.assertFalse(self.output.exists())

    def test_bad_receipt_and_inventory_bindings_refused(self):
        for label in ('archive','entries','hash','alias','counts'):
            with self.subTest(label=label):
                r=copy.deepcopy(self.receipt_value);inv=copy.deepcopy(self.inventory_value)
                if label=='archive':r['output_sha256']='0'*64
                if label=='entries':r['entrymap'].pop()
                if label=='hash':next(x for x in r['entrymap'] if x['name'].endswith('/bin/postgres'))['output_content_sha256']='0'*64
                if label=='alias':inv['aliases']={}
                if label=='counts':inv['counts']['output_regulars']+=1
                with self.assertRaises(pg.Rejected):pg._plan(self.manifest,r,inv)

    def test_alias_cannot_target_other_prefix_or_a_directory(self):
        for target in ('node',pg.PREFIX+'/lib'):
            manifest=copy.deepcopy(self.manifest);receipt=copy.deepcopy(self.receipt_value)
            entry=next(x for x in manifest['entries'] if x['type']=='symlink')
            entry['final_target']=target
            row=next(x for x in receipt['entrymap'] if x['output_type']=='symlink')
            row['final_target']=target
            with self.assertRaises(pg.Rejected):pg._plan(manifest,receipt,self.inventory_value)

    def test_regular_content_corruption_detected_before_writes(self):
        plan=self.plan();plan['bin/postgres']['sha256']='0'*64
        with self.archive.open('rb') as stream:
            with self.assertRaises(pg.Rejected):pg._validate_content(stream,self.parser,plan)
        self.assertFalse(self.output.exists())

    def test_hardlinks_and_escape_links_rejected_by_frozen_parser(self):
        for hard,bad in [(True,False),(False,True)]:
            self._tar(hardlink=hard,bad_alias=bad)
            with self.archive.open('rb') as stream:
                with self.assertRaises(self.parser.InputRejected):self.parser.archive_manifest(stream,'deps')

    def test_duplicate_tar_members_rejected(self):
        with tarfile.open(self.archive,'w:gz') as tar:
            for _ in range(2):
                raw=b'x';info=tarfile.TarInfo('node');info.size=1;tar.addfile(info,io.BytesIO(raw))
        with self.archive.open('rb') as stream:
            with self.assertRaises(self.parser.InputRejected):self.parser.archive_manifest(stream,'deps')

    def test_input_path_swap_same_bytes_rejected(self):
        with self.assertRaises(PermissionError):
            with pg.Input(self.archive,pg.ARCHIVE_SHA,pg.ARCHIVE_BYTES):
                original=self.archive.read_bytes();self.archive.rename(self.root/'old.tar.gz');put(self.archive,original)

    def test_input_symlink_hardlink_and_ancestor_symlink_rejected(self):
        for mode in ('symlink','hardlink','ancestor'):
            with self.subTest(mode=mode):
                p=self.root/('input-'+mode)
                if mode=='symlink':p.symlink_to(self.archive)
                elif mode=='hardlink':os.link(self.archive,p)
                else:
                    p.symlink_to(self.source,target_is_directory=True);p=p/'pg_native_data.py'
                with self.assertRaises((PermissionError,OSError)):
                    with pg.Input(p,pg.ARCHIVE_SHA,pg.ARCHIVE_BYTES):pass
                if mode=='hardlink':p.unlink()

    def test_held_directory_detects_parent_rename_and_alias(self):
        parent=self.root/'private';parent.mkdir(mode=0o700)
        stage=pg.new_directory(parent/'output')
        try:
            parent.rename(self.root/'detached');parent.mkdir(mode=0o700);(parent/'output').mkdir(mode=0o700)
            with self.assertRaises(PermissionError):stage.check()
        finally:stage.close()

    def test_failure_after_intent_preserves_partial_and_refuses_reuse(self):
        self.enable()
        with mock.patch.object(pg,'_materialize',side_effect=OSError('fictitious disk fault')):
            with self.assertRaises(OSError):pg.produce()
        self.assertTrue((self.output/'DERIVATION-INTENT.json').is_file())
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        with self.assertRaises(FileExistsError):pg.produce()

    def test_extra_output_and_changed_private_modes_fail_final_verification(self):
        plan=self.plan()
        with pg.new_directory(self.output) as stage:
            pg._json(stage,'DERIVATION-INTENT.json',{'fake':True})
            with self.archive.open('rb') as stream:pg._materialize(stream,self.parser,plan,stage)
            put(self.output/'postgres/extra',b'not allowed')
            with self.assertRaises(pg.Rejected):pg._inspect(stage,plan)
            (self.output/'postgres/extra').unlink();(self.output/'postgres').chmod(0o755)
            with self.assertRaises((PermissionError,pg.Rejected)):pg._inspect(stage,plan)
            (self.output/'postgres').chmod(0o700)  # Restore this fixture before context-exit check.

    def test_source_closure_and_policy_change_before_receipt_block_commit(self):
        self.enable();original=pg._materialize
        def changed(*args):
            original(*args);put(self.live,pg.canonical({**self.value,'execute':False}))
        with mock.patch.object(pg,'_materialize',side_effect=changed):
            with self.assertRaises(PermissionError):pg.produce()
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        self.assertTrue((self.output/'DERIVATION-INTENT.json').exists())

    def test_mutated_source_pin_refuses_before_output(self):
        self.enable();put(self.source/'pg_native_data.py',b'different source')
        with self.assertRaises(pg.Rejected):pg.produce()
        self.assertFalse(self.output.exists())

    def test_receipt_hash_and_inventory_hash_refuse_before_output(self):
        self.enable()
        for path in (self.receipt,self.inventory):
            original=path.read_bytes();put(path,original+b' ')
            with self.assertRaises(pg.Rejected):pg.produce()
            self.assertFalse(self.output.exists());put(path,original)

    def test_output_alias_swap_after_intent_retains_partial_without_receipt(self):
        self.enable();original=pg._materialize
        def swap(*args):
            original(*args)
            self.output.rename(self.root/'detached-output');self.output.mkdir(mode=0o700)
        with mock.patch.object(pg,'_materialize',side_effect=swap):
            with self.assertRaises(PermissionError):pg.produce()
        self.assertTrue((self.root/'detached-output/DERIVATION-INTENT.json').exists())
        self.assertFalse((self.root/'detached-output/DERIVATION-RECEIPT.json').exists())
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())

    def test_output_symlink_and_hardlink_rejected_by_exact_inspection(self):
        plan=self.plan()
        with pg.new_directory(self.output) as stage:
            pg._json(stage,'DERIVATION-INTENT.json',{'fake':True})
            with self.archive.open('rb') as stream:pg._materialize(stream,self.parser,plan,stage)
            alias=self.output/'postgres/lib/libfake.so';alias.unlink()
            alias.symlink_to('libfake.so.1')
            with self.assertRaises((PermissionError,pg.Rejected)):pg._inspect(stage,plan)
            alias.unlink();os.link(self.output/'postgres/lib/libfake.so.1',alias)
            with self.assertRaises((PermissionError,pg.Rejected)):pg._inspect(stage,plan)

    def test_output_hash_corruption_and_unexpected_dir_rejected(self):
        plan=self.plan()
        with pg.new_directory(self.output) as stage:
            pg._json(stage,'DERIVATION-INTENT.json',{'fake':True})
            with self.archive.open('rb') as stream:pg._materialize(stream,self.parser,plan,stage)
            (self.output/'postgres/unexpected').mkdir(mode=0o700)
            with self.assertRaises(pg.Rejected):pg._inspect(stage,plan)
            (self.output/'postgres/unexpected').rmdir()
            target=self.output/'postgres/bin/postgres';raw=target.read_bytes();put(target,b'x'*len(raw))
            with self.assertRaises(pg.Rejected):pg._inspect(stage,plan)

    def test_receipt_write_failure_leaves_intent_and_complete_candidate(self):
        self.enable();original=pg._json
        def fail(stage,name,value):
            if name=='DERIVATION-RECEIPT.json':raise OSError('fictitious receipt fsync fault')
            return original(stage,name,value)
        with mock.patch.object(pg,'_json',side_effect=fail):
            with self.assertRaises(OSError):pg.produce()
        self.assertTrue((self.output/'postgres/bin/postgres').exists())
        self.assertTrue((self.output/'DERIVATION-INTENT.json').exists())
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        with self.assertRaises(FileExistsError):pg.produce()

    def swap_bin(self):
        original=self.output/'postgres/bin'
        detached=self.root/'original-bin'
        replacement=self.root/'foreign-bin';replacement.mkdir(mode=0o700)
        replacement_inode=replacement.stat().st_ino
        original.rename(detached);replacement.rename(original)
        return detached,replacement_inode

    def assert_replacement_untouched(self,inode):
        replacement=self.output/'postgres/bin'
        self.assertEqual(replacement.stat().st_ino,inode)
        self.assertEqual(replacement.stat().st_mode&0o777,0o700)
        self.assertEqual(replacement.stat().st_uid,1000)
        self.assertEqual(list(replacement.iterdir()),[])
        self.assertFalse((self.output/'DERIVATION-RECEIPT.json').exists())
        self.assertTrue((self.output/'DERIVATION-INTENT.json').exists())

    def test_nested_directory_repro_before_first_write_is_rejected(self):
        self.enable();original=pg._write;replaced=[]
        def swap(stage,rel,*args):
            if rel=='postgres/bin/postgres':
                detached,inode=self.swap_bin();replaced.append(inode)
                self.assertEqual(list(detached.iterdir()),[])
            return original(stage,rel,*args)
        with mock.patch.object(pg,'_write',side_effect=swap):
            with self.assertRaises(PermissionError):pg.produce()
        self.assertEqual(len(replaced),1);self.assert_replacement_untouched(replaced[0])
        self.assertEqual(list((self.root/'original-bin').iterdir()),[])
        with self.assertRaises(FileExistsError):pg.produce()

    def test_nested_directory_swap_after_manifest_blocks_receipt(self):
        self.enable();original=pg._inspect;replaced=[]
        def swap(*args):
            files=original(*args)
            detached,inode=self.swap_bin();replaced.append(inode)
            self.assertTrue((detached/'postgres').is_file())
            return files
        with mock.patch.object(pg,'_inspect',side_effect=swap):
            with self.assertRaises(PermissionError):pg.produce()
        self.assertEqual(len(replaced),1);self.assert_replacement_untouched(replaced[0])

    def test_swap_after_parent_validation_uses_original_fd_never_replacement(self):
        self.enable();original=pg._parent;replaced=[]
        def swap(stage,rel):
            result=original(stage,rel)
            if rel=='postgres/bin/postgres' and not replaced:
                detached,inode=self.swap_bin();replaced.append(inode)
            return result
        with mock.patch.object(pg,'_parent',side_effect=swap):
            with self.assertRaises(PermissionError):pg.produce()
        self.assertEqual(len(replaced),1);self.assert_replacement_untouched(replaced[0])
        self.assertEqual((self.root/'original-bin/postgres').read_bytes(),self.payload[pg.PREFIX+'/bin/postgres'])

    def test_json_duplicates_nonfinite_and_no_public_arguments(self):
        for raw in (b'{"x":1,"x":2}',b'{"x":NaN}'):
            with self.assertRaises(ValueError):pg.parse(raw)
        with self.assertRaises(TypeError):pg.produce('/arbitrary')
        with self.assertRaises(TypeError):pg.produce(_expected_uid=1000)


if __name__=='__main__':unittest.main()
