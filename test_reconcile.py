import contextlib
import copy
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import types
import unittest
from unittest import mock

import reconcile as r
import host
import client
import gate

HERE = Path(__file__).resolve().parent


class Port:
    def __init__(self):
        self.p = r.PRODUCTION
        self.manifest = {'job_id': self.p.job, 'generation': 1, 'worker_id': 'civo', 'epoch_sha256': 'e' * 64}
        self.receipt = {'unit': self.p.unit, 'boot_id': self.p.boot}
        self.p = replace(self.p, manifest_sha256=r.digest(self.manifest), receipt_sha256=r.digest(self.receipt))
        self.binding = json.loads((HERE / 'REFERENCE-RO.json').read_text())['binding']
        self.binding['receipt_sha256'] = self.p.receipt_sha256
        self.binding['stop_proof']['receipt_sha256'] = self.p.receipt_sha256
        identity = {'pid': self.p.runner_pid, 'start_ticks': '12345', 'boot_id': self.p.boot}
        self.runners = {'run-intent.json': {**identity, 'operation_id': 'd071f0d87a954a519b8d0e07233ca370'}, 'runner-receipt.json': {**identity, 'started_detached': True}}
        self.auth = {'operation_id': 'b' * 32, 'event': 4000, 'fence': 1000, 'operation': 'test', 'resource': r.RESOURCE, 'session': r.SESSION, 'reviewed': True}
        self.lock = {'execution_exclusive': True, 'admission_exclusive': True, 'enabled': False, 'epoch_sha256': 'e' * 64}
        p = self.p
        self.snap = {'boot_id': p.boot, 'manager_view_verified': True, 'runner_identity': identity, 'runner_state': 'absent',
                     'unit': {'name': p.unit, 'LoadState': 'not-found', 'ActiveState': 'inactive', 'SubState': 'dead', 'MainPID': 0, 'ControlGroup': '', 'InvocationID': ''},
                     'cgroup': {'path': p.cgroup, 'v2_mount_verified': True, 'empty': True, 'absent': True, 'pids_count': 0, 'populated': 0},
                     'mount': {'mount_id': p.mount_id, 'device': p.device, 'inode': p.inode, 'source': p.source, 'target': p.target, 'underlay_device': p.device, 'underlay_inode': p.underlay_inode, 'single': True, 'nested': False, 'rw': True},
                     'paths': {'parent': {'path': p.parent, 'device': p.device, 'inode': p.parent_inode, 'uid': 0, 'gid': 0, 'mode': 448, 'no_symlink_chain': True},
                               'alias': {'path': p.public, 'uid': 0, 'symlink': True, 'target': p.target}}, 'storage_state': 'mounted'}
        for name, path in (('source', p.source), ('target', p.target)):
            self.snap['paths'][name] = {'path': path, 'device': p.device, 'inode': p.inode, 'uid': 65469, 'gid': 65469, 'mode': 448, 'no_symlink_chain': True}
        h = r.history(self.manifest, self.receipt, self.binding, self.runners, p)
        self.snap['durable_records_sha256'] = {k: h[k] for k in ('manifest_sha256', 'receipt_sha256', 'binding_sha256', 'runners_sha256')}
        self.after = {'state': 'retained', 'source': p.source, 'device': p.device, 'inode': p.inode, 'uid': 0, 'mode': 448, 'mount_absent': True, 'target_absent': True, 'alias_absent': True, 'manifest_sha256': p.manifest_sha256, 'receipt_sha256': p.receipt_sha256, 'stopped_invocation_id': p.invocation, 'root_private_parent_preserved': True}
        self.effects = []; self.held = False; self.snapshots = 0

    def authorize(self): return copy.deepcopy(self.auth)

    @contextlib.contextmanager
    def exclusive_closed(self):
        self.held = True
        try: yield self.lock
        finally: self.held = False

    def history(self): return copy.deepcopy((self.manifest, self.receipt, self.binding, self.runners))
    def lock_receipt(self): return copy.deepcopy(self.lock)
    def snapshot(self):
        assert self.held
        self.snapshots += 1
        return copy.deepcopy(self.snap)
    def new_intent(self, value): self.effects.append(('intent', copy.deepcopy(value)))
    def cleanup(self, *args):
        assert self.held
        self.effects.append(('cleanup', args))
    def final_readback(self): return copy.deepcopy(self.after)
    def new_receipt(self, value): self.effects.append(('receipt', copy.deepcopy(value)))


