"""Coordinator-side backend. One existing queue, no daemon or second scheduler.

Only internal transport results may reach accept_result(); it is not a public
RPC action. SSH authentication and profile/input qualification are separate.
"""
import base64
import hashlib
import json

import artifacts
import remote_contract as contract


class Finalizer:
    def __init__(self,claims,store):self.claims,self.store=claims,store

    def accept_result(self,manifest,receipt,payload,late_cancel=False):
        expected={"job_id":manifest["job_id"],"generation":manifest["generation"],"manifest_sha256":contract.digest(manifest),
                  "receipt_sha256":contract.digest(receipt),"invocation_id":None,"worker_boot_id":receipt["boot_id"]}
        # Inspect untrusted bytes before publishing. Invocation identity comes
        # from the authenticated worker's stopped-unit report, then is bound
        # against the same claim/receipt and any earlier unit observation.
        import io,tarfile
        if not isinstance(payload,bytes) or len(payload)>artifacts.MAX_BYTES:raise ValueError('bounded_bundle_required')
        with tarfile.open(fileobj=io.BytesIO(payload),mode='r:') as archive:
            index_members=[x for x in archive if x.name=='index.json']
            if len(index_members)!=1 or not index_members[0].isreg() or index_members[0].size>artifacts.MAX_INDEX:raise ValueError('unique_bounded_index_required')
            index=json.loads(archive.extractfile(index_members[0]).read(artifacts.MAX_INDEX+1))
        contract.hex_value(index.get('identity',{}).get('invocation_id'),32)
        expected['invocation_id']=index['identity']['invocation_id']
        _,_,result=artifacts.inspect(payload,expected)
        self.validate_result(manifest,receipt,expected,result)
        with contract.transaction(self.claims.path) as db:
            job,row,_=self.claims._identity(db,manifest)
            self.check_claim(row,receipt,expected['invocation_id'])
        custody=self.store.observe(expected)
        if custody['state']=='absent':self.store.receive(payload,expected)
        elif custody['state']!='verified':raise RuntimeError('artifact_receive_uncertain_observe_only')
        custody=self.store.observe(expected)
        if custody['state']!='verified' or custody['wire_sha256']!=artifacts.sha(payload):raise ValueError('artifact_custody_not_verified')
        terminal=result['outcome'];fingerprint=contract.digest(result)
        with contract.transaction(self.claims.path,True) as db:
            job,row,_=self.claims._identity(db,manifest)
            self.check_claim(row,receipt,expected['invocation_id'])
            if row['phase'] in {'completed','failed','canceled'}:
                if row['result_json']!=contract.canonical(result) or job['state']!=terminal:raise PermissionError('conflicting_terminal_result')
                return {'changed':False,'state':terminal,'result_sha256':fingerprint}
            if terminal=='canceled' and row['phase']!='cancel_requested':raise PermissionError('cancellation_intent_required')
            if row['phase']=='cancel_requested' and terminal!='canceled' and late_cancel is not True:raise PermissionError('cancel_result_required')
            if job['state'] not in {'starting','running'}:raise PermissionError('active_same_job_required')
            db.execute('UPDATE remote_execution_claims SET phase=?,invocation_id=?,result_json=?,updated_at=? WHERE job_id=?',
                       (terminal,expected['invocation_id'],contract.canonical(result),contract.now(),job['id']))
            db.execute('UPDATE jobs SET state=?,exit_code=?,finished_at=?,updated_at=?,error=? WHERE id=?',
                       (terminal,result['exit_code'],contract.now(),contract.now(),None if terminal=='completed' else 'remote_'+terminal,job['id']))
            self.claims._event(db,job['id'],'remote_'+terminal,{'result_sha256':fingerprint,'artifact_index_sha256':custody['index_sha256'],'wire_sha256':custody['wire_sha256'],'late_cancel':late_cancel is True})
        return {'changed':True,'state':terminal,'result_sha256':fingerprint}

    def check_claim(self,row,receipt,invocation):
        if not row or row['receipt_sha256']!=contract.digest(receipt) or row['phase'] not in {'permit_committed','cancel_requested','completed','failed','canceled'}:
            raise PermissionError('bound_consumed_claim_required')
        if row['invocation_id'] and row['invocation_id']!=invocation:raise PermissionError('claim_invocation_mismatch')

    def validate_result(self,manifest,receipt,identity,result):
        fields={'protocol','identity','profile','outcome','exit_code','unit_stop','runner_report','runner_report_valid','runner_report_sha256'}
        if not isinstance(result,dict) or set(result)!=fields or type(result['protocol']) is not int or result['protocol']!=1 or artifacts.identity(result['identity'])!=identity or result['profile']!=manifest['profile']:
            raise ValueError('exact_remote_result_required')
        if result['outcome'] not in {'completed','failed','canceled'} or type(result['runner_report_valid']) is not bool:raise ValueError('typed_remote_outcome_required')
        stop=result['unit_stop']
        if not isinstance(stop,dict) or set(stop)!={'unit','invocation_id','worker_boot_id','main_pid','cgroup_empty','unit_stopped','exit_code','canceled','receipt_sha256'}:
            raise ValueError('exact_stop_proof_required')
        if (stop['unit']!=receipt['unit'] or stop['invocation_id']!=identity['invocation_id'] or stop['worker_boot_id']!=receipt['boot_id']
                or type(stop['main_pid']) is not int or stop['main_pid']!=0 or stop['cgroup_empty'] is not True or stop['unit_stopped'] is not True
                or stop['receipt_sha256']!=contract.digest(receipt) or type(stop['canceled']) is not bool or stop['canceled']!=(result['outcome']=='canceled')
                or stop['exit_code']!=result['exit_code']):raise PermissionError('stopped_own_unit_proof_required')
        code=result['exit_code']
        if stop['exit_code'] is not None and type(stop['exit_code']) is not int:raise ValueError('typed_stop_exit_required')
        if code is None:
            if result['outcome']!='canceled':raise ValueError('known_exit_required')
        elif type(code) is not int or not 0<=code<=255:raise ValueError('typed_exit_required')
        if result['outcome']=='completed':
            report=result['runner_report']
            if code!=0 or result['runner_report_valid'] is not True or not isinstance(report,dict) or type(report.get('protocol')) is not int or report['protocol']!=1 or report.get('profile')!=manifest['profile'] or type(report.get('exit_code')) is not int or report['exit_code']!=0:
                raise PermissionError('successful_qualified_runner_result_required')

    def canceled_before_start(self,manifest,receipt,observation):
        if (not isinstance(observation,dict) or set(observation)!={'state','no_unit_created','receipt_sha256','worker_boot_id'}
                or observation['state']!='canceled_before_start' or observation['no_unit_created'] is not True
                or observation['receipt_sha256']!=contract.digest(receipt) or observation['worker_boot_id']!=receipt['boot_id']):raise PermissionError('canceled_prestart_proof_required')
        with contract.transaction(self.claims.path,True) as db:
            job,row,_=self.claims._identity(db,manifest)
            if row and row['phase']=='canceled' and job['state']=='canceled' and row['result_json']==contract.canonical(observation):return {'state':'canceled','changed':False}
            if not row or row['receipt_sha256']!=contract.digest(receipt) or row['phase']!='cancel_requested' or row['invocation_id']:
                raise PermissionError('unstarted_cancellation_claim_required')
            db.execute("UPDATE remote_execution_claims SET phase='canceled',result_json=?,updated_at=? WHERE job_id=?",(contract.canonical(observation),contract.now(),job['id']))
            db.execute("UPDATE jobs SET state='canceled',finished_at=?,updated_at=?,error='canceled_before_remote_start' WHERE id=?",(contract.now(),contract.now(),job['id']))
            self.claims._event(db,job['id'],'remote_canceled_before_start',{'receipt_sha256':contract.digest(receipt)})
        return {'state':'canceled'}


