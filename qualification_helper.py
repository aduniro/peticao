#!/usr/bin/python3 -IB
"""Isolated A operator. No effects on import; frozen root installation required.

Public CLI: preflight/bootstrap/start/observe/cleanup. _run is a fixed internal
child, bounded by the same pins, exclusive start intent and execution lock.
No mutation is retried after uncertain transport, process or storage outcomes.
"""
import hashlib
import base64
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
# -I removes the script directory; trust the root bootstrap before imports.
if __name__ == '__main__':
    public = Path('/opt/peticao-dev-short-alias-native-20261115-attempt1')
    if os.geteuid() != 0 or Path(__file__).absolute() != public/'qualification_helper.py':
        raise PermissionError('fixed_root_helper_required')
    for directory in [*reversed(public.parents),public]:
        info=directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022:
            raise PermissionError('root_bootstrap_chain_required')
    for name in ('qualification_helper.py','qualification_contract.py','fixture_core.py'):
        info=(public/name).lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o644:
            raise PermissionError('root_bootstrap_file_required')
    sys.path.insert(0,str(public))
import qualification_contract as q

ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}


def exclusive(path, value):
    """An uncertain/crashed intent burns the phase; never overwrite it."""
    raw = q.canonical(value).encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw); f.flush(); os.fsync(f.fileno())
    fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def deadline(predicate, seconds=25):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = predicate()
        if value: return value
        time.sleep(.1)
    raise TimeoutError('observe_same_id_only_no_replay')


def retirement_request(context, modules, manifest, token):
    c = modules['remote_contract']
    with c.transaction(context['claims'].path) as db:
        job, claim, _ = context['claims']._identity(db, manifest)
    if job['state'] not in {'completed','failed','canceled'} or claim['phase'] != job['state']:
        raise PermissionError('canonical_terminal_claim_required')
    result = json.loads(claim['result_json'])
    custody = context['store'].observe(result['identity'])
    if custody['state'] != 'verified': raise PermissionError('actual_custody_required')
    # Receipt is the exact verified on-disk custody receipt, excluding observe's
    # derived state/result fields. This is an authenticated coordinator attestation.
    receipt = {k:custody[k] for k in ('identity','wire_sha256','index_sha256','files')}
    return {'action':'retire','manifest':manifest,'token':token,
            'receipt_sha256':claim['receipt_sha256'], 'bundle_sha256':custody['wire_sha256'],
            'custody_receipt_sha256':c.digest(receipt)}


def retirement_result(request, answer, binding, c):
    expected = {'state':'retained','identity':{
        'job_id':request['manifest']['job_id'],'generation':request['manifest']['generation'],
        'manifest_sha256':c.digest(request['manifest']),
        'receipt_sha256':request['receipt_sha256'],'bundle_sha256':request['bundle_sha256'],
        'custody_receipt_sha256':request['custody_receipt_sha256'],
        'invocation_id':binding['invocation_id'],'worker_boot_id':binding['boot_id']},
        'unit_reference_released':True}
    if type(answer) is not dict or q.canonical(answer)!=q.canonical(expected):raise PermissionError('exact_typed_retained_reply_required')
    return answer


def exact_wire(modules, request):
    modules['broker_server'].trusted_endpoint(q.SOCKET)
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as conn:
        conn.settimeout(15);conn.connect(str(q.SOCKET))
        return modules['broker_wire'].proxy_once(conn,request)


