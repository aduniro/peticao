#!/usr/bin/python3
"""R0002 native profile: default plan only. No SSH, sudo, package install, or automatic job submission."""
from __future__ import annotations
import argparse
import signal
import hashlib
import grp
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import sqlite3
import stat
import subprocess
import tempfile

PLAN_SHA = "9882daee4e5f9b2465091a519fb5acb2b44d0370b7d60f26d360e56845ab80b2"
SERVICE = "admin-v2-coordinator.service"
TERMINAL = {"completed", "failed", "interrupted", "canceled"}

def digest(path: Path) -> str:
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1: raise ValueError("regular_single_link_required")
        h=hashlib.sha256()
        with os.fdopen(fd,"rb",closefd=False) as f:
            for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
        return h.hexdigest()
    finally:os.close(fd)

def load_plan() -> dict:
    p=Path(__file__).with_name("plan.json")
    if digest(p)!=PLAN_SHA:raise ValueError("reviewed_plan_changed")
    return json.loads(p.read_text())

def private_dir(path: Path, uid: int) -> None:
    if path.resolve()!=path or not path.is_dir():raise ValueError("noncanonical_directory")
    s=path.stat()
    if s.st_uid!=uid or stat.S_IMODE(s.st_mode)!=0o700:raise ValueError("directory_not_private_owner")

def create_private_backup_root(path: Path,uid: int) -> bool:
    created=False
    try:path.mkdir(mode=0o700);created=True
    except FileExistsError:pass
    if created:
        # A parent with SGID2770 makes mkdir(0700) yield2700. Normalize ONLY this new directory.
        fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            if os.fstat(fd).st_uid!=uid:raise ValueError('new_backup_root_owner_changed')
            os.fchmod(fd,0o700)
        finally:os.close(fd)
    private_dir(path,uid)
    return created

def preimages(plan: dict) -> dict:
    result={}
    for name,path in plan['installPaths'].items():
        p=Path(path);expected=plan['oldPins'][name]
        if expected is None:
            if p.exists() or p.is_symlink():raise ValueError('unexpected_existing_helper')
            result[name]={'absent':True};continue
        if digest(p)!=expected:raise ValueError('preimage_changed:'+name)
        st=p.stat();result[name]={'absent':False,'sha256':expected,'uid':st.st_uid,'gid':st.st_gid,'mode':stat.S_IMODE(st.st_mode)}
    return result

def queue_idle(path: Path) -> dict:
    with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as c:
        states=c.execute('SELECT state,count(*) FROM jobs GROUP BY state').fetchall()
        if any(state not in TERMINAL and n for state,n in states):raise ValueError('queue_not_idle')
        if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('queue_integrity')
        return dict(states)

def backup_queue(source: Path,target: Path) -> None:
    if target.exists():raise ValueError('snapshot_exists_never_overwrite')
    src=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);dest=sqlite3.connect(target)
    try:src.backup(dest)
    finally:dest.close();src.close()
    target.chmod(0o600)
    queue_idle(target)

def atomic_copy(source: Path,target: Path,mode: int,uid: int|None=None,gid: int|None=None) -> None:
    # Exact paths only from pinned plan; never follows an existing destination symlink.
    if target.is_symlink():raise ValueError('destination_link')
    fd,tmp=tempfile.mkstemp(prefix='.native-r0002-',dir=target.parent)
    try:
        with os.fdopen(fd,'wb') as out,source.open('rb') as inp:shutil.copyfileobj(inp,out);out.flush();os.fsync(out.fileno())
        os.chmod(tmp,mode)
        if uid is not None:os.chown(tmp,uid,gid)
        os.replace(tmp,target)
        parent=os.open(target.parent,os.O_DIRECTORY|os.O_RDONLY)
        try:os.fsync(parent)
        finally:os.close(parent)
    finally:Path(tmp).unlink(missing_ok=True)

def service(action: str) -> None:
    if action not in {'stop','start'}:raise ValueError('service_action_not_allowed')
    subprocess.run(['/usr/bin/systemctl',action,SERVICE],check=True,timeout=30)

def verify_worker_parent(path: Path,expected: dict) -> None:
    if path.resolve()!=path or path.is_symlink():raise ValueError('worker_parent_changed_do_not_chmod')
    worker=path.stat()
    if (worker.st_uid,worker.st_gid,stat.S_IMODE(worker.st_mode))!=(expected['uid'],expected['gid'],expected['mode']):raise ValueError('worker_parent_changed_do_not_chmod')