class Backend:
    def __init__(self,claims,transport,finalizer):self.claims,self.transport,self.finalizer=claims,transport,finalizer

    def dispatch(self,manifest,token):
        # Caller persists the random per-job secret in its private operation
        # envelope BEFORE this call. No credentials enter argv or public events.
        if not self.claims.reserve(manifest,token):raise RuntimeError('claim_exists_observe_same_job_no_dispatch_replay')
        receipt=self.transport.call(manifest['worker_id'],{'action':'prepare','manifest':manifest,'token_sha256':hashlib.sha256(token.encode()).hexdigest()})
        self.claims.bind(manifest,receipt)
        if not self.claims.authorize_once(manifest,token,contract.digest(receipt)):raise RuntimeError('permit_consumed_observe_only')
        result=self.transport.call(manifest['worker_id'],{'action':'start','manifest':manifest,'token':token,'receipt_sha256':contract.digest(receipt)})
        self.note_running(manifest,result.get('observation'))
        return result

    def observe(self,manifest):
        result=self.transport.call(manifest['worker_id'],{'action':'observe','id':manifest['job_id']})
        self.note_running(manifest,result)
        return result

    def note_running(self,manifest,observation):
        if not isinstance(observation,dict) or not isinstance(observation.get('unit'),dict):return False
        value=observation['unit'];contract.hex_value(value.get('invocation_id'),32)
        with contract.transaction(self.claims.path,True) as db:
            job,row,_=self.claims._identity(db,manifest)
            if not row or row['phase'] not in {'permit_committed','cancel_requested'}:return False
            receipt=json.loads(row['receipt_json'])
            if (value.get('unit')!=receipt['unit'] or value.get('worker_boot_id')!=receipt['boot_id'] or value.get('manifest_sha256')!=contract.digest(manifest)
                    or value.get('receipt_sha256')!=row['receipt_sha256']):raise PermissionError('remote_running_identity_mismatch')
            if row['invocation_id'] and row['invocation_id']!=value['invocation_id']:raise PermissionError('remote_unit_recreated')
            if row['invocation_id']:return False
            db.execute('UPDATE remote_execution_claims SET invocation_id=?,updated_at=? WHERE job_id=?',(value['invocation_id'],contract.now(),job['id']))
            db.execute("UPDATE jobs SET state='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?",(contract.now(),contract.now(),job['id']))
            self.claims._event(db,job['id'],'remote_running',{'invocation_id':value['invocation_id'],'worker_id':manifest['worker_id']})
            return True

    def logs(self,manifest,offset=0):
        if type(offset) is not int or not 0<=offset<=10*1024*1024:raise ValueError('bounded_log_offset_required')
        return self.transport.call(manifest['worker_id'],{'action':'logs','id':manifest['job_id'],'offset':offset})

    def finish(self,manifest,cancel=False):
        with contract.transaction(self.claims.path) as db:
            _,row,_=self.claims._identity(db,manifest)
            if not row or not row['receipt_json']:raise PermissionError('bound_worker_receipt_required')
            receipt=json.loads(row['receipt_json'])
            cancel=cancel or row['phase']=='cancel_requested'
        if cancel:self.claims.cancel_intent(manifest)
        answer=self.transport.call(manifest['worker_id'],{'action':'cancel' if cancel else 'finalize','id':manifest['job_id']})
        if answer.get('state')=='canceled_before_start':return self.finalizer.canceled_before_start(manifest,receipt,answer)
        bundle=self.transport.call(manifest['worker_id'],{'action':'bundle','id':manifest['job_id']})
        if set(bundle)!={'bundle_sha256','bundle_base64'}:raise ValueError('exact_bundle_reply_required')
        encoded=bundle['bundle_base64']
        if not isinstance(encoded,str) or len(encoded)>((artifacts.MAX_BYTES+2)//3)*4:raise ValueError('bounded_bundle_reply_required')
        payload=base64.b64decode(encoded,validate=True)
        if artifacts.sha(payload)!=bundle['bundle_sha256']:raise ValueError('wire_bundle_digest_mismatch')
        return self.finalizer.accept_result(manifest,receipt,payload,late_cancel=cancel and answer.get('late_cancel') is True)
