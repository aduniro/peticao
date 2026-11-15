"""Local regression evidence only; no systemd, native bus or host execution."""
import copy
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import qualification_contract as q
import qualification_helper as h

class HelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='helper-')
        self.root=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def retirement(self):
        r={'manifest':{'job_id':'1'*32,'generation':1},'receipt_sha256':'2'*64,'bundle_sha256':'3'*64,'custody_receipt_sha256':'4'*64}
        b={'invocation_id':'5'*32,'boot_id':'6'*32}
        a={'state':'retained','identity':{'job_id':'1'*32,'generation':1,'manifest_sha256':q.digest(r['manifest']),'receipt_sha256':'2'*64,'bundle_sha256':'3'*64,'custody_receipt_sha256':'4'*64,'invocation_id':'5'*32,'worker_boot_id':'6'*32},'unit_reference_released':True}
        return r,b,a
    def test_exact_typed_retirement(self):
        r,b,a=self.retirement();self.assertEqual(h.retirement_result(r,a,b,q),a)
        mutations=[('unit_reference_released',1),('unit_reference_released',False),('state','completed')]
        for k,v in mutations:
            bad=copy.deepcopy(a);bad[k]=v
            with self.assertRaises(PermissionError):h.retirement_result(r,bad,b,q)
        for k,v in [('generation',True),('generation',1.0),('bundle_sha256','7'*64),('invocation_id','8'*32)]:
            bad=copy.deepcopy(a);bad['identity'][k]=v
            with self.assertRaises(PermissionError):h.retirement_result(r,bad,b,q)
    def test_exclusive_intent_survives_partial_retry(self):
        p=self.root/'intent.json';h.exclusive(p,{'first':True})
        with self.assertRaises(FileExistsError):h.exclusive(p,{'first':False})
        self.assertEqual(json.loads(p.read_text()),{'first':True})
        self.assertEqual(p.stat().st_mode&0o777,0o600)
    def test_exclusive_does_not_follow_symlink(self):
        target=self.root/'target';target.write_text('preserve');p=self.root/'intent';p.symlink_to(target)
        with self.assertRaises(FileExistsError):h.exclusive(p,{'bad':True})
        self.assertEqual(target.read_text(),'preserve')
    def test_spawn_intent_missing_receipt_is_uncertain(self):
        with mock.patch.object(q,'PRIVATE',self.root):
            h.exclusive(self.root/'server-spawn-2.json',{})
            self.assertEqual(h.pending_process_intents(None),['server-spawn-2.json'])
            h.exclusive(self.root/'server-process-2.json',{})
            self.assertEqual(h.pending_process_intents(None),[])
    def test_start_validates_before_creating_intent(self):
        core=SimpleNamespace(build=mock.Mock(side_effect=PermissionError('wrong_boot')))
        with mock.patch.object(q,'PRIVATE',self.root),mock.patch.object(h.subprocess,'Popen') as popen:
            with self.assertRaises(PermissionError):h.start({}, {},core)
            popen.assert_not_called();self.assertEqual(list(self.root.iterdir()),[])
    def test_cleanup_missing_process_receipt_never_declares_safe(self):
        import contextlib
        core=SimpleNamespace(execution_lock=contextlib.nullcontext)
        with mock.patch.object(q,'PRIVATE',self.root):
            h.exclusive(self.root/'start-intent.json',{})
            with self.assertRaisesRegex(PermissionError,'spawn_outcome_uncertain'):h.cleanup({}, {},core)
    def test_observe_missing_receipt_never_spawns(self):
        with mock.patch.object(q,'PRIVATE',self.root),mock.patch.object(h.subprocess,'Popen') as popen:
            h.exclusive(self.root/'start-intent.json',{})
            answer=h.observe({}, {},SimpleNamespace())
            self.assertEqual(answer['state'],'UNCERTAIN_PENDING_PROCESS_RECEIPT');self.assertIs(answer['no_replay'],True);popen.assert_not_called()
    def test_readback_only_retirement_action(self):
        transport=SimpleNamespace(call=mock.Mock(return_value={'state':'uncertain','no_replay':True}))
        self.assertEqual(h.readback({'transport':transport},{},{'action':'retire'}),{'state':'uncertain','no_replay':True})
        transport.call.assert_called_once_with('civo',{'action':'retirement'})
    def test_reference_and_isolation_validation(self):
        identity={'pid':42,'boot_id':'boot'};values={};trace=[]
        for n,state,code,j in [('success','completed',0,'1'*32),('failure','failed',7,'2'*32),('cancellation','canceled',None,'3'*32)]:
            inv='a'*32
            values[n]={'state':state,'exit_code':code,'unit_stopped':True,'cgroup_empty':True,'artifact_verified':True,'isolation':{k:True for k in q.CHECKS},'physical_backing':{'same_device_inode':True,'project_backing':True,'root_private_parent':True,'direct_access_denied':True},'state_directory_persisted':True,'invocation_id':inv,'cgroup_pids_before_stop':2,'retirement':{'identity':{'job_id':j}}}
            for stage,s in [('before-retire','mounted'),('after-retire','retained')]:trace.append({'job_id':j,'stage':stage,'identity':identity,'reference':{'invocation_id':inv},'storage':{'state':s,'mount_absent':s=='retained'}})
        core=SimpleNamespace(reference_proof=mock.Mock(return_value={'genuine_guard_called':True}))
        self.assertTrue(h.validate_paths(copy.deepcopy(values),trace,identity,core));self.assertEqual(core.reference_proof.call_count,3)
        for mutation in ('missing_check','numeric_check','failure93','cancel_one_pid','wrong_state'):
            bad=copy.deepcopy(values)
            if mutation=='missing_check':bad['failure']['isolation'].pop(next(iter(q.CHECKS)))
            if mutation=='numeric_check':bad['success']['isolation'][next(iter(q.CHECKS))]=1
            if mutation=='failure93':bad['failure']['exit_code']=93
            if mutation=='cancel_one_pid':bad['cancellation']['cgroup_pids_before_stop']=1
            if mutation=='wrong_state':bad['failure']['state']='completed'
            with self.assertRaises(PermissionError):h.validate_paths(bad,trace,identity,core)
        for badtrace in (trace[:-1],trace+trace[:1],list(reversed(trace))):
            with self.assertRaises(PermissionError):h.validate_paths(copy.deepcopy(values),badtrace,identity,core)
    def test_negative_startup_mutates_only_own_journal_copy(self):
        import sqlite3
        original=self.root/'receipts.sqlite'
        with sqlite3.connect(original) as db:
            db.execute('CREATE TABLE receipts(job_id TEXT,state TEXT)')
            db.execute('INSERT INTO receipts VALUES(?,?)',('a'*32,'completed'))
        journal=SimpleNamespace(path=original)
        class RetirementUncertain(RuntimeError):pass
        keeper=SimpleNamespace(records={},close=mock.Mock())
        def startup():
            with sqlite3.connect(journal.path) as db:
                self.assertEqual(db.execute('SELECT state FROM receipts').fetchone()[0],'running')
            raise RetirementUncertain()
        factory=mock.Mock(return_value=SimpleNamespace(startup=startup))
        core=SimpleNamespace(build=mock.Mock(return_value={'journal':journal,'worker':'synthetic-service'}))
        native=mock.Mock(return_value=keeper)
        modules={'unit_refs':SimpleNamespace(UnitReferences=native),'broker_lifecycle':SimpleNamespace(Lifecycle=factory,RetirementUncertain=RetirementUncertain)}
        context={'journal':SimpleNamespace(path=original)}
        with mock.patch.object(q,'PRIVATE',self.root):
            result=h.negative_startup({'jobs':{'success':'a'*32}},modules,core,context)
        self.assertIs(result['rejected'],True);self.assertIs(result['listener_created'],False)
        native.assert_called_once_with();keeper.close.assert_called_once_with()
        with sqlite3.connect(original) as db:self.assertEqual(db.execute('SELECT state FROM receipts').fetchone()[0],'completed')
        self.assertNotEqual(journal.path,original)

    def test_quarantine_proof_is_precise_and_scope_bound(self):
        request={'jobs':{'success':'1'*32,'failure':'2'*32,'cancellation':'3'*32}};identity={'pid':42}
        proof={'identity':identity,'error_type':'ReferenceUncertain','refsLostTrue':True,'recordsCount':0,'scope':'closed_connection_after_release_no_held_reference_io_claim','retained':[{'job_id':j,'retained':'retained','mount_absent':True} for j in request['jobs'].values()]}
        self.assertTrue(h.quarantine_proof(proof,identity,request))
        for field,value in [('recordsCount',False),('recordsCount',0.0),('refsLostTrue',1),('error_type','RuntimeError'),('scope','global'),('retained',[])]:
            bad=copy.deepcopy(proof);bad[field]=value
            with self.assertRaises(PermissionError):h.quarantine_proof(bad,identity,request)

    def test_native_log_probe_rejects_wrong_job_offset_and_unavailable(self):
        message='synthetic namespace qualification; no credential values\n'
        answer={'id':'a'*32,'offset':len(message.encode()),'output':message,'available':True}
        backend=SimpleNamespace(logs=mock.Mock(return_value=answer))
        proof=h.log_probe({'backend':backend},{'job_id':'a'*32})
        self.assertIs(proof['verified'],True);self.assertNotIn('output',proof)
        for field,value in [('available',1),('available',False),('id','b'*32),('offset',True),('output','other')]:
            backend.logs.return_value={**answer,field:value}
            with self.assertRaises(PermissionError):h.log_probe({'backend':backend},{'job_id':'a'*32})

    def test_saved_result_requires_exact_scope(self):
        for r in ({},{'state':'NATIVE_BROKER_A_PASS','scope':'global','global_qualified':True}):
            with self.assertRaises(PermissionError):h.validate_saved({}, {},None,r)

if __name__=='__main__':unittest.main()
