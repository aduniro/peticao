"""Real private filesystem; mocked mount syscall/table, NOT host qualification."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import project_storage as s
from systemd_adapter import SystemdAdapter

HERE = Path(__file__).parent


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='storage-', dir=HERE)
        self.base = Path(self.tmp.name)
        for name in ('runtime','private','public'):
            (self.base/name).mkdir(mode=0o700)
        self.root = self.base/'runtime/jobs'; self.root.mkdir(mode=0o700)
        self.manifest = {'job_id':'a'*32,'generation':1}
        self.receipt = {'unit':'admin-dev-'+'a'*32+'-g1.service','boot_id':'boot-1'}
        self.calls=[];self.mounted=False;self.mount_id=42;self.extra='';self.readonly=False
        self.source=self.root/s.state_name(self.manifest)/'work'
        self.target=self.base/'private'/s.state_name(self.manifest)
        self.original_stat=Path.stat
        def mapped_stat(path,*a,**kw):
            if self.mounted and path==self.target:
                return self.original_stat(self.source,*a,**kw)
            return self.original_stat(path,*a,**kw)
        self.patch=mock.patch.object(Path,'stat',mapped_stat);self.patch.start()
        self.storage=s.ProjectStorage(self.root,self.base/'private',self.base/'public',
                runner=self.run_mount,table_reader=self.table,uid=os.geteuid(),
                allowed_root=self.base/'runtime',boot_id=lambda:'boot-1')

    def tearDown(self):
        self.patch.stop();self.tmp.cleanup()

    def table(self):
        raw='1 0 8:1 / / rw - ext4 /dev/fixture rw\n'
        if self.mounted:
            raw+=f'{self.mount_id} 1 8:1 /fixture {self.target} '+('ro' if self.readonly else 'rw')+' - ext4 /dev/fixture rw\n'
        return raw+self.extra

    def run_mount(self,argv):
        self.calls.append(argv)
        if argv[0]=='/usr/bin/mount':self.mounted=True
        elif argv[0]=='/usr/bin/umount':self.mounted=False
        else:raise AssertionError(argv)

    def stopped(self):
        return {'unit':self.receipt['unit'],'worker_boot_id':'boot-1','main_pid':0,
                'cgroup_empty':True,'unit_stopped':True,'invocation_id':'b'*32}

    def test_prepare_proof_cleanup_retains_project_files(self):
        proof=self.storage.prepare(self.manifest,self.receipt)
        self.assertEqual(proof['source'],str(self.source))
        self.assertEqual(proof['mount_id'],42)
        (self.source/'output').write_text('fixture')
        self.assertEqual(self.storage.output_root(self.manifest,self.receipt),self.source)
        result=self.storage.cleanup(self.manifest,self.receipt,self.stopped())
        self.assertEqual(result['state'],'retained');self.assertFalse(self.target.exists())
        self.assertEqual((self.source/'output').read_text(),'fixture')
        record=json.loads((self.source.parent/'binding.json').read_text())
        self.assertEqual(record['state'],'retained')
        self.assertEqual(self.storage.status(self.manifest,self.receipt)['state'],'retained')
        self.assertEqual(self.calls[1],['/usr/bin/umount','--',str(self.target)])
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_wrong_boot_refused_before_effect(self):
        self.receipt['boot_id']='another-boot'
        with self.assertRaises(PermissionError):self.storage.prepare(self.manifest,self.receipt)
        self.assertFalse(self.calls);self.assertFalse(self.source.parent.exists())

    def test_foreign_unit_refused_before_effect(self):
        self.receipt['unit']='foreign.service'
        with self.assertRaises(PermissionError):self.storage.prepare(self.manifest,self.receipt)
        self.assertFalse(self.calls)

    def test_lost_mount_reply_retains_intent_never_replays(self):
        def fail(argv):self.run_mount(argv);raise TimeoutError('fixture lost reply')
        self.storage.runner=fail
        with self.assertRaises(TimeoutError):self.storage.prepare(self.manifest,self.receipt)
        with self.assertRaises(PermissionError):self.storage.prepare(self.manifest,self.receipt)
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)
        self.assertEqual(len(self.calls),1)
        self.assertEqual(json.loads((self.source.parent/'binding.json').read_text())['state'],'mount_intent')

    def test_occupied_target_refuses_without_mount(self):
        self.target.mkdir(mode=0o700)
        with self.assertRaises(PermissionError):self.storage.prepare(self.manifest,self.receipt)
        self.assertFalse(self.calls)

    def test_missing_mount_fails_verify(self):
        self.storage.prepare(self.manifest,self.receipt);self.mounted=False
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_replaced_mount_id_fails_verify(self):
        self.storage.prepare(self.manifest,self.receipt);self.mount_id=43
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_stack_mount_refused(self):
        self.storage.prepare(self.manifest,self.receipt)
        self.extra=f'43 1 8:1 /fixture {self.target} rw - ext4 /dev/fixture rw\n'
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_nested_mount_refused(self):
        self.storage.prepare(self.manifest,self.receipt)
        self.extra=f'43 42 8:1 /fixture {self.target}/nested rw - ext4 /dev/fixture rw\n'
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_readonly_mount_not_accepted(self):
        self.storage.prepare(self.manifest,self.receipt);self.readonly=True
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_foreign_manifest_receipt_cannot_reuse_binding(self):
        self.storage.prepare(self.manifest,self.receipt)
        with self.assertRaises(PermissionError):self.storage.verify({**self.manifest,'other':'changed'},self.receipt)
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,{**self.receipt,'other':'changed'})

    def test_output_symlink_rejected(self):
        self.storage.prepare(self.manifest,self.receipt)
        self.mounted=False;self.source.rmdir();self.source.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_binding_symlink_rejected(self):
        self.storage.prepare(self.manifest,self.receipt)
        path=self.source.parent/'binding.json';copy=self.source.parent/'copy';path.rename(copy);path.symlink_to(copy)
        with self.assertRaises(OSError):self.storage.verify(self.manifest,self.receipt)

    def test_cleanup_liveness_or_foreign_proof_rejected(self):
        self.storage.prepare(self.manifest,self.receipt)
        for key,value in [('unit','foreign.service'),('worker_boot_id','old'),('main_pid',1),('cgroup_empty',False),('unit_stopped',False)]:
            with self.subTest(key=key),self.assertRaises(PermissionError):
                self.storage.cleanup(self.manifest,self.receipt,{**self.stopped(),key:value})
        self.assertEqual(len(self.calls),1)

    def test_failed_unmount_stays_uncertain_and_never_retried(self):
        self.storage.prepare(self.manifest,self.receipt)
        self.storage.runner=lambda argv:None
        with self.assertRaises(PermissionError):self.storage.cleanup(self.manifest,self.receipt,self.stopped())
        self.assertEqual(json.loads((self.source.parent/'binding.json').read_text())['state'],'unmount_intent')
        with self.assertRaises(PermissionError):self.storage.cleanup(self.manifest,self.receipt,self.stopped())

    def test_foreign_public_alias_rejected(self):
        self.storage.prepare(self.manifest,self.receipt)
        (self.base/'public'/s.state_name(self.manifest)).symlink_to(self.root)
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_binding_receipt_hardlink_refused(self):
        self.storage.prepare(self.manifest,self.receipt)
        os.link(self.source.parent/'binding.json',self.source.parent/'duplicate')
        with self.assertRaises(PermissionError):self.storage.verify(self.manifest,self.receipt)

    def test_project_scope_refuses_system_tmp(self):
        with self.assertRaises(PermissionError):s.ProjectStorage('/tmp/foreign')

    def test_path_traversal_cannot_escape_project_scope(self):
        with self.assertRaises(PermissionError):
            s.ProjectStorage(self.base/'runtime/../outside',allowed_root=self.base/'runtime')

    def test_absence_after_lost_unmount_is_uncertain_not_success(self):
        self.storage.prepare(self.manifest,self.receipt)
        def lost(argv):self.run_mount(argv);raise TimeoutError('lost unmount response')
        self.storage.runner=lost
        with self.assertRaises(TimeoutError):self.storage.cleanup(self.manifest,self.receipt,self.stopped())
        self.assertEqual(self.storage.status(self.manifest,self.receipt),{'state':'uncertain','intent':'unmount_intent'})

    def test_retained_receipt_does_not_accept_new_mount(self):
        self.storage.prepare(self.manifest,self.receipt)
        self.storage.cleanup(self.manifest,self.receipt,self.stopped())
        self.extra=f'45 1 8:1 /fixture {self.target} rw - ext4 /dev/fixture rw\n'
        with self.assertRaises(PermissionError):self.storage.status(self.manifest,self.receipt)

    def test_root_storage_checks_all_ancestor_ownership(self):
        if os.geteuid()==0:self.skipTest('local nonroot ancestor fixture requires nonroot test operator')
        # Default production UID0 rejects the local user-owned project chain.
        with self.assertRaises(PermissionError):
            s.ProjectStorage(self.root,self.base/'private',self.base/'public',allowed_root=self.base/'runtime')

    def test_default_adapter_requires_project_storage(self):
        adapter=SystemdAdapter()
        with self.assertRaises(PermissionError):adapter.output_root(self.manifest,self.receipt,{})

    def test_tmp_denied_without_disabling_dynamic_user_or_private_tmp(self):
        argv=SystemdAdapter().unit_argv(self.manifest,self.receipt,{'name':'fixture-pass','python_path':'/usr/bin/python3','program':'/opt/job.py'})
        self.assertIn('--property=PrivateTmp=yes',argv);self.assertIn('--property=DynamicUser=yes',argv)
        self.assertIn('/tmp /var/tmp',next(x for x in argv if x.startswith('--property=InaccessiblePaths=')))


class MountTableTests(unittest.TestCase):
    def test_decode_mount_escape(self):
        self.assertEqual(s.mountinfo('1 0 8:1 / /a\\040b rw - ext4 /dev/x rw')[0]['target'],'/a b')

    def test_invalid_missing_duplicate_or_oversize_mount_table(self):
        for raw in ('','garbage','1 0 8:1 / / rw - ext4 /dev/x rw\n1 0 8:1 / /b rw - ext4 /dev/x rw','x'*4194305):
            with self.subTest(size=len(raw)),self.assertRaises(ValueError):s.mountinfo(raw)


class AdapterStorageTests(unittest.TestCase):
    def setUp(self):
        self.storage=mock.Mock();self.adapter=SystemdAdapter(boot_id=lambda:'boot-1',storage=self.storage)
        self.manifest={'job_id':'a'*32,'generation':1}
        self.receipt={'unit':'admin-dev-'+'a'*32+'-g1.service','boot_id':'boot-1'}
        self.binding={'invocation_id':'b'*32,'main_pid':0,'cgroup_empty':True,'cgroup_path':'/system.slice/'+self.receipt['unit']}
        self.descriptor={'name':'fixture-pass','program':'/opt/fixture.py','python_path':'/usr/bin/python3'}

    def test_mount_failure_never_launches_unit_or_replays(self):
        self.adapter.preflight=mock.Mock();self.adapter.command=mock.Mock()
        self.storage.prepare.side_effect=TimeoutError('fixture uncertain mount')
        with self.assertRaises(TimeoutError):self.adapter.start(self.manifest,self.receipt,self.descriptor)
        self.adapter.command.assert_not_called();self.storage.prepare.assert_called_once()

    def test_cleanup_requires_fresh_identity_liveness_and_inactive_unit(self):
        self.adapter.observe=mock.Mock(return_value=self.binding)
        self.adapter.cgroup_empty=mock.Mock(return_value=True)
        self.adapter.properties=mock.Mock(return_value={'ActiveState':'inactive','SubState':'dead'})
        self.adapter.cleanup_storage(self.manifest,self.receipt,self.descriptor,self.binding)
        proof=self.storage.cleanup.call_args.args[-1]
        self.assertEqual(proof['invocation_id'],'b'*32);self.assertTrue(proof['unit_stopped'])
        self.adapter.observe.assert_called_once();self.adapter.cgroup_empty.assert_called_once()

    def test_cleanup_refuses_recreated_or_absent_unit(self):
        for current in (None,{**self.binding,'invocation_id':'c'*32},{**self.binding,'main_pid':1},{**self.binding,'cgroup_empty':False}):
            self.adapter.observe=mock.Mock(return_value=current)
            with self.subTest(current=current),self.assertRaises(PermissionError):
                self.adapter.cleanup_storage(self.manifest,self.receipt,self.descriptor,self.binding)
        self.storage.cleanup.assert_not_called()

    def test_cleanup_refuses_active_exited_even_when_pid_zero(self):
        self.adapter.observe=mock.Mock(return_value=self.binding)
        self.adapter.cgroup_empty=mock.Mock(return_value=True)
        self.adapter.properties=mock.Mock(return_value={'ActiveState':'active','SubState':'exited'})
        with self.assertRaises(PermissionError):self.adapter.cleanup_storage(self.manifest,self.receipt,self.descriptor,self.binding)
        self.storage.cleanup.assert_not_called()


if __name__=='__main__':unittest.main()