def validate_paths(values, trace, identity, core):
    if type(values) is not dict or set(values)!={'success','failure','cancellation'}:
        raise PermissionError('exact_three_native_paths_required')
    if type(trace) is not list or len(trace)!=6:
        raise PermissionError('exact_six_native_reference_events_required')
    seen=set()
    for name,expected in (('success','completed'),('failure','failed'),('cancellation','canceled')):
        value=values[name];checks=value.get('isolation')
        if (value.get('state')!=expected or value.get('unit_stopped') is not True or value.get('cgroup_empty') is not True
                or value.get('artifact_verified') is not True or type(checks) is not dict or set(checks)!=q.CHECKS
                or not all(type(v) is bool and v for v in checks.values())
                or q.canonical(value.get('physical_backing'))!=q.canonical({'same_device_inode':True,'project_backing':True,'root_private_parent':True,'direct_access_denied':True})
                or value.get('state_directory_persisted') is not True):
            raise PermissionError('actual_native_isolation_and_custody_required')
        code=value.get('exit_code')
        if code is not None and (type(code) is not int or not 0<=code<=255):raise PermissionError('bounded_actual_exit_required')
        if ((name=='success' and (type(code) is not int or code!=0))
                or (name=='failure' and (type(code) is not int or code!=7))
                or (name=='cancellation' and ((code is not None and type(code) is not int) or type(value.get('cgroup_pids_before_stop')) is not int or value['cgroup_pids_before_stop']<2))):
            raise PermissionError('actual_fixture_outcomes_required')
        job=value['retirement']['identity']['job_id']
        if job in seen:raise PermissionError('distinct_native_jobs_required')
        seen.add(job)
        rows=[r for r in trace if r.get('job_id')==job]
        if len(rows)!=2 or [r.get('stage') for r in rows]!=['before-retire','after-retire'] or any(r.get('identity')!=identity for r in rows):
            raise PermissionError('same_persistent_broker_trace_required')
        before,after=rows
        rbefore,rafter=before['reference'],after['reference']
        if (before['storage'].get('state')!='mounted' or after['storage'].get('state')!='retained' or after['storage'].get('mount_absent') is not True
                or rbefore['invocation_id']!=value['invocation_id']):
            raise PermissionError('retirement_storage_reference_order_required')
        value['unit_reference']=core.reference_proof(rbefore,rafter,q.unit(job),value['invocation_id'],identity['pid'],identity['boot_id'])
        value['storage_retained']=True
    return True


def trace_read(core, incarnation):
    path=core.root_file(q.PRIVATE/('ref-trace-'+incarnation+'.jsonl'),mode=0o600)
    with path.open('rb') as f:raw=f.read(4*1024*1024+1)
    if len(raw)>4*1024*1024:raise PermissionError('bounded_private_trace_required')
    return [json.loads(line) for line in raw.splitlines()]


def readback(context, modules, request):
    answer=context['transport'].call('civo',{**request,'action':'retirement'})
    if answer.get('state')=='uncertain' and answer=={'state':'uncertain','no_replay':True}:return answer
    row,binding=context['worker'].stored(request['manifest']['job_id'])
    if not binding:raise PermissionError('retirement_requires_original_binding')
    receipt=json.loads(row['receipt_json'])
    return retirement_result(request,answer,{**binding,'boot_id':receipt['boot_id']},modules['remote_contract'])


def lost_retire(modules, request):
    """Real frame reaches the real broker; close without receiving. No retry."""
    modules['broker_server'].trusted_endpoint(q.SOCKET)
    wire = modules['broker_wire']
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
        client.settimeout(15); client.connect(str(q.SOCKET));wire.peer(client,0)
        wire.send(client,wire.encode(request),wire.MAX_REQUEST)
        client.shutdown(socket.SHUT_WR)
    # Only a distinct read-only retirement action follows this uncertain write.


def preflight(request, modules, core):
    core.actual_version(request, modules)
    audit=modules['storage_probe'].TmpAudit(core.boot_id(),[q.unit(j) for j in request['jobs'].values()],core.actual_version(request,modules))
    try:core.host_tmp_proof(audit)
    finally:audit.close()
    for path in (q.PRIVATE,q.SOCKET_PARENT):
        if os.path.lexists(path):raise PermissionError('occupied_attempt_refused')
    adapter=modules['systemd_adapter'].SystemdAdapter()
    for job in [*request['jobs'].values(),request['prestart_job_id']]:
        if adapter.properties(q.unit(job))['LoadState']!='not-found':
            raise PermissionError('occupied_fixture_unit_refused')
        name=adapter.state_name({'job_id':job,'generation':1})
        if any(os.path.lexists(Path(p)/name) for p in ('/var/lib','/var/lib/private')):
            raise PermissionError('occupied_fixture_state_refused')
    return {'state':'PREFLIGHT_A_PASS','scope':'isolated-short-alias','global_qualified':False}


def bootstrap(request, modules, core):
    preflight(request,modules,core)
    context=core.bootstrap(request,modules)
    q.SOCKET_PARENT.mkdir(mode=0o700)  # exact absent parent; never chown shared /run
    (q.PRIVATE/'retirements').mkdir(mode=0o700)
    core.durable(modules,'socket-parent.json',{'operation_sha256':q.digest(request),'device':q.SOCKET_PARENT.stat().st_dev,'inode':q.SOCKET_PARENT.stat().st_ino})
    return {'state':'BOOTSTRAPPED_A_CLOSED','job_count':4,'global_qualified':False}


