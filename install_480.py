#!/usr/bin/python3
"""Critical480: default plan only. No SSH, sudo, package install, or automatic job submission."""
from __future__ import annotations
import argparse
import hashlib
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

PLAN_SHA = "b733a533950aec46857676fa718b0f7cb30fe21f1f3286a9147a02783ed266b3"
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
    fd,tmp=tempfile.mkstemp(prefix='.critical480-',dir=target.parent)
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

def check_host(plan: dict,allow_inactive: bool=False) -> str:
    boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    a=json.loads(Path(plan['authority']).read_text())
    if a.get('role')!='primary' or a.get('armed_boot_id')!=boot or not isinstance(a.get('generation'),int):raise ValueError('authority_not_current_primary')
    for key in ['coordinator','worker']:
        e=plan['roles'][key];actual=pwd.getpwnam(e['name'])
        if actual.pw_uid!=e['uid'] or actual.pw_gid!=e['gid']:raise ValueError('role_uid_gid_changed')
    if 989 not in os.getgrouplist('vigia-worker',986):raise ValueError('worker_missing_existing_exec_group')
    facts=subprocess.check_output(['/usr/bin/systemctl','show',SERVICE,'--property=User,Group,ActiveState'],text=True,timeout=10)
    facts=dict(line.split('=',1) for line in facts.splitlines() if '='in line)
    if facts.get('User')!='vigia-coord' or facts.get('Group')!='admin-v2-exec' or facts.get('ActiveState') not in (['active','inactive'] if allow_inactive else ['active']):raise ValueError('existing_coordinator_service_changed')
    worker=Path('/srv/admin-v2-worker').stat()
    if (worker.st_uid,worker.st_gid,stat.S_IMODE(worker.st_mode))!=(999,989,0o770):raise ValueError('worker_parent_changed_do_not_chmod')
    if digest(Path('/usr/bin/node'))!=plan['nodeSha256']:raise ValueError('remote_node_changed')
    queue_idle(Path(plan['queue']));return boot

def verify_stage(plan: dict,dest: Path) -> None:
    for directory in [dest,dest/'inputs',dest/'runs']:private_dir(directory,997)
    if any((dest/'runs').iterdir()):raise ValueError('stage_has_run_reconcile_no_retry')
    if {p.name for p in dest.iterdir()} != set(plan['stagePins'])|{'inputs','runs'}:raise ValueError('unexpected_stage_entry')
    if {p.name for p in (dest/'inputs').iterdir()} != {'runtime.tar','release-manifest.json'}:raise ValueError('stage_incomplete_or_extra_input')
    checks=[(dest/name,h)for name,h in plan['stagePins'].items()]+[(dest/'inputs/runtime.tar',plan['archiveSha256']),(dest/'inputs/release-manifest.json',plan['releaseManifestSha256'])]
    for p,h in checks:
        if digest(p)!=h:raise ValueError('existing_stage_changed:'+p.name)

def verify_inputs(plan: dict) -> None:
    root=Path(plan['sourceRoot']);private_dir(root,0);private_dir(root/'code',0)
    for name,h in plan['newPins'].items():
        if digest(root/'code'/name)!=h:raise ValueError('staged_code_changed:'+name)
    dest=Path(plan['stageRoot'])
    if dest.exists() or dest.is_symlink():verify_stage(plan,dest);return
    for child in ['harness','inputs']:private_dir(root/child,0)
    expected=[(root/'harness'/n,h)for n,h in plan['stagePins'].items()]+[(root/'inputs/runtime.tar',plan['archiveSha256']),(root/'inputs/release-manifest.json',plan['releaseManifestSha256'])]
    for p,h in expected:
        if digest(p)!=h:raise ValueError('staged_input_changed:'+p.name)