def check_host(plan: dict,allow_inactive: bool=False) -> str:
    boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    a=json.loads(Path(plan['authority']).read_text())
    if a.get('role')!='primary' or a.get('armed_boot_id')!=boot or type(a.get('generation'))is not int or a['generation']<1:raise ValueError('authority_not_current_primary')
    for key in ['coordinator','worker']:
        e=plan['roles'][key];actual=pwd.getpwnam(e['name'])
        if actual.pw_uid!=e['uid'] or actual.pw_gid!=e['gid']:raise ValueError('role_uid_gid_changed')
    if grp.getgrnam(plan['serviceGroup']['name']).gr_gid!=plan['serviceGroup']['gid']:raise ValueError('existing_service_group_gid_changed')
    if plan['serviceGroup']['gid'] not in os.getgrouplist('vigia-worker',986):raise ValueError('worker_missing_existing_exec_group')
    facts=subprocess.check_output(['/usr/bin/systemctl','show',SERVICE,'--property=User,Group,ActiveState'],text=True,timeout=10)
    facts=dict(line.split('=',1) for line in facts.splitlines() if '='in line)
    if facts.get('User')!='vigia-coord' or facts.get('Group')!='admin-v2-exec' or facts.get('ActiveState') not in (['active','inactive'] if allow_inactive else ['active']):raise ValueError('existing_coordinator_service_changed')
    verify_worker_parent(Path(plan['workerParent']['path']),plan['workerParent'])
    if digest(Path('/usr/bin/node'))!=plan['nodeSha256']:raise ValueError('remote_node_changed')
    for name,want in plan['pgBinaryPins'].items():
        tool=Path(plan['pgBinRoot'])/name;meta=tool.lstat()
        if not stat.S_ISREG(meta.st_mode) or (meta.st_uid,meta.st_gid,stat.S_IMODE(meta.st_mode))!=(0,0,0o755) or digest(tool)!=want:raise ValueError('pg_binary_changed:'+name)
    quiescent(plan);return boot

def verify_harness(plan: dict, dest: Path, uid: int) -> None:
    private_dir(dest,uid)
    expected=set(plan['stagePins']);actual=set()
    for entry in dest.rglob('*'):
        name=str(entry.relative_to(dest))
        if entry.is_symlink():raise ValueError('harness_link')
        if entry.is_dir():
            if name!='schema-sources':raise ValueError('unexpected_stage_directory')
            private_dir(entry,uid)
        elif entry.is_file():actual.add(name)
        else:raise ValueError('unexpected_stage_special')
    if actual!=expected:raise ValueError('harness_incomplete_or_extra')
    for name,want in plan['stagePins'].items():
        if digest(dest/name)!=want:raise ValueError('harness_pin_changed:'+name)


def verify_runtime(plan: dict) -> None:
    inputs=Path(plan['runtimeInputs'])
    for directory in [inputs.parent,inputs]:private_dir(directory,997)
    if {p.name for p in inputs.iterdir()}!={'runtime.tar','release-manifest.json'}:raise ValueError('runtime_incomplete_or_extra')
    archive=inputs/'runtime.tar'
    if archive.stat().st_size!=plan['archiveBytes'] or digest(archive)!=plan['archiveSha256']:raise ValueError('shared_runtime_archive_changed')
    manifest=inputs/'release-manifest.json'
    if digest(manifest)!=plan['releaseManifestSha256']:raise ValueError('shared_runtime_manifest_changed')
    value=json.loads(manifest.read_text())
    if value.get('source_commit')!=plan['applicationSourceCommit'] or value.get('release_id')!=plan['releaseId'] or len(value.get('files',{}))!=plan['releaseFiles']:raise ValueError('runtime_release_contract_changed')


def verify_preserved(plan: dict) -> None:
    for path,want in plan['preservedPins'].items():
        if digest(Path(path))!=want:raise ValueError('preserved_runtime_profile_changed')


def verify_inputs(plan: dict) -> None:
    root=Path(plan['sourceRoot']);private_dir(root,0);private_dir(root/'code',0)
    if {p.name for p in (root/'code').iterdir()}!=set(plan['newPins']):raise ValueError('unexpected_code_input')
    for name,want in plan['newPins'].items():
        if digest(root/'code'/name)!=want:raise ValueError('staged_code_changed:'+name)
    dest=Path(plan['stageRoot'])
    if dest.exists() or dest.is_symlink():verify_harness(plan,dest,997)
    else:verify_harness(plan,root/'harness',0)
    verify_runtime(plan);verify_preserved(plan)


def stage_runtime(plan: dict,lease: str) -> Path:
    # Runtime is shared with R3; never transport/copy/overlay its475MB here.
    verify_runtime(plan)
    source=Path(plan['sourceRoot']);dest=Path(plan['stageRoot'])
    if dest.exists() or dest.is_symlink():verify_harness(plan,dest,997);return dest
    temp=dest.with_name('.'+dest.name+'.'+lease+'.stage')
    if temp.exists() or temp.is_symlink():raise ValueError('partial_stage_preserved_no_overlay')
    create_private_backup_root(temp,os.getuid())
    # Only own newly created directories are normalized; partial stage preserved on failure.
    schema=temp/'schema-sources';create_private_backup_root(schema,os.getuid())
    for name,want in plan['stagePins'].items():
        atomic_copy(source/'harness'/name,temp/name,0o600,997,986)
        if digest(temp/name)!=want:raise ValueError('harness_copy_changed')
    for directory in [schema,temp]:os.chown(directory,997,986)
    verify_harness(plan,temp,997);os.rename(temp,dest);return dest