class Recovery(unittest.TestCase):
    def setUp(self): self.port = Port()
    def run_case(self): return r.reconcile(self.port, pins=self.port.p)

    def test_combined_durable_and_fresh_proof_allows_only_exact_retention(self):
        result = self.run_case()
        self.assertEqual([x[0] for x in self.port.effects], ['intent', 'cleanup', 'receipt'])
        self.assertEqual(self.port.snapshots, 2); self.assertFalse(self.port.held)
        self.assertFalse(result['qualification_pass']); self.assertFalse(result['old_attempt_retried'])
        self.assertEqual(result['stop_proof_sha256'], r.digest(self.port.binding['stop_proof']))

    def test_original_production_hash_cannot_accept_synthetic_objects(self):
        with self.assertRaises(r.Refused): r.reconcile(self.port)
        self.assertEqual(self.port.effects, [])

    def test_missing_or_forged_durable_binding_never_uses_absence(self):
        for key, value in [('stop_proof', None), ('invocation_id', '0'*32), ('bundle_sha256', '0'*64), ('receipt_sha256', '0'*64)]:
            with self.subTest(key=key):
                self.port = Port(); self.port.binding[key] = value
                with self.assertRaises(r.Refused): self.run_case()
                self.assertEqual(self.port.effects, [])

    def test_full_stop_proof_types_and_fields_are_required(self):
        for key, value in [('main_pid', False), ('exit_code', False), ('unit_stopped', 1), ('cgroup_empty', False), ('worker_boot_id', 'other'), ('canceled', True)]:
            with self.subTest(key=key):
                self.port = Port(); self.port.binding['stop_proof'][key] = value
                with self.assertRaises(r.Refused): self.run_case()
                self.assertEqual(self.port.effects, [])

    def test_manifest_or_receipt_content_is_rehashed(self):
        for target in ('manifest', 'receipt'):
            self.port = Port(); getattr(self.port, target)['extra'] = 'changed'
            with self.assertRaises(r.Refused): self.run_case()
            self.assertEqual(self.port.effects, [])

    def test_runner_requires_both_records_and_matching_ticks(self):
        for change in ('missing', 'ticks', 'boot', 'pid'):
            self.port = Port()
            if change == 'missing': del self.port.runners['run-intent.json']
            elif change == 'ticks': self.port.runners['runner-receipt.json']['start_ticks'] = '999'
            elif change == 'boot': self.port.runners['runner-receipt.json']['boot_id'] = 'other'
            else: self.port.runners['run-intent.json']['pid'] = 1
            with self.assertRaises(r.Refused): self.run_case()
            self.assertEqual(self.port.effects, [])

    def test_runner_live_or_pid_reused_is_refused(self):
        self.port.snap['runner_state'] = 'present'
        with self.assertRaises(r.Refused): self.run_case()
        self.assertEqual(self.port.effects, [])

    def test_runner_receipts_bind_original_operation_and_detached_start(self):
        for record,key,value in [('run-intent.json','operation_id','other'),('runner-receipt.json','started_detached',False)]:
            self.port = Port();self.port.runners[record][key] = value
            with self.assertRaises(r.Refused):self.run_case()
            self.assertEqual(self.port.effects,[])

    def test_boot_namespace_and_durable_record_changes_refused(self):
        for key, value in [('boot_id','other'), ('manager_view_verified',False), ('durable_records_sha256',{})]:
            self.port = Port(); self.port.snap[key] = value
            with self.assertRaises(r.Refused): self.run_case()

    def test_not_found_without_exact_inactive_identity_is_insufficient(self):
        for key, value in [('LoadState','loaded'),('MainPID',1),('MainPID',False),('InvocationID','f'*32),('ControlGroup','/foreign'),('name','foreign.service')]:
            self.port = Port(); self.port.snap['unit'][key] = value
            with self.assertRaises(r.Refused): self.run_case()

    def test_cgroup_errors_or_unverified_absence_never_qualify(self):
        for key,value in [('v2_mount_verified',False),('empty',False),('populated',1),('pids_count',True),('absent',False),('path','')]:
            self.port = Port(); self.port.snap['cgroup'][key] = value
            with self.assertRaises(r.Refused): self.run_case()
        self.port = Port(); self.port.snapshot = mock.Mock(side_effect=PermissionError('unreadable'))
        with self.assertRaises(PermissionError): self.run_case()
        self.assertEqual(self.port.effects, [])

    def test_swapped_stacked_nested_or_readonly_mount_refused(self):
        for key,value in [('mount_id',65),('device',1),('inode',1),('underlay_inode',1),('target','/other'),('source','/other'),('single',False),('nested',True),('rw',False)]:
            self.port = Port(); self.port.snap['mount'][key] = value
            with self.assertRaises(r.Refused): self.run_case()

    def test_parent_alias_and_leaf_paths_strict(self):
        for section,key,value in [('parent','uid',False),('parent','mode',511),('alias','uid',False),('alias','target','/foreign'),('source','no_symlink_chain',False),('target','inode',1),('source','mode',511)]:
            self.port = Port(); self.port.snap['paths'][section][key] = value
            with self.assertRaises(r.Refused): self.run_case()

    def test_old_storage_intent_or_retained_is_not_replayed(self):
        for value in ('unmount_intent','mount_intent','retained'):
            self.port = Port(); self.port.snap['storage_state'] = value
            with self.assertRaises(r.Refused): self.run_case()
            self.assertEqual(self.port.effects, [])

    def test_ex_and_persistently_closed_same_epoch_required(self):
        for key,value in [('execution_exclusive',False),('admission_exclusive',False),('enabled',True),('epoch_sha256','0'*64)]:
            self.port = Port(); self.port.lock[key] = value
            with self.assertRaises(r.Refused): self.run_case()
            self.assertEqual(self.port.effects, [])

    def test_old_or_wrong_scope_authority_refused(self):
        for key,value in [('operation_id','d071f0d87a954a519b8d0e07233ca370'),('event',3151),('reviewed',False),('session','other'),('operation','deploy'),('resource','other')]:
            self.port = Port(); self.port.auth[key] = value
            with self.assertRaises(r.Refused): self.run_case()
            self.assertEqual(self.port.effects, [])

    def test_new_intent_collision_never_calls_cleanup(self):
        self.port.new_intent = mock.Mock(side_effect=FileExistsError())
        with self.assertRaises(r.Uncertain): self.run_case()
        self.assertEqual(self.port.effects, [])

    def test_second_fresh_snapshot_change_stays_uncertain_without_umount(self):
        original = self.port.snapshot
        def changed():
            value = original()
            if self.port.snapshots == 2: value['mount']['inode'] += 1
            return value
        self.port.snapshot = changed
        with self.assertRaises(r.Uncertain): self.run_case()
        self.assertEqual([x[0] for x in self.port.effects], ['intent'])

    def test_lost_umount_response_or_final_publication_never_replays(self):
        for method in ('cleanup', 'new_receipt'):
            self.port = Port(); setattr(self.port, method, mock.Mock(side_effect=OSError('lost')))
            with self.assertRaises(r.Uncertain): self.run_case()
            self.assertFalse(self.port.held)

    def test_post_unmount_underlay_alias_or_owner_failure_is_uncertain(self):
        for key,value in [('inode',1),('uid',65469),('mode',511),('mount_absent',False),('target_absent',False),('alias_absent',False),('stopped_invocation_id','0'*32),('root_private_parent_preserved',False)]:
            self.port = Port(); self.port.after[key] = value
            with self.assertRaises(r.Uncertain): self.run_case()
            self.assertEqual([x[0] for x in self.port.effects], ['intent','cleanup'])


