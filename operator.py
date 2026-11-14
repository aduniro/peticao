"""Fixed-host passive backup/restore operator. No service or authority activation."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import sys
import types

SOURCE=Path('/srv/admin-v2-coordinator')
WORKER=Path('/srv/admin-v2-worker')
SOURCE_STAGE=Path('/srv/peticao-dev-prep/civo-passive-checkpoint-20261114-attempt1')
TARGET_STAGE=Path('/mnt/apps/peticao-final/_ops/civo-passive-restore-20261114-attempt1')
TARGET=Path('/srv/admin-v2-coordinator')
CODE=Path('/opt/admin-v2-cluster')
ACCOUNT='vigia-coord'
MAX_CIPHER=512*1024**2+1024*1024


def sha(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def run(argv,**kwargs):
    return subprocess.run(argv,capture_output=True,text=True,timeout=60,**kwargs)


def unit_state(name):
    p=run(['systemctl','show',name,'--property=ActiveState,MainPID'])
    return dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)


def assert_parents(path):
    for parent in Path(path).parents:
        if parent.is_symlink():raise ValueError('linked staging parent')
        if parent.exists():
            info=parent.stat()
            if not parent.is_dir() or info.st_uid!=0 or info.st_mode&0o022:
                raise PermissionError('root-owned non-writable staging parents required')


def load_helper(request):
    policy=request['policy'];raw=request['helper'].encode()
    if hashlib.sha256(raw).hexdigest()!=policy['helper_sha256']:
        raise ValueError('helper source checksum differs')
    module=types.ModuleType('checkpoint')
    exec(compile(raw,'<reviewed-checkpoint>','exec'),module.__dict__)
    assert_parents(CODE/'recovery.py')
    if (CODE/'recovery.py').stat().st_uid!=0 or (CODE/'recovery.py').stat().st_mode&0o022:
        raise PermissionError('installed recovery must remain root-owned and unwritable')
    recovery=module.load_recovery(CODE/'recovery.py',policy['recovery_sha256'])
    return module,recovery


def identity():
    who=pwd.getpwnam(ACCOUNT)
    if (who.pw_uid,who.pw_gid,who.pw_shell)!=(999,987,'/usr/sbin/nologin'):
        raise PermissionError('existing reviewed locked service identity changed')
    return who


def guard(role):
    expected={'source':'sonda-verifica3','target':'peticao-civo'}
    if os.geteuid()!=0 or role not in expected or socket.gethostname()!=expected[role]:
        raise PermissionError('fixed reviewed root host required')
    stage=TARGET_STAGE if role=='target' else SOURCE_STAGE
    if stage.exists() or stage.is_symlink():
        if stage.is_symlink() or not stage.is_dir() or stage.stat().st_uid!=0 or stage.stat().st_mode&0o077:
            raise PermissionError('existing staging directory must be private root-owned')
    if role=='target':
        identity();assert_parents(TARGET);assert_parents(TARGET_STAGE)
        for name in ['admin-v2-coordinator.service','admin-v2-coordinator-standby.service']:
            state=unit_state(name)
            if state.get('ActiveState') not in {'inactive','failed'} or state.get('MainPID')!='0':
                raise PermissionError('destination coordinator must remain inactive')
    else:
        assert_parents(SOURCE_STAGE)
        state=unit_state('admin-v2-coordinator.service')
        if state.get('ActiveState')!='active' or not state.get('MainPID','0').isdigit() or state.get('MainPID')=='0':
            raise PermissionError('existing source coordinator not observed active')


def source_preflight(request,helper):
    policy=request['policy'];baseline=policy['baseline']
    if set(baseline['file_sha256'])!={'authority.json','config.json','version.json'}:
        raise ValueError('fixed development coordinator metadata files only')
    if helper.database_facts(SOURCE/'queue.sqlite')!=baseline['facts']:
        raise ValueError('source queue changed; review new facts, do not drain automatically')
    for name,digest in baseline['file_sha256'].items():
        p=SOURCE/name
        if p.is_symlink() or sha(p)!=digest:raise ValueError('source configuration changed')
    units=run(['systemctl','list-units','--state=active,activating','--no-legend','--plain','admin-v2-job-*.service'])
    if units.returncode or units.stdout.strip():raise ValueError('source worker activity or observation failure')
    free=os.statvfs('/srv').f_bavail*os.statvfs('/srv').f_frsize
    if free<4*1024**3:raise ValueError('source backup disk floor4GiB')
    return {'source_queue_matches':True,'source_workers_active':0,'free_bytes':free}


def target_preflight():
    if TARGET.exists() or TARGET.is_symlink():raise FileExistsError('existing target queue; no overwrite')
    free=os.statvfs('/srv').f_bavail*os.statvfs('/srv').f_frsize
    if free<4*1024**3:raise ValueError('target backup disk floor4GiB')
    return {'target_queue_absent':True,'free_bytes':free}


def write_json(path,value):
    with Path(path).open('x') as stream:json.dump(value,stream,indent=2)
    Path(path).chmod(0o600)


def receive(request):
    if TARGET_STAGE.is_symlink() or not TARGET_STAGE.is_dir():raise ValueError('prepared private target stage required')
    kind=request['kind']
    name,limit={'cipher':('checkpoint.tar.gpg',MAX_CIPHER),'unlock':('unlock.key',4096)}[kind]
    path=TARGET_STAGE/name;total=0;h=hashlib.sha256()
    with path.open('xb') as stream:
        path.chmod(0o600)
        while True:
            chunk=sys.stdin.buffer.read(65536)
            if not chunk:break
            total+=len(chunk)
            if total>limit:raise ValueError('input transport limit exceeded')
            stream.write(chunk);h.update(chunk)
    if not total:raise ValueError('empty transport input')
    if kind=='cipher' and h.hexdigest()!=request['cipher_sha256']:
        raise ValueError('cipher transport checksum differs')
    return {'uploaded':kind,'bytes':total if kind=='cipher' else None}


def decrypt(request):
    cipher=TARGET_STAGE/'checkpoint.tar.gpg';key=TARGET_STAGE/'unlock.key';plain=TARGET_STAGE/'checkpoint.tar.gz'
    gpg=TARGET_STAGE/'gpg';tmp=TARGET_STAGE/'tmp'
    try:
        for p in [cipher,key]:
            if p.is_symlink() or not p.is_file() or p.stat().st_uid!=0 or p.stat().st_mode&0o077:
                raise PermissionError('private root-owned encrypted inputs required')
        if sha(cipher)!=request['cipher_sha256'] or plain.exists():raise ValueError('cipher differs or plaintext already exists')
        gpg.mkdir(mode=0o700);tmp.mkdir(mode=0o700)
        result=subprocess.run(['gpg','--homedir',str(gpg),'--batch','--no-symkey-cache','--pinentry-mode','loopback','--passphrase-file',str(key),'--output',str(plain),'--decrypt',str(cipher)],capture_output=True,env={'PATH':'/usr/bin:/bin','TMPDIR':str(tmp)},timeout=120)
        (TARGET_STAGE/'gpg.private.log').write_bytes(result.stderr)
        if result.returncode or sha(plain)!=request['capture']['sha256']:
            raise ValueError('authenticated checkpoint decryption failed')
        plain.chmod(0o600)
    finally:
        try:
            if gpg.exists():
                subprocess.run(['gpgconf','--homedir',str(gpg),'--kill','gpg-agent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
        finally:key.unlink(missing_ok=True)
    return {'decrypted_and_hash_verified':True,'temporary_unlock_deleted':not key.exists()}


def main(request):
    role,action=request['role'],request['action'];guard(role)
    helper,recovery=load_helper(request)
    if action=='preflight':
        return source_preflight(request,helper) if role=='source' else target_preflight()
    if role=='source' and action=='capture':
        source_preflight(request,helper)
        result=helper.capture(SOURCE,WORKER,SOURCE_STAGE,recovery)
        if result['facts']!=request['policy']['baseline']['facts']:
            raise ValueError('capture queue does not match immutable baseline')
        source_preflight(request,helper)
        write_json(SOURCE_STAGE/'CAPTURE-RECEIPT.json',result);return result
    if role=='source' and action=='read':
        receipt=json.loads((SOURCE_STAGE/'CAPTURE-RECEIPT.json').read_text())
        path=SOURCE_STAGE/'checkpoint-with-modes.tar.gz'
        if path.is_symlink() or sha(path)!=receipt['sha256'] or receipt['sha256']!=request['capture']['sha256']:
            raise ValueError('source checkpoint custody changed')
        with path.open('rb') as stream:
            while chunk:=stream.read(65536):sys.stdout.buffer.write(chunk)
        return None
    if role=='source' and action=='capture-status':
        receipt=json.loads((SOURCE_STAGE/'CAPTURE-RECEIPT.json').read_text())
        path=SOURCE_STAGE/'checkpoint-with-modes.tar.gz'
        if sha(path)!=receipt['sha256']:raise ValueError('source capture receipt custody differs')
        return receipt
    if role!='target':raise ValueError('unsupported source action')
    if action=='prepare':
        target_preflight();TARGET_STAGE.mkdir(mode=0o700,exist_ok=False)
        return {'target_stage_created':True,'queue_created':False}
    if action=='receive':return receive(request)
    if action=='decrypt':return decrypt(request)
    if action=='remove-unlock':
        (TARGET_STAGE/'unlock.key').unlink(missing_ok=True);return {'temporary_unlock_deleted':True}
    plain=TARGET_STAGE/'checkpoint.tar.gz'
    capture=request['capture']
    if action=='restore':
        target_preflight();who=identity()
        result=helper.restore(plain,TARGET,capture['sha256'],capture['facts'],recovery,who.pw_uid,who.pw_gid)
        write_json(TARGET_STAGE/'RESTORE-RECEIPT.json',result)
    elif action!='verify':raise ValueError('unsupported target action')
    if sha(plain)!=capture['sha256']:raise ValueError('retained plaintext checkpoint checksum differs')
    verified=helper.verify_restored(plain,TARGET,capture['facts'],recovery)
    probe=request['probe']
    if hashlib.sha256(probe.encode()).hexdigest()!=request['policy']['probe_sha256']:
        raise ValueError('nonroot probe source differs')
    code=probe+'\nprint(json.dumps(inspect(sys.argv[1],sys.argv[2])))\n'
    child=run(['runuser','-u',ACCOUNT,'--','env','-i','PATH=/usr/bin:/bin','/usr/bin/python3','-I','-B','-c',code,str(TARGET),str(CODE)])
    if child.returncode:raise RuntimeError('nonroot standby probe failed')
    verified['nonroot_probe']=json.loads(child.stdout)
    guard(role)
    verified['temporary_unlock_deleted']=not (TARGET_STAGE/'unlock.key').exists()
    return verified


if __name__=='__main__':
    os.umask(0o077)
    try:
        result=main(json.loads(sys.argv[1]))
        if result is not None:print(json.dumps({'ok':True,'result':result}))
    except Exception as error:
        print(json.dumps({'ok':False,'error':type(error).__name__}),file=sys.stderr)
        raise SystemExit(1)