def coordinator_stopped() -> None:
    facts=subprocess.check_output(['/usr/bin/systemctl','show',SERVICE,'--property=ActiveState,SubState,MainPID'],text=True,timeout=10)
    values=dict(line.split('=',1)for line in facts.splitlines()if '='in line)
    if set(values)!={'ActiveState','SubState','MainPID'} or values['ActiveState']!='inactive' or values['SubState']!='dead' or values['MainPID']!='0':raise ValueError('coordinator_not_proven_stopped')


def verify_job_drain(job: str,folder: Path) -> None:
    if not re.fullmatch('[a-f0-9]{32}',job):raise ValueError('queue_job_identity_invalid')
    unit='admin-v2-job-'+job+'.service';group='/system.slice/'+unit
    result=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=Id,LoadState,ActiveState,SubState,MainPID,ControlGroup'],capture_output=True,text=True,timeout=5)
    values=dict(line.split('=',1)for line in result.stdout.splitlines()if '='in line)
    if set(values)!={'Id','LoadState','ActiveState','SubState','MainPID','ControlGroup'} or result.returncode not in {0,4}:raise ValueError('unit_drain_unknown')
    if values['Id']!=unit or values['LoadState'] not in {'loaded','not-found'} or (result.returncode==4 and values['LoadState']!='not-found') or values['ControlGroup'] not in {'',group}:raise ValueError('unit_drain_identity_unknown')
    if values['ActiveState'] not in {'inactive','failed'} or values['SubState'] not in {'dead','failed'} or values['MainPID']!='0':raise ValueError('unit_not_drained')
    cg=Path('/sys/fs/cgroup/system.slice')/unit
    if cg.is_symlink():raise ValueError('cgroup_link')
    if cg.exists():
        if cg.resolve()!=cg:raise ValueError('cgroup_noncanonical')
        def read(name):
            fd=os.open(cg/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            try:
                if not stat.S_ISREG(os.fstat(fd).st_mode):raise ValueError('cgroup_invalid')
                return os.read(fd,65537).decode()
            finally:os.close(fd)
        events=dict(line.split()for line in read('cgroup.events').splitlines())
        if events.get('populated')!='0' or read('cgroup.procs').strip():raise ValueError('cgroup_not_drained')
    marker=folder/'execution.started';state=folder/'state.json'
    if folder.resolve()!=folder or marker.is_symlink() or not marker.is_file() or state.is_symlink():raise ValueError('execution_unknown')
    # regular single-link checks precede JSON; no app imports or runtime execution.
    digest(marker);digest(state);value=json.loads(state.read_text())
    if value.get('id')!=job or value.get('state') not in TERMINAL:raise ValueError('execution_not_terminal')


def quiescent(plan: dict, stopped: bool=False) -> None:
    if stopped:coordinator_stopped()
    queue=Path(plan['queue']);queue_idle(queue)
    with sqlite3.connect(queue.as_uri()+'?mode=ro',uri=True)as db:
        for job,started in db.execute('SELECT id,started_at FROM jobs').fetchall():
            intent=bool(db.execute("SELECT 1 FROM events WHERE job_id=? AND kind='starting' LIMIT 1",(job,)).fetchone())
            folder=Path(plan['workerParent']['path'])/'jobs'/job
            if not intent and started is None and not folder.exists() and not folder.is_symlink():continue
            verify_job_drain(job,folder)
    verify_preserved(plan)


def install_transaction(plan: dict,backup: Path,control=service,owners: bool=True) -> dict:
    before=preimages(plan);queue=Path(plan['queue']);quiescent(plan)
    if backup.exists() or backup.is_symlink():raise ValueError('checkpoint_exists_no_replay')
    create_private_backup_root(backup,os.getuid())
    stopped=False;changed=[];safe_restart=True
    result={'queueRestored':False,'changed':changed,'exit':1,'codeRollback':False}
    try:
        control('stop');stopped=True
        # Recheck after stopping dispatch. A queued/running job aborts without deleting it.
        quiescent(plan,True);preimages(plan)
        backup_queue(queue,backup/'queue.sqlite')
        (backup/'preimages.json').write_text(json.dumps(before,indent=2)+'\n');(backup/'preimages.json').chmod(0o600)
        for name,meta in before.items():
            if not meta['absent']:
                atomic_copy(Path(plan['installPaths'][name]),backup/name,0o600)
                if digest(backup/name)!=meta['sha256']:raise ValueError('backup_preimage_changed')
        for name in plan['installOrder']:
            source=Path(plan['sourceRoot'])/'code'/name;target=Path(plan['installPaths'][name])
            if digest(source)!=plan['newPins'][name]:raise ValueError('source_changed_during_install')
            changed.append(name)
            atomic_copy(source,target,0o644 if name=='history_native_profile.py' else 0o755,0 if owners else None,0 if owners else None)
            if digest(target)!=plan['newPins'][name]:raise ValueError('installed_hash_mismatch')
        quiescent(plan,True);control('start');stopped=False;result['exit']=0
    except BaseException as e:
        if signal.getsignal(signal.SIGTERM)==cancel_install:signal.signal(signal.SIGTERM,signal.SIG_IGN)
        result['error']=type(e).__name__+':'+str(e)
        # A start may have succeeded despite a lost response. Never roll code back
        # until service and all managed jobs are proved stopped/drained again.
        try:quiescent(plan,True)
        except BaseException as drain_error:
            safe_restart=False;result['rollbackError']='quiescence_unproved_preserve_code:'+str(drain_error)
        if safe_restart:
            for name in reversed(changed):
                target=Path(plan['installPaths'][name]);meta=before[name]
                try:
                    if not target.exists() and not target.is_symlink() and meta['absent']:continue
                    current=digest(target)
                    if not meta['absent'] and current==meta['sha256']:continue
                    if current!=plan['newPins'][name]:raise ValueError('foreign_change_preserved:'+name)
                    if meta['absent']:target.unlink()
                    else:
                        if digest(backup/name)!=meta['sha256']:raise ValueError('backup_preimage_changed:'+name)
                        atomic_copy(backup/name,target,meta['mode'],meta['uid'] if owners else None,meta['gid'] if owners else None)
                except BaseException as rollback_error:
                    safe_restart=False;result['rollbackError']=str(rollback_error)
            if safe_restart:
                try:preimages(plan);verify_preserved(plan)
                except BaseException as changed_error:
                    safe_restart=False;result['rollbackError']='preimages_changed_do_not_restart:'+str(changed_error)
        result['codeRollback']=safe_restart
    finally:
        if stopped and safe_restart:
            try:control('start')
            except Exception as e:result['restartError']=type(e).__name__+':'+str(e)
        (backup/'result.json').write_text(json.dumps(result,indent=2)+'\n');(backup/'result.json').chmod(0o600)
    return result

def cancel_install(signum,frame):raise KeyboardInterrupt('operator canceled')

def main() -> int:
    parser=argparse.ArgumentParser();g=parser.add_mutually_exclusive_group();g.add_argument('--dry-run',action='store_true');g.add_argument('--check',action='store_true');g.add_argument('--apply',action='store_true');parser.add_argument('--lease-id');args=parser.parse_args();plan=load_plan()
    if not args.apply and not args.check:
        print(json.dumps({'mode':'DRY_RUN','mutations':False,'plan':plan,'futureSubmitOnlyAfterInstallVerification':{'action':'submit','id':'PARENT_MUST_RESERVE_NEW_JOB_ID','kind':plan['kind'],'source_commit':plan['applicationSourceCommit']}},indent=2));return 0
    if args.apply and os.geteuid()!=0:raise PermissionError('root_required_no_sudo_escalation_in_script')
    boot=check_host(plan);preimages(plan);verify_inputs(plan)
    if args.check:print(json.dumps({'mode':'READ_ONLY_CHECK','hostPinsAndQueueValid':True,'applyAuthorized':False}));return 0
    if not isinstance(args.lease_id,str) or not re.fullmatch('[a-f0-9]{32}',args.lease_id):raise ValueError('existing_lease_id_required_for_checkpoint_name')
    # Parent has already verified ACK+lease in the existing ledger. This does not create or grant authorization.
    signal.signal(signal.SIGTERM,cancel_install)
    stage_runtime(plan,args.lease_id)
    check_host(plan)
    base=Path(plan['backupRoot']);create_private_backup_root(base,0)
    result=install_transaction(plan,base/args.lease_id)
    if result['exit']==0:
        try:
            check_host(plan)
            for name,path in plan['installPaths'].items():
                if digest(Path(path))!=plan['newPins'][name]:raise ValueError('post_install_hash')
            result['postInstallVerified']=True
        except Exception as e:
            result['exit']=1;result['postInstallVerified']=False;result['postInstallError']=type(e).__name__+':'+str(e)
            # The restarted service could have accepted a job; never roll the queue/code back blindly.
        (base/args.lease_id/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result));return result['exit']
if __name__=='__main__':raise SystemExit(main())