def stage_runtime(plan: dict,lease: str) -> Path:
    source=Path(plan['sourceRoot']);dest=Path(plan['stageRoot'])
    if dest.exists() or dest.is_symlink():verify_stage(plan,dest);return dest
    temp=dest.with_name('.'+dest.name+'.'+lease+'.stage')
    temp.mkdir(mode=0o700)
    # A partial stage is intentionally preserved with this nonce for reconciliation, never merged.
    for name in ['inputs','runs']:(temp/name).mkdir(mode=0o700)
    for name,h in plan['stagePins'].items():
        atomic_copy(source/'harness'/name,temp/name,0o600,997,986)
        if digest(temp/name)!=h:raise ValueError('stage_copy_changed')
    for name,h in [('runtime.tar',plan['archiveSha256']),('release-manifest.json',plan['releaseManifestSha256'])]:
        atomic_copy(source/'inputs'/name,temp/'inputs'/name,0o600,997,986)
        if digest(temp/'inputs'/name)!=h:raise ValueError('stage_copy_changed')
    for d in [temp/'inputs',temp/'runs',temp]:os.chown(d,997,986)
    os.rename(temp,dest)
    return dest

def install_transaction(plan: dict,backup: Path,control=service,owners: bool=True) -> dict:
    before=preimages(plan);queue=Path(plan['queue']);queue_idle(queue)
    backup.mkdir(mode=0o700)
    stopped=False;changed=[];safe_restart=True
    result={'queueRestored':False,'changed':changed,'exit':1,'codeRollback':False}
    try:
        control('stop');stopped=True
        # Recheck after stopping dispatch. A queued/running job aborts without deleting it.
        queue_idle(queue);preimages(plan)
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
            atomic_copy(source,target,0o644 if name=='runtime_profile.py' else 0o755,0 if owners else None,0 if owners else None)
            if digest(target)!=plan['newPins'][name]:raise ValueError('installed_hash_mismatch')
        queue_idle(queue);control('start');stopped=False;result['exit']=0
    except BaseException as e:
        result['error']=type(e).__name__+':'+str(e)
        # Restore code only; NEVER copy queue.sqlite over the live database.
        for name in reversed(changed):
            target=Path(plan['installPaths'][name]);meta=before[name]
            if not target.exists() and not target.is_symlink() and meta['absent']:continue
            current=digest(target)
            if not meta['absent'] and current==meta['sha256']:continue
            if current!=plan['newPins'][name]:
                result['rollbackError']='foreign_change_preserved:'+name;safe_restart=False;continue
            if meta['absent']:target.unlink()
            else:atomic_copy(backup/name,target,meta['mode'],meta['uid'] if owners else None,meta['gid'] if owners else None)
        if safe_restart:
            try:preimages(plan)
            except Exception as changed_error:
                safe_restart=False;result['rollbackError']='preimages_changed_do_not_restart:'+str(changed_error)
        result['codeRollback']=safe_restart
    finally:
        if stopped and safe_restart:
            try:control('start')
            except Exception as e:result['restartError']=type(e).__name__+':'+str(e)
        (backup/'result.json').write_text(json.dumps(result,indent=2)+'\n');(backup/'result.json').chmod(0o600)
    return result

def main() -> int:
    parser=argparse.ArgumentParser();g=parser.add_mutually_exclusive_group();g.add_argument('--dry-run',action='store_true');g.add_argument('--check',action='store_true');g.add_argument('--apply',action='store_true');parser.add_argument('--lease-id');args=parser.parse_args();plan=load_plan()
    if not args.apply and not args.check:
        print(json.dumps({'mode':'DRY_RUN','mutations':False,'plan':plan,'futureSubmitOnlyAfterInstallVerification':{'action':'submit','id':plan['jobId'],'kind':'runtime-http-r0000-v1','source_commit':plan['applicationSourceCommit']}},indent=2));return 0
    if args.apply and os.geteuid()!=0:raise PermissionError('root_required_no_sudo_escalation_in_script')
    boot=check_host(plan);preimages(plan);verify_inputs(plan)
    if args.check:print(json.dumps({'mode':'READ_ONLY_CHECK','hostPinsAndQueueValid':True,'applyAuthorized':False}));return 0
    if not isinstance(args.lease_id,str) or not re.fullmatch('[a-f0-9]{32}',args.lease_id):raise ValueError('existing_lease_id_required_for_checkpoint_name')
    # Parent has already verified ACK+lease in the existing ledger. This does not create or grant authorization.
    stage_runtime(plan,args.lease_id)
    check_host(plan)
    base=Path(plan['backupRoot']);base.mkdir(mode=0o700,exist_ok=True);private_dir(base,0)
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
