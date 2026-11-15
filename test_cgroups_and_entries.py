import ast
import builtins
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import cgroups
import entry_bootstrap as boot
import rpc
import client_entry

HERE=Path(__file__).parent
GROUP='/system.slice/admin-dev-'+'a'*32+'-g1.service'


class CgroupTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='cgroup-',dir=HERE);self.base=Path(self.tmp.name)
        (self.base/'cgroup.controllers').write_text('cpu memory pids io\n')
        self.root=self.base/GROUP.lstrip('/');self.root.mkdir(parents=True)
        (self.root/'cgroup.procs').write_text('');(self.root/'cgroup.events').write_text('populated 0\nfrozen 0\n')

    def tearDown(self):self.tmp.cleanup()
    def observe(self):return cgroups.snapshot(GROUP,self.base)

    def test_existing_complete_empty_tree(self):self.assertTrue(self.observe()['empty'])

    def test_explicit_absence_only_with_validated_v2_mount(self):
        for p in self.root.iterdir():p.unlink()
        self.root.rmdir();self.assertTrue(self.observe()['absent'])
        (self.base/'cgroup.controllers').unlink()
        with self.assertRaises(FileNotFoundError):self.observe()

    def test_existing_tree_missing_procs_never_empty(self):
        (self.root/'cgroup.procs').unlink()
        with self.assertRaises(ValueError):self.observe()

    def test_existing_tree_missing_events_never_empty(self):
        (self.root/'cgroup.events').unlink()
        with self.assertRaises(FileNotFoundError):self.observe()

    def test_unreadable_procs_propagates(self):
        original=cgroups.read
        def read(path,*args):
            if Path(path).name=='cgroup.procs':raise PermissionError('fixture denied')
            return original(path,*args)
        with mock.patch.object(cgroups,'read',side_effect=read):
            with self.assertRaises(PermissionError):self.observe()

    def test_walk_permission_error_not_silently_empty(self):
        def walk(*args,**kw):kw['onerror'](PermissionError('fixture denied traversal'));return iter(())
        with mock.patch.object(cgroups.os,'walk',side_effect=walk):
            with self.assertRaises(PermissionError):self.observe()

    def test_walk_no_observation_not_empty(self):
        with mock.patch.object(cgroups.os,'walk',return_value=iter(())):
            with self.assertRaises(ValueError):self.observe()

    def test_populated_event_is_not_empty_even_without_root_pids(self):
        (self.root/'cgroup.events').write_text('populated 1\n')
        self.assertFalse(self.observe()['empty'])

    def test_child_processes_counted_and_child_event_required(self):
        child=self.root/'child';child.mkdir();(child/'cgroup.procs').write_text('41\n42\n');(child/'cgroup.events').write_text('populated 1\n')
        value=self.observe();self.assertEqual(value['pids_count'],2);self.assertFalse(value['empty'])
        (child/'cgroup.events').unlink()
        with self.assertRaises(ValueError):self.observe()

    def test_invalid_event_or_pid_is_unknown(self):
        for raw in ('','populated 2\n','populated 0\npopulated 0\n','populated unknown\n'):
            (self.root/'cgroup.events').write_text(raw)
            with self.assertRaises(ValueError):self.observe()
        (self.root/'cgroup.events').write_text('populated 0\n');(self.root/'cgroup.procs').write_text('not-pid\n')
        with self.assertRaises(ValueError):self.observe()

    def test_directory_and_procs_links_refused(self):
        child=self.root/'link';child.symlink_to(self.base,target_is_directory=True)
        with self.assertRaises(ValueError):self.observe()
        child.unlink();(self.root/'cgroup.procs').unlink();(self.root/'cgroup.procs').symlink_to(self.base/'cgroup.controllers')
        with self.assertRaises(OSError):self.observe()

    def test_changing_root_populated_does_not_prove_empty(self):
        original=cgroups.events;count=0
        def events(path):
            nonlocal count
            if Path(path)==self.root:
                count+=1
                return {'populated':1 if count>=3 else 0}
            return original(path)
        with mock.patch.object(cgroups,'events',side_effect=events):self.assertFalse(self.observe()['empty'])

    def test_unexpected_group_and_missing_controllers_refused(self):
        with self.assertRaises(ValueError):cgroups.snapshot('/system.slice/foreign.service',self.base)
        (self.base/'cgroup.controllers').write_text('cpu\n')
        with self.assertRaises(ValueError):self.observe()


