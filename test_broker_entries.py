import ast
import builtins
import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest import mock

import broker_entry as e
import broker_server as s

HERE = Path(__file__).parent


class Entries(unittest.TestCase):
    def setUp(self):
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.runtime = {p.name: p.read_bytes() for p in (HERE/'runtime').glob('*.py') if p.name != 'fixture_support.py'}
        self.codes = {name:(HERE/name).read_bytes() for name in e.FILES}
        self.broker_pins = {k:hashlib.sha256(v).hexdigest() for k,v in self.codes.items()}
        self.runtime_pins = {k:hashlib.sha256(v).hexdigest() for k,v in self.runtime.items()}
        self.broker_evidence = {'status':'PASS', 'host':'peticao-civo', 'boot_id':self.boot,
                                'broker_code_sha256':self.broker_pins,
                                'runtime_code_sha256':dict(self.runtime_pins)}
        self.worker_profiles = {'fixture-pass':{'name':'fixture-pass'}}
        self.worker_evidence = {'status':'PASS', 'worker_id':'civo', 'boot_id':self.boot,
                               'runtime_code_sha256':dict(self.runtime_pins),
                               'profile_catalog_sha256':hashlib.sha256(json.dumps(self.worker_profiles,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
        self.policy_overrides = {}
        self.old_path = list(sys.path)

    def tearDown(self): sys.path[:] = self.old_path

    def reader(self, path, mode=None, **kwargs):
        path = Path(path)
        if path.name == 'broker-qualification.json': return json.dumps(self.broker_evidence).encode()
        if path.name == 'broker.json':
            v = {'status':'QUALIFIED_BROKER', 'host':'peticao-civo', 'boot_id':self.boot,
                 'evidence_sha256':hashlib.sha256(json.dumps(self.broker_evidence).encode()).hexdigest(),
                 'code_sha256':self.broker_pins}
            return json.dumps({**v, **self.policy_overrides}).encode()
        if path.name == 'qualification.json': return json.dumps(self.worker_evidence).encode()
        if path.name == 'runtime.json':
            return json.dumps({'status':'QUALIFIED_RUNTIME', 'worker_id':'civo',
                'qualification_manifest_event':3195, 'profiles':self.worker_profiles,
                'qualification_evidence_sha256':hashlib.sha256(json.dumps(self.worker_evidence).encode()).hexdigest()}).encode()
        return self.codes[path.name] if path.parent == e.LIB else self.runtime[path.name]

    def validate(self, kind='proxy'):
        with mock.patch.object(e.os,'geteuid',return_value=0), mock.patch.object(e.socket,'gethostname',return_value='peticao-civo'), mock.patch.object(e,'read_root',side_effect=self.reader):
            return e.validate(kind)

    def test_both_code_closures_and_current_boot_are_verified_before_imports(self):
        policy, evidence = self.validate()
        self.assertEqual(policy['status'], 'QUALIFIED_BROKER')
        self.assertEqual(evidence['runtime_code_sha256'], self.runtime_pins)

    def test_tampered_broker_or_runtime_never_imports_service(self):
        for group, name in [(self.codes,'broker_lifecycle.py'), (self.runtime,'worker.py')]:
            saved = group[name]
            group[name] = b"raise AssertionError('unchecked code must never run')"
            with self.subTest(name=name), self.assertRaises(PermissionError): self.validate()
            group[name] = saved

    def test_missing_code_pin_refused(self):
        del self.broker_pins['broker_lifecycle.py']
        with self.assertRaises(PermissionError): self.validate()

    def test_reboot_unqualified_host_or_evidence_change_refused(self):
        for key, value in [('boot_id','another-boot'), ('status','NOT_QUALIFIED'), ('host','other-node'), ('evidence_sha256','f'*64)]:
            self.policy_overrides = {key:value}
            with self.subTest(key=key), self.assertRaises(PermissionError): self.validate()

    def test_broker_and_runtime_evidence_must_bind_same_code(self):
        self.broker_evidence['runtime_code_sha256']['worker.py'] = 'f'*64
        with self.assertRaises(PermissionError): self.validate()

    def test_namespace_check_is_mandatory_for_broker_not_proxy(self):
        with mock.patch.object(e,'manager_namespace',side_effect=PermissionError('different namespace')) as guard:
            self.validate('proxy');guard.assert_not_called()
            with self.assertRaises(PermissionError): self.validate('broker')
            guard.assert_called_once()

    def test_manager_mount_namespace_mismatch_refused(self):
        real = e.os.stat
        def altered(path, *a, **kw):
            if path == '/proc/1/ns/mnt':
                i = real('/proc/self/ns/mnt')
                return mock.Mock(st_dev=i.st_dev, st_ino=i.st_ino+1)
            return real(path,*a,**kw)
        with mock.patch.object(e.os,'stat',side_effect=altered), self.assertRaises(PermissionError): e.manager_namespace()

    def test_changed_manager_tmp_view_refused(self):
        real = e.os.stat
        def altered(path, *a, **kw):
            if path == '/proc/1/ns/mnt': return real('/proc/self/ns/mnt')
            if path == '/proc/1/root/tmp':
                i = real('/tmp');return mock.Mock(st_dev=i.st_dev, st_ino=i.st_ino+1)
            return real(path,*a,**kw)
        with mock.patch.object(e.os,'stat',side_effect=altered), self.assertRaises(PermissionError): e.manager_namespace()

    def test_root_reader_refuses_untrusted_fixture_file(self):
        with tempfile.TemporaryDirectory(prefix='broker-fixture-',dir=HERE) as d:
            p=Path(d)/'policy.json';p.write_text('{}');p.chmod(0o600)
            if os.geteuid() != 0:
                with self.assertRaises(PermissionError): e.read_root(p)

    def test_activation_foreign_pid_or_extra_fd_refused_before_socket_use(self):
        with mock.patch.object(s.os,'geteuid',return_value=0), mock.patch.object(s.socket,'fromfd') as fd:
            for env in ({}, {'LISTEN_PID':str(os.getpid()+1),'LISTEN_FDS':'1'}, {'LISTEN_PID':str(os.getpid()),'LISTEN_FDS':'2'}):
                with self.assertRaises(PermissionError): s.inherited_listener(env)
            fd.assert_not_called()

    def test_activation_requires_exact_local_listening_socket(self):
        env={'LISTEN_PID':str(os.getpid()),'LISTEN_FDS':'1'}
        conn=mock.Mock(family=socket.AF_UNIX)
        conn.getsockname.return_value=str(s.SOCKET)
        conn.getsockopt.side_effect=lambda level,option:socket.SOCK_STREAM if option==socket.SO_TYPE else 1
        with mock.patch.object(s.os,'geteuid',return_value=0),mock.patch.object(s,'trusted_endpoint'),mock.patch.object(s.socket,'fromfd',return_value=conn),mock.patch.object(s.os,'set_inheritable') as cloexec:
            self.assertIs(s.inherited_listener(env),conn)
            cloexec.assert_called_once_with(3,False)
            conn.getsockname.return_value=('127.0.0.1',22)
            with self.assertRaises(PermissionError):s.inherited_listener(env)
            conn.close.assert_called_once()

    def test_real_local_endpoint_permissions_and_links(self):
        with tempfile.TemporaryDirectory(prefix='broker-fixture-',dir=HERE) as d:
            path=Path(d)/'worker.sock'
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as sock:
                # The project's absolute path exceeds sockaddr_un capacity.
                # Bind a short relative name within the same physical project
                # directory, never place the fixture in the host /tmp.
                cwd=os.open('.',os.O_RDONLY|os.O_DIRECTORY)
                try:
                    os.chdir(d);sock.bind('worker.sock')
                finally:
                    os.fchdir(cwd);os.close(cwd)
                sock.listen(1);path.chmod(0o600)
                # Ambient developer ancestors can be group writable. Model
                # only those ancestors as protected; keep the actual fixture
                # directory, UNIX inode, modes and symlink observations real.
                original=Path.lstat
                def trusted_ambient(p,*args,**kwargs):
                    if p in Path(d).parents:
                        return mock.Mock(st_mode=0o40755,st_uid=0)
                    return original(p,*args,**kwargs)
                with mock.patch.object(Path,'lstat',trusted_ambient):
                    self.assertEqual(s.trusted_endpoint(path,os.geteuid()),path)
                    path.chmod(0o666)
                    with self.assertRaises(PermissionError):s.trusted_endpoint(path,os.geteuid())
                    path.chmod(0o600);link=Path(d)/'link.sock';link.symlink_to(path)
                    with self.assertRaises(PermissionError):s.trusted_endpoint(link,os.geteuid())

    def test_unvalidated_runtime_not_imported_on_bad_broker_policy(self):
        original=builtins.__import__
        def guard(name,*a,**kw):
            if name in {'broker_lifecycle','worker','unit_refs','rpc'}:
                raise AssertionError('service imported before both closures were validated')
            return original(name,*a,**kw)
        self.policy_overrides={'status':'NOT_QUALIFIED'}
        with mock.patch('builtins.__import__',side_effect=guard),self.assertRaises(PermissionError):self.validate()

    def test_entry_top_level_has_no_runtime_or_bus_imports(self):
        for name in ('broker_entry.py','broker_proxy.py'):
            for n in ast.parse((HERE/name).read_text()).body:
                if isinstance(n,ast.Import):
                    self.assertFalse({a.name for a in n.names}&{'worker','unit_refs','rpc','broker_lifecycle'})
                if isinstance(n,ast.ImportFrom):
                    self.assertNotIn(n.module,{'worker','unit_refs','rpc','broker_lifecycle'})

    def test_drain_refuses_new_launch_but_allows_retirement(self):
        server=s.Server.__new__(s.Server);server.draining=True;server.lifecycle=mock.Mock(return_value={'state':'retained'})
        for action in ('prepare','start'):
            with self.assertRaises(RuntimeError):server.handle({'action':action})
        server.lifecycle.assert_not_called()
        self.assertEqual(server.handle({'action':'retire'}),{'state':'retained'})

    def test_held_or_uncertain_references_prevent_graceful_exit(self):
        server=s.Server.__new__(s.Server);server.lifecycle=mock.Mock();refs=server.lifecycle.references
        refs.lost=False;refs.records={'u':{'state':'held'}};self.assertFalse(server.drained())
        refs.records={'u':{'state':'released'}};self.assertTrue(server.drained())
        refs.lost=True;self.assertFalse(server.drained())


if __name__ == '__main__': unittest.main()