class Wrapper(unittest.TestCase):
    def test_wrong_host_or_uninstalled_path_refused_before_read(self):
        with mock.patch.object(host.os, 'geteuid', return_value=1000), mock.patch.object(host, 'read') as read:
            with self.assertRaises(PermissionError): host.load('x')
            read.assert_not_called()

    def test_host_has_no_side_effect_on_import_and_no_free_phase(self):
        with mock.patch.object(host.sys, 'argv', ['host.py','start','x']), mock.patch.object(host, 'load') as load:
            with self.assertRaises(ValueError): host.main()
            load.assert_not_called()

    def test_default_ssh_denies_before_network_or_pin_read(self):
        with mock.patch.object(client.subprocess, 'run') as run:
            with self.assertRaises(PermissionError): client.SSH().call('cleanup')
            run.assert_not_called()

    def test_no_free_transport_phase(self):
        with self.assertRaises(ValueError): client.SSH().call('start')

    def test_installer_is_syntax_only_never_executed(self):
        compile(client.INSTALLER, '<fixed-installer>', 'exec')
        self.assertNotIn('shutil.rmtree',client.INSTALLER)
        self.assertIn('O_EXCL',client.INSTALLER)

    def test_local_intent_is_exclusive_and_preserves_first_record(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix='fixture-') as directory:
            path=Path(directory)/'intent.json';client.intent(path,{'first':True})
            with self.assertRaises(FileExistsError):client.intent(path,{'first':False})
            self.assertEqual(json.loads(path.read_text()),{'first':True})

    def test_ssh_exact_identity_nomux_and_aggregate_only(self):
        request={'authorization':Port().auth,'execute':True,'code_sha256':{}}
        answer=types.SimpleNamespace(returncode=0,stdout=json.dumps({'state':'EXACT_ATTEMPT2_PREFLIGHT_VERIFIED','mount_count':1,'qualification_pass':False}).encode())
        with mock.patch.object(client.Path,'read_bytes',return_value=b'pin'), mock.patch.object(client.hashlib,'sha256',return_value=types.SimpleNamespace(hexdigest=lambda:client.KNOWN_SHA)), mock.patch.object(client.subprocess,'run',return_value=answer) as run:
            client.SSH(lambda _:request).call('preflight')
        args=run.call_args.args[0]
        self.assertIn('ControlMaster=no',args);self.assertIn('ControlPath=none',args);self.assertIn(client.IDENTITY,args);self.assertIn('root@100.122.224.82',args)
        self.assertIn('preflight',args[-1]);self.assertNotIn('start',args[-1])

    def test_scope_changes_before_ssh_are_refused(self):
        request={'authorization':Port().auth,'execute':True,'code_sha256':{}}
        guard=mock.Mock(side_effect=[request,{}])
        with mock.patch.object(client.subprocess,'run') as run:
            with self.assertRaises(PermissionError):client.SSH(guard).call('preflight')
            run.assert_not_called()

    def test_gate_rejects_wrong_notice_author_before_git_or_ack(self):
        with mock.patch.object(gate,'event',return_value={'kind':'notice','actor':'apoio','resources':[r.RESOURCE],'data':{}}):
            with self.assertRaises(PermissionError):gate.reviewed(4000)

    def test_gate_missing_independent_ack_is_refused(self):
        with mock.patch.object(gate,'central',return_value=[]):
            with self.assertRaises(PermissionError):gate.ack(4000)

    def test_capability_session_scope_expiry_and_binding_are_checked(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix='fixture-') as directory:
            path=Path(directory)/'cap.json'
            record={'operator_session':r.SESSION,'result':{'lease':'fixture-only','token':'synthetic','fence':1,'seq':3900}}
            current={'id':'fixture-only','actor':'admin-recuperacao','operation':'test','resources':[r.RESOURCE],'expires':10000}
            acquisition={'kind':'lease_acquired','actor':'admin-recuperacao','data':{'manifest_event':4000,'lease':'fixture-only'}}
            for scenario in ('session','resource','expiry','event'):
                item=copy.deepcopy(record);status=copy.deepcopy(current);acq=copy.deepcopy(acquisition)
                if scenario=='session':item['operator_session']='other'
                elif scenario=='resource':status['resources']=['other']
                elif scenario=='expiry':status['expires']=100
                else:acq['data']['manifest_event']=3999
                path.write_text(json.dumps(item));path.chmod(0o600)
                def central(args):return {'leases':[status]} if args[0]=='status' else {'valid':True}
                with mock.patch.object(gate,'central',side_effect=central),mock.patch.object(gate,'event',return_value=acq),mock.patch.object(gate.time,'time',return_value=100):
                    with self.assertRaises(PermissionError):gate.lease(path,4000)

    def test_host_bad_own_hash_is_refused_before_any_dynamic_import(self):
        request={'authorization':Port().auth,'execute':True,'code_sha256':{n:'0'*64 for n in ('host.py','reconcile.py','SOURCE-PINS.json')}}
        members=[host.PUBLIC/n for n in ('host.py','reconcile.py','SOURCE-PINS.json','RUN-RECONCILE.json')]
        with mock.patch.object(host.os,'geteuid',return_value=0),mock.patch.object(host.socket,'gethostname',return_value='peticao-civo'),mock.patch.object(host,'__file__',str(host.PUBLIC/'host.py')),mock.patch.object(host,'trusted',side_effect=lambda path,*_,**__:path),mock.patch.object(host,'read',return_value=request),mock.patch.object(host.Path,'iterdir',return_value=members),mock.patch.object(host.Path,'read_bytes',return_value=b'synthetic-code'),mock.patch.object(host,'import_exact') as imp:
            with self.assertRaises(PermissionError):host.load(host.sha(request))
            imp.assert_not_called()

    def test_host_journal_reads_are_readonly_and_do_not_initialize_schema(self):
        port=host.HostPort.__new__(host.HostPort);port.p=Port().p
        with tempfile.TemporaryDirectory(dir=HERE,prefix='fixture-') as directory:
            base=Path(directory);(base/'journal').mkdir();dbpath=base/'journal/receipts.sqlite'
            original=Port()
            with sqlite3.connect(dbpath) as db:
                db.execute('CREATE TABLE receipts(job_id,manifest_json,receipt_json)');db.execute('CREATE TABLE unit_bindings(job_id,receipt_sha256,invocation_id,cgroup_path,stop_proof,bundle_sha256)')
                db.execute('INSERT INTO receipts VALUES(?,?,?)',(port.p.job,json.dumps(original.manifest),json.dumps(original.receipt)))
                binding=original.binding
                db.execute('INSERT INTO unit_bindings VALUES(?,?,?,?,?,?)',(port.p.job,binding['receipt_sha256'],binding['invocation_id'],binding['cgroup_path'],json.dumps(binding['stop_proof']),binding['bundle_sha256']))
            for name,value in original.runners.items():(base/name).write_text(json.dumps(value))
            before=hashlib.sha256(dbpath.read_bytes()).hexdigest()
            with mock.patch.object(host,'PRIVATE',base),mock.patch.object(host,'trusted',side_effect=lambda path,**_:path),mock.patch.object(host,'read',side_effect=lambda path:json.loads(path.read_text())):
                manifest,receipt,binding,runners=port.history()
            self.assertEqual(r.digest(manifest),port.p.manifest_sha256);self.assertEqual(before,hashlib.sha256(dbpath.read_bytes()).hexdigest())


if __name__ == '__main__':unittest.main()