def spawn_server(request, modules, core, incarnation):
    path=q.PRIVATE/('server-spawn-'+incarnation+'.json')
    exclusive(path,{'incarnation':incarnation,'operation_sha256':q.digest(request),'boot_id':core.boot_id()})
    fd=os.open(q.PRIVATE/('server-'+incarnation+'.log'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as out:
        proc=subprocess.Popen([str(Path(sys.executable).resolve()),'-I','-B',str(q.PUBLIC/'broker_a_server.py'),incarnation,q.digest(request)],stdin=subprocess.DEVNULL,stdout=out,stderr=out,close_fds=True,env=ENV)
    identity=core.process_identity(proc.pid)
    core.durable(modules,'server-process-'+incarnation+'.json',identity)
    ready=q.PRIVATE/('ready-'+incarnation+'.json')
    def observed():
        if proc.poll() is not None:raise RuntimeError('broker_startup_failed_no_restart')
        return core.read_json(ready) if ready.exists() else None
    result=deadline(observed)
    expected={**identity,'incarnation':incarnation,'operation_id':request['operation_id'],'request_sha256':q.digest(request)}
    if result.get('identity') != expected:raise PermissionError('actual_broker_identity_required')
    return proc,expected


def stop_normal(proc, identity, core):
    if not core.alive(identity):raise PermissionError('broker_identity_changed_before_signal')
    os.kill(proc.pid,signal.SIGTERM)
    if proc.wait(timeout=20)!=0:raise RuntimeError('broker_graceful_close_failed')
    if os.path.lexists(q.SOCKET):raise PermissionError('broker_socket_not_cleanly_closed')


def prestart(request,modules,core,context):
    c=modules['remote_contract'];m=core.enqueue(request,modules,context,'prestart')
    token=core.read_json(q.PRIVATE/'tokens'/(m['job_id']+'.json'))['token']
    exclusive(q.PRIVATE/'prestart-prepare-intent.json',{'manifest_sha256':c.digest(m)})
    if not context['claims'].reserve(m,token):raise PermissionError('prestart_claim_already_exists')
    receipt=context['transport'].call('civo',{'action':'prepare','manifest':m,'token_sha256':hashlib.sha256(token.encode()).hexdigest()})
    context['claims'].bind(m,receipt)
    answer=context['backend'].finish(m,cancel=True)
    row,binding=context['worker'].stored(m['job_id'])
    if (answer.get('state')!='canceled' or row['state']!='canceled_before_start' or binding is not None
            or row['invocation_id'] is not None or context['adapter'].properties(q.unit(m['job_id']))['LoadState']!='not-found'):
        raise PermissionError('actual_prestart_no_unit_required')
    try: context['storage'].status(m,receipt)
    except FileNotFoundError: pass
    else: raise PermissionError('prestart_has_storage')
    return {'state':'canceled_before_start','no_unit_created':True,'job_id':m['job_id']}


def all_retained(context,modules,core,request):
    rows=[]
    for job in request['jobs'].values():
        row,binding=context['worker'].stored(job)
        if not binding:raise PermissionError('all_bound_jobs_required')
        m=json.loads(row['manifest_json']);receipt=json.loads(row['receipt_json'])
        core.retained(context,modules,m,receipt,binding);rows.append((m,receipt,binding))
    return rows


def log_probe(context, manifest):
    answer=context['backend'].logs(manifest,0)
    expected='synthetic namespace qualification; no credential values\n'
    if (type(answer) is not dict or set(answer)!={'id','offset','output','available'} or answer['id']!=manifest['job_id']
            or answer['available'] is not True or type(answer['offset']) is not int or answer['offset']!=len(expected.encode())
            or answer['output']!=expected):raise PermissionError('actual_bounded_synthetic_log_required')
    return {'available':True,'bytes':len(expected.encode()),'verified':True}


def quarantine_proof(proof, identity, request):
    if (type(proof) is not dict or q.canonical(proof.get('identity'))!=q.canonical(identity)
            or proof.get('error_type')!='ReferenceUncertain' or proof.get('refsLostTrue') is not True
            or type(proof.get('recordsCount')) is not int or proof['recordsCount']!=0
            or proof.get('scope')!='closed_connection_after_release_no_held_reference_io_claim'):
        raise PermissionError('actual_empty_reference_quarantine_required')
    rows=proof.get('retained')
    if type(rows) is not list or len(rows)!=3 or {r.get('job_id') for r in rows if type(r) is dict}!=set(request['jobs'].values()):
        raise PermissionError('three_quarantine_retained_jobs_required')
    if any(type(r) is not dict or set(r)!={'job_id','retained','mount_absent'} or r['retained']!='retained' or r['mount_absent'] is not True for r in rows):
        raise PermissionError('actual_quarantine_retained_proofs_required')
    return True


def negative_startup(request,modules,core,context):
    """Mutate only a fresh COPY of this fixture journal, never the real floor."""
    path=q.PRIVATE/'negative-startup.sqlite'
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)
    with sqlite3.connect(context['journal'].path) as src,sqlite3.connect(path) as dst:src.backup(dst)
    with sqlite3.connect(path) as db:db.execute("UPDATE receipts SET state='running' WHERE job_id=?",(request['jobs']['success'],))
    # The primary broker is stopped, all physical storage already retained. This
    # separate no-listener probe uses one genuine native keeper and never reRefs.
    keeper=modules['unit_refs'].UnitReferences()
    try:
        cloned=core.build(request,modules,references=keeper)
        cloned['journal'].path=path
        lifecycle=modules['broker_lifecycle'].Lifecycle(cloned['worker'],keeper,q.PRIVATE/'retirements')
        try:lifecycle.startup()
        except modules['broker_lifecycle'].RetirementUncertain:
            if keeper.records:raise PermissionError('negative_startup_rearmed_reference')
        else:raise PermissionError('unfinished_journal_startup_was_accepted')
    finally:
        if keeper.records:raise PermissionError('unexpected_negative_reference_preserve')
        keeper.close()
    return {'copied_journal_only':True,'rejected':True,'listener_created':False,'reference_count':0}


def foreign_uid_probe():
    # Kernel permissions on real private socket. Never relax ownership/modes.
    program="import socket,errno,sys;s=socket.socket(socket.AF_UNIX);\ntry:s.connect(sys.argv[1])\nexcept OSError as e:sys.exit(0 if e.errno==errno.EACCES else 2)\nelse:sys.exit(3)"
    answer=subprocess.run([str(Path(sys.executable).resolve()),'-I','-B','-c',program,str(q.SOCKET)],user=65534,group=65534,extra_groups=[],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=ENV,timeout=10,close_fds=True)
    if answer.returncode!=0:raise PermissionError('real_foreign_uid_eacces_required')
    return {'foreign_uid':65534,'connect_errno':'EACCES','modes_relaxed':False}


def run(request,modules,core):
    with core.execution_lock():
        exclusive(q.PRIVATE/'run-intent.json',{**core.process_identity(os.getpid()),'operation_sha256':q.digest(request)})
        signal.signal(signal.SIGALRM,lambda *_: (_ for _ in ()).throw(TimeoutError('bounded_native_a_deadline')))
        signal.alarm(300)
        context=core.build(request,modules)
        core.durable(modules,'alias-host-before.json',core.alias_host())
        units=[q.unit(j) for j in request['jobs'].values()]
        audit=modules['storage_probe'].TmpAudit(core.boot_id(),units,core.actual_version(request,modules))
        core.host_tmp_proof(audit)
        # Parent never owns production authority or a unit reference. Only the
        # native persistent server holds refs. Fixture admission alone is opened.
        epoch=core.read_json(q.PRIVATE/'control/epoch.json')
        with context['admission'].fencing_barrier():
            if core.read_json(q.PRIVATE/'journal/admission.json')['enabled'] is not False:raise PermissionError('initial_closed_required')
            pending=q.PRIVATE/'journal/admission-open.json'
            modules['artifacts'].durable_json(pending,{'enabled':True,'epoch_sha256':q.digest(epoch)})
            os.replace(pending,q.PRIVATE/'journal/admission.json');modules['artifacts'].sync_dir(q.PRIVATE/'journal')
        proc,identity=spawn_server(request,modules,core,'1')
        foreign=foreign_uid_probe();values={};retirements={}
        for name,expected in (('success','completed'),('failure','failed'),('cancellation','canceled')):
            m=core.enqueue(request,modules,context,name)
            token=core.read_json(q.PRIVATE/'tokens'/(m['job_id']+'.json'))['token']
            exclusive(q.PRIVATE/(name+'-dispatch-intent.json'),{'manifest_sha256':q.digest(m)})
            context['backend'].dispatch(m,token)
            alias_evidence=core.alias_during(context,modules,m)
            before=core.wait_for(context,m,cancellation=name=='cancellation')
            pids=core.cgroup_pids(before['cgroup_path'],context['cgroups']) if name=='cancellation' else 0
            receipt,binding=core.assert_unit(modules,context,m)
            logs=log_probe(context,m)
            exclusive(q.PRIVATE/(name+'-finish-intent.json'),{'cancel':name=='cancellation'})
            context['backend'].finish(m,cancel=name=='cancellation')
            value=core.outcome(modules,context,m,expected);value['cgroup_pids_before_stop']=pids;value['logs']=logs;value['alias']=alias_evidence
            r=retirement_request(context,modules,m,token)
            exclusive(q.PRIVATE/(name+'-retire-intent.json'),{k:v for k,v in r.items() if k!='token'})
            if name=='success':
                lost_retire(modules,r)
                answer=deadline(lambda: (a if (a:=readback(context,modules,r)).get('state')=='retained' else None))
            else:answer=context['transport'].call('civo',r)
            # Bind boot from the actual frozen worker receipt, not arbitrary caller metadata.
            _,binding=context['worker'].stored(m['job_id'])
            retirement_result(r,answer,{**binding,'boot_id':receipt['boot_id']},modules['remote_contract'])
            core.retained(context,modules,m,receipt,binding)
            value['retirement']=answer;values[name]=value;retirements[name]=r
            core.host_tmp_proof(audit)
        no_unit=prestart(request,modules,core,context)
        all_retained(context,modules,core,request)
        validate_paths(values,trace_read(core,'1'),identity,core)
        stop_normal(proc,identity,core)
        negative=negative_startup(request,modules,core,context)
        proc2,identity2=spawn_server(request,modules,core,'2')
        ready2=core.read_json(q.PRIVATE/'ready-2.json')
        if type(ready2.get('reference_count')) is not int or ready2['reference_count']!=0 or q.canonical(ready2.get('startup'))!=q.canonical({'state':'RECONCILED','receipt_count':4}):raise PermissionError('real_restart_without_rearm_required')
        socket_identity=ready2['socket_identity']
        for r in retirements.values():
            saved=readback(context,modules,r)
            if saved['state']!='retained':raise PermissionError('restart_retirement_readback_failed')
        exclusive(q.PRIVATE/'quarantine-2.json',{'identity':identity2})
        proof=deadline(lambda:core.read_json(q.PRIVATE/'quarantine-proof-2.json') if (q.PRIVATE/'quarantine-proof-2.json').exists() else None)
        quarantine_proof(proof,identity2,request)
        for r in retirements.values():
            if readback(context,modules,r)['state']!='retained':raise PermissionError('quarantine_readback_failed')
        # The sealed bundle remains available read-only after retention/quarantine.
        for r in retirements.values():
            reply=context['transport'].call('civo',{'action':'bundle','id':r['manifest']['job_id']})
            if type(reply) is not dict or set(reply)!={'bundle_sha256','bundle_base64'} or reply['bundle_sha256']!=r['bundle_sha256']:
                raise PermissionError('quarantine_bundle_identity_required')
            encoded=reply['bundle_base64']
            if type(encoded) is not str or len(encoded)>((modules['artifacts'].MAX_BYTES+2)//3)*4:raise PermissionError('bounded_quarantine_bundle_required')
            if modules['artifacts'].sha(base64.b64decode(encoded,validate=True))!=r['bundle_sha256']:raise PermissionError('quarantine_sealed_bundle_changed')
        denied=0
        for action in ('prepare','start'):
            m=retirements['success']['manifest']
            data={'action':action,'manifest':m}
            if action=='prepare':data['token_sha256']='0'*64
            else:data.update(token=retirements['success']['token'],receipt_sha256=retirements['success']['receipt_sha256'])
            answer=exact_wire(modules,data)
            if answer!={'ok':False,'error_type':'RetirementUncertain'}:raise PermissionError('quarantine_denied_for_wrong_reason')
            denied+=1
        all_retained(context,modules,core,request)
        # Lost bus cannot drain normally. Only the verified own child with no
        # held refs is killed; no systemd unit/mount/retirement action is repeated.
        if not core.alive(identity2):
            raise PermissionError('quarantine_safe_stop_proof_required')
        os.kill(proc2.pid,signal.SIGKILL);proc2.wait(timeout=10)
        socket_info=q.SOCKET.lstat()
        if not stat.S_ISSOCK(socket_info.st_mode) or socket_info.st_uid!=0 or stat.S_IMODE(socket_info.st_mode)!=0o600 or socket_identity!={'device':socket_info.st_dev,'inode':socket_info.st_ino}:raise PermissionError('own_socket_metadata_required')
        q.SOCKET.unlink()
        final_tmp=core.host_tmp_proof(audit);audit.close()
        core.alias_after(context,modules,request)
        if core.baseline()!=core.read_json(q.PRIVATE/'baseline-before.json'):raise PermissionError('host_service_baseline_changed')
        with context['admission'].closed_for_fencing():pass
        result={'state':'NATIVE_SHORT_ALIAS_PASS','scope':'isolated-short-alias','paths':values,'prestart':no_unit,'foreign_uid':foreign,'negative_startup':negative,'quarantine':proof,'mutations_denied':denied,'tmp':final_tmp,'global_qualified':False,'live_held_reference_io_recovery_qualified':False}
        signal.alarm(0)
        core.durable(modules,'result.json',result)
        return {'state':result['state'],'scope':'isolated-short-alias','jobs':3,'prestart_no_unit':True,'global_qualified':False}


def start(request,modules,core):
    core.build(request,modules)  # read-only fixed bootstrap/boot validation BEFORE any intent or spawn
    exclusive(q.PRIVATE/'start-intent.json',{'operation_sha256':q.digest(request),'boot_id':core.boot_id()})
    fd=os.open(q.PRIVATE/'runner.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as out:
        proc=subprocess.Popen([str(Path(sys.executable).resolve()),'-I','-B',str(q.PUBLIC/'qualification_helper.py'),'_run',q.digest(request)],stdin=subprocess.DEVNULL,stdout=out,stderr=out,start_new_session=True,close_fds=True,env=ENV)
    core.durable(modules,'runner-receipt.json',core.process_identity(proc.pid))
    return {'state':'STARTED_A','no_replay':True}


def pending_process_intents(core):
    pairs=(('start-intent.json','runner-receipt.json'),('server-spawn-1.json','server-process-1.json'),('server-spawn-2.json','server-process-2.json'))
    return [intent for intent,receipt in pairs if (q.PRIVATE/intent).exists() and not (q.PRIVATE/receipt).exists()]


def validate_saved(request,modules,core,result):
    if (result.get('state')!='NATIVE_SHORT_ALIAS_PASS' or result.get('scope')!='isolated-short-alias'
            or result.get('global_qualified') is not False or result.get('live_held_reference_io_recovery_qualified') is not False
            or result.get('prestart')!={'state':'canceled_before_start','no_unit_created':True,'job_id':request['prestart_job_id']}
            or type(result.get('mutations_denied')) is not int or result['mutations_denied']!=2):
        raise PermissionError('exact_a_result_scope_required')
    context=core.build(request,modules)
    core.alias_saved(modules,request,result)
    all_retained(context,modules,core,request)
    ready=core.read_json(q.PRIVATE/'ready-1.json')
    validate_paths(result['paths'],trace_read(core,'1'),ready['identity'],core)
    for name,job in request['jobs'].items():
        row,binding=context['worker'].stored(job);m=json.loads(row['manifest_json']);receipt=json.loads(row['receipt_json'])
        answer=core.read_json(q.PRIVATE/'retirements'/job/'receipt.json')
        intent=core.read_json(q.PRIVATE/'retirements'/job/'intent.json')
        r={'manifest':m,'receipt_sha256':q.digest(receipt),'bundle_sha256':binding['bundle_sha256'],'custody_receipt_sha256':intent['custody_receipt_sha256']}
        retirement_result(r,answer,{**binding,'boot_id':receipt['boot_id']},modules['remote_contract'])
        if answer!=result['paths'][name]['retirement']:raise PermissionError('saved_result_retirement_mismatch')
    pre,binding=context['worker'].stored(request['prestart_job_id'])
    if pre['state']!='canceled_before_start' or pre['invocation_id'] is not None or binding is not None:
        raise PermissionError('saved_prestart_no_unit_required')
    pre_manifest=json.loads(pre['manifest_json']);pre_receipt=json.loads(pre['receipt_json'])
    if context['adapter'].properties(q.unit(request['prestart_job_id']))['LoadState']!='not-found':raise PermissionError('saved_prestart_unit_exists')
    try:context['storage'].status(pre_manifest,pre_receipt)
    except FileNotFoundError:pass
    else:raise PermissionError('saved_prestart_storage_exists')
    quarantine_proof(result.get('quarantine'),core.read_json(q.PRIVATE/'ready-2.json')['identity'],request)
    tmp=result.get('tmp',{})
    if (tmp.get('matching_events')!=0 or tmp.get('matching_existing')!=0 or tmp.get('overflow') is not False
            or tmp.get('watch_lost') is not False or tmp.get('manager_namespace_verified') is not True):
        raise PermissionError('saved_manager_tmp_proof_required')
    return True


def observe(request,modules,core):
    if (q.PRIVATE/'result.json').exists():
        result=core.read_json(q.PRIVATE/'result.json')
        validate_saved(request,modules,core,result)
        return {'state':result['state'],'scope':'isolated-short-alias','global_qualified':False}
    pending=pending_process_intents(core)
    if pending:return {'state':'UNCERTAIN_PENDING_PROCESS_RECEIPT','pending_intents':pending,'no_replay':True,'global_qualified':False}
    runner=q.PRIVATE/'runner-receipt.json'
    return {'state':'RUNNING_OR_UNCERTAIN' if runner.exists() and core.alive(core.read_json(runner)) else 'UNCERTAIN_OR_NOT_STARTED','no_replay':True,'global_qualified':False}


def cleanup(request,modules,core):
    with core.execution_lock():
        if pending_process_intents(core):raise PermissionError('process_spawn_outcome_uncertain_preserve')
        for name in ('runner-receipt.json','server-process-1.json','server-process-2.json'):
            p=q.PRIVATE/name
            if p.exists() and core.alive(core.read_json(p)):raise PermissionError('live_process_preserve')
        if not (q.PRIVATE/'result.json').exists():raise PermissionError('unfinished_a_requires_separate_reconciliation')
        validate_saved(request,modules,core,core.read_json(q.PRIVATE/'result.json'))
        context=core.build(request,modules)
        all_retained(context,modules,core,request)
        if os.path.lexists(q.SOCKET):raise PermissionError('socket_state_uncertain_separate_reconciliation')
        with context['admission'].closed_for_fencing():pass
        core.durable(modules,'cleanup-receipt.json',{'storage_retained':3,'evidence_deleted':False,'global_qualified':False})
        return {'state':'OWN_A_RETAINED_VERIFIED','evidence_deleted':False}


def main():
    if len(sys.argv)!=3 or sys.argv[1] not in {'preflight','bootstrap','start','observe','cleanup','_run'}:raise ValueError('fixed_a_phase_required')
    os.umask(0o077)
    # Trusted installed bootstrap; core verifies every file before importing runtime.
    if Path(__file__).absolute()!=q.PUBLIC/'qualification_helper.py':raise PermissionError('exact_installed_helper_required')
    import fixture_core as core
    request,modules=core.load()
    if sys.argv[2]!=q.digest(request):raise PermissionError('exact_operation_digest_required')
    phase=sys.argv[1]
    if phase=='_run':
        intent=core.read_json(q.PRIVATE/'start-intent.json')
        if intent!={'operation_sha256':q.digest(request),'boot_id':core.boot_id()}:raise PermissionError('start_intent_required')
        try:result=run(request,modules,core)
        except BaseException as error:
            core.durable(modules,'failure.json',{'state':'UNCERTAIN_OBSERVE_ONLY','error_type':type(error).__name__,'no_replay':True})
            raise
    else:result=globals()[phase](request,modules,core)
    print(q.canonical(result))

if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(q.canonical({'ok':False,'error_type':type(error).__name__,'no_replay':True}))
        raise SystemExit(1)
