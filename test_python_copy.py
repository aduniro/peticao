"""Fixtures only: no real selected /usr copy or candidate import/execution.

Positive orchestration mocks ONLY the external Root-source TCB, serving trivial
fixture files. The productive _source and alias guards have no UID/path seam.
"""
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import python_copy as copy

TMP=Path('/mnt/apps/peticao-final/infra-public-inputs-20261115/python-copy-source/test-state/tmp')


class PythonCopyTests(unittest.TestCase):
    def setUp(self):
        TMP.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix='copy-fixture-',dir=TMP)
        self.base=Path(self.temp.name);self.output=self.base/'dataset-new'
        self.patches=[mock.patch.object(copy,'BASE',self.base),mock.patch.object(copy,'OUTPUT',self.output)]
        for patch in self.patches:patch.start()
        self.source=self.base/'source-fixtures';self.source.mkdir(mode=0o700)
        self.rows=[]
        for source,relative,raw in [('binary','bin/python3.12',b'fictitious NOT executable interpreter data'),
            ('module','lib/python3.12/module.py',b'raise AssertionError("CANDIDATE_MUST_NOT_IMPORT")\n')]:
            path=self.source/source;path.write_bytes(raw);path.chmod(0o600)
            self.rows.append({'source':str(path),'relative':relative,'sha256':hashlib.sha256(raw).hexdigest(),
                              'bytes':len(raw),'packages':['fixture-package']})
        self.exits=[]
        @contextmanager
        def source(row):
            # Test-only TCB replacement, never accepted by productive API.
            with open(row['source'],'rb')as fp:
                before=os.fstat(fp.fileno());yield fp,copy.signature(before)
                self.assertEqual(copy._hash(fp),row['sha256'])
            self.exits.append(row['relative'])
        self.source_mock=mock.patch.object(copy,'_source',side_effect=source)
        self.alias_mock=mock.patch.object(copy,'_alias_identity',return_value={'fixture_alias':'metadata only'})
        self.source_mock.start();self.alias_mock.start()

    def tearDown(self):
        self.alias_mock.stop();self.source_mock.stop()
        for patch in reversed(self.patches):patch.stop()
        self.temp.cleanup()

    def run_fixture(self):return copy._produce(self.rows,{'fixture':True},{'kind':'INFRA_AUTHORIZED_OFFLINE_PUBLIC_DATA_COPY','fixture':True})

    def test_fixture_copy_private_nonexecuting_and_manifest_after_source_exit(self):
        original=copy.hash_whole_tree
        def check_exits(tree,expected):
            self.assertEqual(set(self.exits),{r['relative']for r in self.rows})
            self.assertFalse((self.output/'MANIFEST.json').exists())
            return original(tree,expected)
        with mock.patch.object(copy,'hash_whole_tree',side_effect=check_exits):receipt=self.run_fixture()
        self.assertEqual(receipt['regular_files'],2)
        self.assertFalse(receipt['qualified']);self.assertFalse(receipt['operationalReady'])
        manifest=json.loads((self.output/'MANIFEST.json').read_bytes())
        self.assertTrue(manifest['source_exit_all_verified'])
        self.assertFalse(manifest['candidate_executed_or_imported'])
        self.assertFalse(manifest['RootFullClosure'])
        self.assertEqual(receipt['manifest_sha256'],hashlib.sha256((self.output/'MANIFEST.json').read_bytes()).hexdigest())
        for path in self.output.rglob('*'):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o700 if path.is_dir()else 0o600)
        self.assertEqual((self.output/'python312/lib/python3.12/module.py').read_bytes(),Path(self.rows[1]['source']).read_bytes())

    def test_no_replay_or_existing_output_reuse(self):
        self.run_fixture()
        with self.assertRaises(FileExistsError):self.run_fixture()
        self.assertEqual(len(self.exits),2)

    def test_failure_preserves_intent_partial_and_no_success_manifests(self):
        self.rows[1]['sha256']='0'*64
        with self.assertRaises(copy.CopyRefused):self.run_fixture()
        self.assertTrue((self.output/'INTENT.json').is_file())
        self.assertTrue((self.output/'python312/bin/python3.12').is_file())
        self.assertFalse((self.output/'MANIFEST.json').exists())
        self.assertFalse((self.output/'RECEIPT.json').exists())

    def test_source_exit_refusal_prevents_manifest(self):
        @contextmanager
        def refused(row):
            with open(row['source'],'rb')as fp:yield fp,copy.signature(os.fstat(fp.fileno()))
            raise copy.CopyRefused('fixture_source_exit_changed')
        with mock.patch.object(copy,'_source',side_effect=refused),self.assertRaises(copy.CopyRefused):self.run_fixture()
        self.assertFalse((self.output/'MANIFEST.json').exists())

    def test_whole_tree_refuses_extra_symlink_changed_mode_or_bytes(self):
        self.run_fixture();tree=self.output/'python312';expected={r['relative']:r for r in self.rows}
        fd=os.open(tree,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            empty=tree/'unexpected-empty';empty.mkdir(mode=0o700)
            with self.assertRaises(copy.CopyRefused):copy.hash_whole_tree(fd,expected)
            empty.rmdir()
            extra=tree/'extra';extra.write_bytes(b'extra');extra.chmod(0o600)
            with self.assertRaises(copy.CopyRefused):copy.hash_whole_tree(fd,expected)
            extra.unlink();extra.symlink_to(self.source/'binary')
            with self.assertRaises(copy.CopyRefused):copy.hash_whole_tree(fd,expected)
            extra.unlink();binary=tree/'bin/python3.12';binary.chmod(0o700)
            with self.assertRaises(copy.CopyRefused):copy.hash_whole_tree(fd,expected)
            binary.chmod(0o600);binary.write_bytes(b'changed')
            with self.assertRaises(copy.CopyRefused):copy.hash_whole_tree(fd,expected)
        finally:os.close(fd)

    def test_lineage_swap_preserves_partial_never_writes_foreign(self):
        real=copy.hash_whole_tree;foreign=self.base/'foreign';foreign.mkdir(mode=0o700);moved=self.base/'preserved'
        def swap(tree,expected):
            result=real(tree,expected);self.output.rename(moved);self.output.symlink_to(foreign,target_is_directory=True);return result
        with mock.patch.object(copy,'hash_whole_tree',side_effect=swap),self.assertRaises(copy.CopyRefused):self.run_fixture()
        self.assertEqual(list(foreign.iterdir()),[])
        self.assertTrue((moved/'INTENT.json').is_file())
        self.assertFalse((moved/'MANIFEST.json').exists())

    def test_existing_lexical_parent_symlink_cannot_redirect_copy(self):
        root=self.base/'tree';root.mkdir(mode=0o700);(root/'lib').symlink_to(self.source,target_is_directory=True)
        fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            with self.assertRaises(OSError):copy._copy_one(fd,self.rows[1])
        finally:os.close(fd)

    def test_excluded_relative_paths_traversal_and_free_prefixes(self):
        for relative in ('../outside','/tmp/a','lib/python3.12/sitecustomize.py','lib/python3.12/usercustomize.py',
            'lib/python3.12/site-packages/pkg.py','lib/python3.12/__pycache__/a.pyc','lib/python3.12/a.pth',
            'lib/python3.12/tests/a.py','lib//a.py'):
            with self.subTest(relative=relative),self.assertRaises(copy.CopyRefused):copy._relative(relative)

    def test_root_source_file_guard_not_optional_or_uid_configurable(self):
        good=dict(st_mode=stat.S_IFREG|0o644,st_uid=0,st_nlink=1,st_size=4)
        copy._file_root(SimpleNamespace(**good),4)
        for changed in ({'st_uid':1000},{'st_nlink':2},{'st_mode':stat.S_IFLNK|0o777},
            {'st_mode':stat.S_IFREG|0o664},{'st_mode':stat.S_IFREG|0o600},{'st_size':5}):
            with self.assertRaises(copy.CopyRefused):copy._file_root(SimpleNamespace(**{**good,**changed}),4)

    def test_root_ancestor_guard_rejects_writable_foreign_or_non_directory(self):
        good=dict(st_mode=stat.S_IFDIR|0o755,st_uid=0)
        copy._root_directory(SimpleNamespace(**good))
        for changed in ({'st_uid':1000},{'st_mode':stat.S_IFDIR|0o775},{'st_mode':stat.S_IFLNK|0o777}):
            with self.assertRaises(copy.CopyRefused):copy._root_directory(SimpleNamespace(**{**good,**changed}))

    def test_explicit_alias_materialization_reuses_regular_target_only(self):
        row=deepcopy(self.rows[1]);row['relative']='lib/python3.12/alias.py'
        row['materialization']={'source_alias':'fixture-symlink-not-opened','regular_target':row['source'],
                                'target_sha256':row['sha256'],'same_package':False}
        self.rows.append(row);self.run_fixture()
        dest=self.output/'python312/lib/python3.12/alias.py'
        self.assertTrue(dest.is_file());self.assertFalse(dest.is_symlink())
        manifest=json.loads((self.output/'MANIFEST.json').read_bytes())
        materialized=[r for r in manifest['files']if 'materialization'in r]
        self.assertEqual(len(materialized),1)
        self.assertEqual(materialized[0]['output_sha256'],row['sha256'])

    def test_authorization_denies_before_plan_or_output(self):
        with mock.patch.object(copy,'load_plan',side_effect=AssertionError('must not readplan')):
            for auth in (None,{}, {'kind':'ROOT_REVIEWED_OFFLINE_DATA_COPY','release_event':True,
                'plan_sha256':copy.PLAN_SHA,'producer_sha256':'a'*64,'output':str(self.output)}):
                with self.assertRaises(copy.CopyRefused):copy.produce(auth)
        self.assertFalse(self.output.exists())

    def test_metadata_reads_hash_same_fd_and_duplicate_keys_refused(self):
        path=self.base/'plan.json';raw=b'{"version":1}';path.write_bytes(raw)
        self.assertEqual(copy._read_metadata(path,hashlib.sha256(raw).hexdigest()),raw)
        with self.assertRaises(copy.CopyRefused):copy._read_metadata(path,'0'*64)
        for raw in (b'{"x":1,"x":2}',b'{"x":NaN}'):
            with self.assertRaises(copy.CopyRefused):copy._json(raw)

    def test_readonly_pinned_real_plan_selection_no_usr_reads(self):
        # The allowed metadata plan is data. No source file is opened here.
        plan=copy.load_plan();rows=copy.prepare_selection(plan)
        self.assertEqual(len(rows),625);self.assertEqual(sum(r['bytes']for r in rows),22143399)
        aliases=[r for r in rows if 'materialization'in r];self.assertEqual(len(aliases),1)
        self.assertEqual(aliases[0]['source'],copy.ALIAS_TARGET)
        self.assertEqual(aliases[0]['sha256'],copy.ALIAS_SHA)
        self.assertNotEqual(aliases[0]['source'],copy.ALIAS_SOURCE)
        self.assertFalse(plan['blocked_internal_alias']['materialization_approved'])
        selected_tests=[r for r in rows if '/test/'in r['relative']]
        self.assertEqual(len(selected_tests),58)
        self.assertTrue(all(r['packages']==['libpython3.12-stdlib:amd64']for r in selected_tests))
        changed=deepcopy(plan);changed['regular_files'][0]['relative']='lib/python3.12/sitecustomize.py'
        with self.assertRaises(copy.CopyRefused):copy.prepare_selection(changed)

    def test_58_test_support_whitelist_is_not_generic_test_permission(self):
        copy._relative('lib/python3.12/test/support/__init__.py')
        for path in ('lib/python3.12/test/arbitrary.py','lib/python3.12/test/other/__init__.py'):
            with self.assertRaises(copy.CopyRefused):copy._relative(path)
        plan=copy.load_plan()
        row=next(r for r in plan['regular_files']if r['relative']=='lib/python3.12/test/support/__init__.py')
        row['sha256']='0'*64
        with self.assertRaisesRegex(copy.CopyRefused,'58_stdlib'):copy.prepare_selection(plan)

    def test_candidate_subtree_swap_is_rejected_before_manifest(self):
        real=copy.hash_whole_tree;foreign=self.base/'foreign-tree';foreign.mkdir(mode=0o700)
        def swap(tree,expected):
            result=real(tree,expected)
            (self.output/'python312').rename(self.output/'preserved-tree')
            (self.output/'python312').symlink_to(foreign,target_is_directory=True)
            return result
        with mock.patch.object(copy,'hash_whole_tree',side_effect=swap),self.assertRaises(copy.CopyRefused):self.run_fixture()
        self.assertFalse((self.output/'MANIFEST.json').exists())
        self.assertEqual(list(foreign.iterdir()),[])

    def test_only_known_alias_pin_can_be_selected(self):
        plan=copy.load_plan();plan['blocked_internal_alias']['sha256']='0'*64
        with self.assertRaisesRegex(copy.CopyRefused,'cross_package_alias'):copy.prepare_selection(plan)

    def test_v2_only_changes_target_prefix_and_binds_unchanged_v1(self):
        raw=copy._read_metadata(copy.ORIGINAL_PLAN,copy.ORIGINAL_PLAN_SHA)
        original=copy._json(raw);corrected=copy.load_plan();expected=deepcopy(original)
        previous=original['requested_projection_prefix']
        expected['requested_projection_prefix']=copy.CANONICAL_TARGET
        expected['executable']['target']=copy.CANONICAL_TARGET+'/bin/python3.12'
        for row in expected['regular_files']:row['target']=copy.CANONICAL_TARGET+'/'+row['relative']
        provenance=corrected.pop('prefix_correction_provenance')
        self.assertEqual(corrected,expected)
        self.assertEqual(provenance['original_plan_sha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(provenance['corrected_target_fields'],625)
        self.assertNotEqual(previous,copy.CANONICAL_TARGET)
        self.assertEqual(hashlib.sha256(Path(copy.ORIGINAL_PLAN).read_bytes()).hexdigest(),copy.ORIGINAL_PLAN_SHA)

    def test_only_canonical_future_targets_are_admitted(self):
        plan=copy.load_plan()
        self.assertEqual(plan['requested_projection_prefix'],copy.CANONICAL_TARGET)
        self.assertTrue(all(r['target']==copy.CANONICAL_TARGET+'/'+r['relative']for r in plan['regular_files']))
        self.assertEqual(plan['executable']['target'],copy.CANONICAL_TARGET+'/bin/python3.12')
        for part in ('prefix','binary','regular'):
            changed=deepcopy(plan)
            historical=plan['prefix_correction_provenance']['historical_unapproved_prefix']
            if part=='prefix':changed['requested_projection_prefix']=historical
            elif part=='binary':changed['executable']['target']=historical+'/bin/python3.12'
            else:changed['regular_files'][0]['target']=historical+'/'+changed['regular_files'][0]['relative']
            with self.subTest(part=part),self.assertRaises(copy.CopyRefused):copy.prepare_selection(changed)


if __name__=='__main__':unittest.main()