class EntryTests(unittest.TestCase):
    def setUp(self):
        self.lib=Path('/fixture-library')
        self.boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.profile={'fixture-pass':{}}
        self.code={name:('fixture public code '+name).encode() for name in boot.CODE_FILES}
        self.evidence={'status':'PASS','worker_id':'civo','controller_host':'peticao-civo','boot_id':self.boot,
                       'runtime_code_sha256':{name:hashlib.sha256(raw).hexdigest() for name,raw in self.code.items()},
                       'profile_catalog_sha256':hashlib.sha256(json.dumps(self.profile,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
        self.config={'status':'QUALIFIED_RUNTIME','worker_id':'civo','profiles':self.profile,'qualification_manifest_event':1}

    def fixture_reader(self,path,public=False):
        path=Path(path)
        if path.name in {'qualification.json','transport-qualification.json'}:return json.dumps(self.evidence).encode()
        if path.name in {'runtime.json','transport.json'}:
            raw=json.dumps(self.evidence).encode();return json.dumps({**self.config,'qualification_evidence_sha256':hashlib.sha256(raw).hexdigest()}).encode()
        return self.code[path.name]

    def validate(self,kind='worker'):
        with mock.patch.object(boot.os,'geteuid',return_value=0),mock.patch.object(boot.socket,'gethostname',return_value='peticao-civo'):
            return boot.validate_packet(kind,self.lib,self.fixture_reader)

    def test_complete_code_closure_validated_before_runtime(self):
        config,_=self.validate();self.assertEqual(config['worker_id'],'civo')
        self.code['worker.py']=b"raise AssertionError('unchecked runtime must never execute')"
        with self.assertRaises(PermissionError):self.validate()

    def test_missing_or_tampered_code_pin_refused(self):
        self.evidence['runtime_code_sha256'].pop('cgroups.py')
        with self.assertRaises(PermissionError):self.validate()

    def test_old_boot_and_unqualified_config_refused(self):
        self.evidence['boot_id']='other-boot'
        with self.assertRaises(PermissionError):self.validate()
        self.evidence['boot_id']=self.boot;self.config['status']='NOT_QUALIFIED'
        with self.assertRaises(PermissionError):self.validate()

    def test_shims_embed_exact_bootstrap_hash(self):
        value=hashlib.sha256((HERE/'entry_bootstrap.py').read_bytes()).hexdigest()
        self.assertEqual(rpc.BOOTSTRAP_SHA256,value);self.assertEqual(client_entry.BOOTSTRAP_SHA256,value)

    def test_no_runtime_top_level_imports_in_shims_or_bootstrap(self):
        own={'worker','artifacts','remote_contract','transport','controller','admission','systemd_adapter','rpc','entry_bootstrap','cgroups'}
        for name in ('rpc.py','client_entry.py','entry_bootstrap.py'):
            tree=ast.parse((HERE/name).read_text())
            for node in tree.body:
                if isinstance(node,ast.Import):self.assertFalse({x.name.split('.')[0] for x in node.names}&own)
                elif isinstance(node,ast.ImportFrom):self.assertNotIn(node.module.split('.')[0],own)

    def test_failed_bootstrap_never_reaches_runtime_imports(self):
        original=builtins.__import__
        def import_guard(name,*args,**kw):
            if name in {'remote_contract','worker','systemd_adapter','admission','transport'}:raise AssertionError('runtime imported before validation')
            return original(name,*args,**kw)
        with mock.patch.object(rpc,'_load_bootstrap',side_effect=PermissionError('fixture bad pin')),mock.patch('builtins.__import__',side_effect=import_guard):
            with self.assertRaises(PermissionError):rpc.make_service()

    def test_reader_no_follow_refuses_user_owned_metadata(self):
        with tempfile.TemporaryDirectory(prefix='entry-',dir=HERE) as d:
            p=Path(d)/'config.json';p.write_text('{}')
            with self.assertRaises(PermissionError):boot.read_root(p)


if __name__=='__main__':unittest.main()
