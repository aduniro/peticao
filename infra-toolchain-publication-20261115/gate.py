"""Closed canonical Rootinstaller gate; no ledger/host effects on import.

Missing canonical source/reviews/window/own deployment capability defaults deny.
No capability acquisition, SSH, install, token output or exception passthrough.
"""
import copy
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import time

ROOT=Path(__file__).absolute().parent
COORD='/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
SESSION='01a1d130-2948-7140-bcfb-34696b20ab8d'
ACTOR='admin-recuperacao'
REVIEWER='apoio'
RESOURCE='deploy:civo-profile-toolchain'
RESOURCES=['code:',RESOURCE]
SCOPE='new-civo-toolchain-publication'
SRI_SOURCE=3429
SRI_PROOF_SHA256='49128ee64078b800019646faff38252d28af1fbd7b6708e6055a0e68221d14a7'
SRI_NOTICE_DATA_SHA256='60aba8575b9bb6769306855d388a22c79aa0bc3a66aa962ec8798235e912e652'
QUALIFICATION_RELEASE_EVENT=3435
QUALIFICATION_RELEASE_RESOURCE='path:/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-toolchain-installer-v1-20261115'
HEADER_KEYS=frozenset({'version','operation_id','operator_session','scope','source_notice','execution_notice','root_window_event',
    'qualification_release_event','full_integrity_event','expected_boot_id','payload_sha256','payload_bytes','unpacked_bytes','files','deadline_unix'})
RUNTIME_BINDINGS={'execution_notice':'canonical_self_event','deadline_unix':'min(now+900,leaseexpires-120,windowcloses-120)'}
QUALIFICATION_RELEASE_DATA={'issuer_thread': '01a1cad7-4a65-7d43-b8c2-f0b50a90a580', 'operator_session': '01a1d130-2948-7140-bcfb-34696b20ab8d', 'scope': 'prepare-frozen-r1-sealed-qualification-candidates', 'tools_prefix': '/opt/peticao-dev-profile-tools-v1', 'app_commit': 'c472837fb5a4584d81f34c420f4de30989084f85', 'source_sha256': '19db95b7c0628dac9fbcec961adbdf3a01bfa00b1519f28a376427e80707a4d5', 'normalized_sha256': '4b2c828ffdd182a8eef3e7fab1dcc8e3a6784318cc2f0c727efd8f978933605f', 'driver_source_notice': 3307, 'runtime_source_notice': 3416, 'full_integrity_event': 3429, 'full_integrity_proof_sha256': '49128ee64078b800019646faff38252d28af1fbd7b6708e6055a0e68221d14a7', 'production_access': False, 'queue_cutover': False, 'host_execution_authorized': False}
MAX_SOURCE=8*1024**2
MAX_CONTROL=2*1024**2


class GateDenied(PermissionError):pass


def require(value):
    if not value:raise GateDenied('rootinstaller_authority_unavailable_or_rejected')


def integer(value):return type(value) is int and value>0


def numeric(value):return type(value) in {int,float} and math.isfinite(value)


def sha256(value):return type(value) is str and re.fullmatch('[a-f0-9]{64}',value) is not None


def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def parse(raw):
    def unique(pairs):
        value={}
        for key,item in pairs:require(key not in value);value[key]=item
        return value
    def reject(_):raise GateDenied('rootinstaller_authority_unavailable_or_rejected')
    return json.loads(raw,object_pairs_hook=unique,parse_constant=reject)


def central(args):
    """Never expose token-bearing argv, timeout command, output or error repr."""
    require(type(args) is list and args and args[0] in {'history','status','check'} and all(type(a) is str for a in args))
    result=None
    try:
        run=subprocess.run(['/usr/bin/python3',COORD,*args],capture_output=True,timeout=30)
        if run.returncode==0 and len(run.stdout)<=16*1024**2:
            value=parse(run.stdout)
            if type(value) is dict and value.get('ok') is True and 'result' in value:result=value['result']
    except Exception:
        pass
    if result is None:raise GateDenied('canonical_ledger_unavailable_or_rejected') from None
    return result


def git(*args):
    result=None
    try:
        run=subprocess.run(['/usr/bin/git','-C',str(ROOT),*args],capture_output=True,timeout=30)
        if run.returncode==0 and len(run.stdout)<=16*1024**2:result=run.stdout.decode('utf-8')
    except Exception:pass
    if result is None:raise GateDenied('reviewed_source_unavailable_or_changed') from None
    return result


def _signature(info):
    return tuple(getattr(info,k) for k in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))


def _walk(path):
    path=Path(path);require(path.is_absolute() and '..' not in path.parts and str(path)==os.path.normpath(str(path)))
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);lineage=[]
    try:
        for part in [None,*path.parts[1:]]:
            if part is not None:
                child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
            info=os.fstat(fd)
            require(info.st_uid in {0,os.getuid()} and not info.st_mode&0o022)
            lineage.append((info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode))
        return fd,lineage
    except BaseException:os.close(fd);raise


def _read(path,limit,private=False,digest_only=False):
    path=Path(path);parent,lineage=_walk(path.parent)
    try:
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            before=os.fstat(stream.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<=before.st_size<=limit)
            require(before.st_uid==os.getuid() if private else before.st_uid in {0,os.getuid()})
            require(stat.S_IMODE(before.st_mode)==0o600 if private else not before.st_mode&0o022)
            if digest_only:
                h=hashlib.sha256();length=0
                while block:=stream.read(1048576):
                    length+=len(block);require(length<=limit);h.update(block)
                raw=(h.hexdigest(),length)
            else:
                raw=stream.read(limit+1);length=len(raw)
            require(length==before.st_size and length<=limit and _signature(before)==_signature(os.fstat(stream.fileno()))
                    and _signature(before)==_signature(os.stat(path.name,dir_fd=parent,follow_symlinks=False)))
        current,after=_walk(path.parent)
        try:require(after==lineage and os.fstat(parent).st_ino==os.fstat(current).st_ino and os.fstat(parent).st_dev==os.fstat(current).st_dev)
        finally:os.close(current)
        return raw
    finally:os.close(parent)


def source_hashes():
    require(git('status','--porcelain','--untracked-files=all').strip()=='')
    require(git('rev-parse','--show-toplevel').strip()==str(ROOT))
    head=git('rev-parse','HEAD').strip();require(re.fullmatch('[a-f0-9]{40}',head) is not None)
    result={};names=git('ls-files','-z').split('\0')
    for name in names:
        if not name:continue
        require(not Path(name).is_absolute() and str(PurePosixPath(name))==name and '..' not in PurePosixPath(name).parts and name not in result)
        result[name]=hashlib.sha256(_read(ROOT/name,MAX_SOURCE)).hexdigest()
    require(bool(result));return head,result


def notice(event,actor,requires_ack=True):
    require(integer(event));rows=central(['history','--after-seq',str(event-1),'--limit','1'])
    require(type(rows) is list and len(rows)==1)
    row=rows[0];require(type(row) is dict and row.get('seq')==event and type(row.get('seq')) is int
        and row.get('kind')=='notice' and row.get('actor')==actor and type(row.get('requires_ack')) is int and row['requires_ack'] in {0,1}
        and (not requires_ack or row['requires_ack']==1))
    return row


def ack(event,actor):
    cursor=event;found=False
    for _ in range(10000):
        rows=central(['history','--after-seq',str(cursor),'--limit','200'])
        require(type(rows) is list and len(rows)<=200)
        if not rows:break
        previous=cursor
        for row in rows:
            require(type(row) is dict and integer(row.get('seq')) and row['seq']>previous);previous=row['seq']
            if row.get('kind')=='ack' and row.get('actor')==actor and type(row.get('data')) is dict and type(row['data'].get('event_seq')) is int and row['data']['event_seq']==event:found=True
        cursor=previous
        if len(rows)<200:break
    else:require(False)
    require(found)


def active_notices(events):
    status=central(['status']);require(type(status) is dict and type(status.get('notice_dispositions')) is list)
    for row in status['notice_dispositions']:
        require(type(row) is dict and integer(row.get('target_event')))
        require(row['target_event'] not in events)


def _relative(value):
    require(type(value) is str and value and value not in {'.','..'} and not value.startswith('/') and str(PurePosixPath(value))==value
        and '..' not in PurePosixPath(value).parts and '\\' not in value and not any(ord(c)<32 for c in value))
    return ROOT/value


def validate_header_template(header,bindings):
    """Pure Owner schema, with ONLY the two reviewed runtime placeholders."""
    require(type(header) is dict and set(header)==HEADER_KEYS and type(bindings) is dict and bindings==RUNTIME_BINDINGS)
    require(type(header['version']) is int and header['version']==1
        and type(header['operation_id']) is str and re.fullmatch('[a-f0-9]{32}',header['operation_id']) is not None
        and header['operator_session']==SESSION and header['scope']=='new-civo-sealed-toolchain-no-dispatch')
    require(type(header['execution_notice']) is int and header['execution_notice']==0
        and type(header['deadline_unix']) is int and header['deadline_unix']==0)
    for key in ('source_notice','root_window_event','qualification_release_event','full_integrity_event'):
        require(integer(header[key]) and header[key]<=2**53)
    require(header['full_integrity_event']==SRI_SOURCE and type(header['expected_boot_id']) is str
        and re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',header['expected_boot_id']) is not None)
    require(sha256(header['payload_sha256']) and integer(header['payload_bytes']) and header['payload_bytes']<=1536*1024**2
        and integer(header['unpacked_bytes']) and header['unpacked_bytes']<=2*1024**3)
    require(type(header['files']) is dict and 1<=len(header['files'])<=50000)
    for path,row in header['files'].items():
        _relative(path);require(len(path.encode())<=1024 and not any(ord(c)==127 for c in path))
        require(type(row) is dict and set(row)=={'sha256','bytes','mode'} and sha256(row['sha256'])
            and type(row['bytes']) is int and 0<=row['bytes']<=512*1024**2
            and type(row['mode']) is int and row['mode'] in {0o644,0o755})
    canonical(header)
    return header


def qualification_release(event):
    row=notice(event,ACTOR)
    require(event==QUALIFICATION_RELEASE_EVENT and row['resources']==[QUALIFICATION_RELEASE_RESOURCE] and type(row['data']) is dict and canonical(row['data'])==canonical(QUALIFICATION_RELEASE_DATA))
    ack(event,REVIEWER);active_notices({event})
    return event


def _execution(value):
    require(type(value) is dict and set(value)=={'operation_id','header_template','runtime_bindings','payload_path','payload_sha256','payload_bytes'})
    require(type(value['operation_id']) is str and re.fullmatch('[a-f0-9]{32}',value['operation_id']) is not None)
    require(integer(value['payload_bytes']) and value['payload_bytes']<=1536*1024**2 and sha256(value['payload_sha256']))
    spec=value['header_template']
    require(type(spec) is dict and set(spec)=={'path','sha256','bytes'} and sha256(spec['sha256'])
        and integer(spec['bytes']) and spec['bytes']<=MAX_CONTROL)
    raw=_read(_relative(spec['path']),MAX_CONTROL)
    require(len(raw)==spec['bytes'] and hashlib.sha256(raw).hexdigest()==spec['sha256'])
    header=validate_header_template(parse(raw),value['runtime_bindings'])
    require(raw==canonical(header) and header['operation_id']==value['operation_id']
        and header['payload_sha256']==value['payload_sha256'] and header['payload_bytes']==value['payload_bytes'])
    digest,length=_read(_relative(value['payload_path']),1536*1024**2,digest_only=True)
    require(digest==value['payload_sha256'] and length==value['payload_bytes'])
    result=copy.deepcopy(value)
    result.update(header_template=header,header_path=spec['path'],header_sha256=spec['sha256'],header_bytes=spec['bytes'])
    return result


def reviewed(event,action):
    head,hashes=source_hashes();row=notice(event,ACTOR);d=row['data']
    fields={'version','operation','preparation_only','production_access','queue_cutover','operator_session','scope','source_notice',
        'root_window_event','qualification_release_event','full_integrity_event','manifest','file_sha256','execution'}
    require(type(d) is dict and set(d)==fields and row['resources']==[RESOURCE]
        and type(d['version']) is int and d['version']==1 and d['operation']=='deploy' and d['preparation_only'] is False
        and d['production_access'] is False and d['queue_cutover'] is False and d['operator_session']==SESSION and d['scope']==SCOPE)
    require(all(integer(d[key]) for key in ('source_notice','root_window_event','qualification_release_event','full_integrity_event'))
        and d['full_integrity_event']==SRI_SOURCE and d['qualification_release_event']==QUALIFICATION_RELEASE_EVENT)
    require(type(d['manifest']) is dict and d['manifest'].get('commit')==head and d['file_sha256']==hashes)
    source=notice(d['source_notice'],ACTOR);sd=source['data']
    require(source['resources']==['path:'+str(ROOT)] and sd.get('preparation_only') is True and sd.get('production_access') is False
        and sd.get('queue_cutover') is False and sd.get('manifest',{}).get('commit')==head and sd.get('file_sha256')==hashes)
    ack(d['source_notice'],REVIEWER);ack(event,REVIEWER)
    execution=_execution(d['execution']);header=execution['header_template']
    require(header['source_notice']==d['source_notice'] and header['root_window_event']==d['root_window_event']
        and header['qualification_release_event']==d['qualification_release_event'] and header['full_integrity_event']==SRI_SOURCE)
    qualification_release(d['qualification_release_event'])
    window=notice(d['root_window_event'],ACTOR);wd=window['data'];now=time.time()
    require(window['resources']==[RESOURCE] and type(wd) is dict and set(wd)=={'source_notice','operation_id','operator_session','resource','scope','production_access','queue_cutover','opens_at','closes_at','root_thread','source_commit'}
        and wd['root_thread']=='01a1cad7-4a65-7d43-b8c2-f0b50a90a580' and wd['source_commit']==head
        and wd['source_notice']==d['source_notice'] and wd['operation_id']==execution['operation_id'] and wd['operator_session']==SESSION
        and wd['resource']==RESOURCE and wd['scope']==SCOPE and wd['production_access'] is False and wd['queue_cutover'] is False
        and numeric(wd['opens_at']) and numeric(wd['closes_at']) and numeric(now) and 0<wd['closes_at']-wd['opens_at']<=3600
        and wd['opens_at']<=now<wd['closes_at'] and wd['closes_at']-now>=(1020 if action=='install' else 0))
    ack(d['root_window_event'],REVIEWER)
    sri=notice(SRI_SOURCE,REVIEWER,requires_ack=False);s=sri['data']
    require(s.get('proof_sha256')==SRI_PROOF_SHA256 and s.get('fullVendorIntegrity') is True
        and s.get('cacheOriginalIntegral') is False and s.get('RootFullClosure') is False and s.get('qualified') is False
        and hashlib.sha256(canonical(s)).hexdigest()==SRI_NOTICE_DATA_SHA256)
    ack(SRI_SOURCE,ACTOR)
    active_notices({event,d['source_notice'],d['root_window_event'],SRI_SOURCE,d['qualification_release_event']})
    require(all(sha256(hashes.get(name)) for name in ('materializer.py','root_entry.py')))
    execution['remote_code_sha256']={name:hashes[name] for name in ('materializer.py','root_entry.py')}
    return d,execution,wd['closes_at']


def validate_lease(path,event,action):
    raw=_read(Path(path),16384,private=True);record=parse(raw)
    require(type(record) is dict and set(record)=={'operator_session','result'} and record['operator_session']==SESSION)
    cap=record['result'];require(type(cap) is dict and set(cap)=={'lease','token','fence','expires','resources','seq'})
    require(type(cap['lease']) is str and re.fullmatch('[a-f0-9]{32}',cap['lease']) is not None
        and type(cap['token']) is str and re.fullmatch('[a-f0-9]{48}',cap['token']) is not None
        and integer(cap['fence']) and integer(cap['seq']) and cap['resources']==RESOURCES and numeric(cap['expires']))
    checked=central(['check','--actor',ACTOR,'--lease',cap['lease'],'--token',cap['token'],'--fence',str(cap['fence'])])
    require(type(checked) is dict and checked.get('valid') is True and checked.get('lease')==cap['lease'] and checked.get('fence')==cap['fence'] and type(checked.get('fence')) is int)
    status=central(['status']);matches=[r for r in status['leases'] if r.get('id')==cap['lease']];require(len(matches)==1)
    lease=matches[0];now=time.time()
    require(lease.get('actor')==ACTOR and lease.get('operation')=='deploy' and lease.get('state')=='active'
        and lease.get('resources')==RESOURCES and type(lease.get('fence')) is int and lease['fence']==cap['fence']
        and numeric(lease.get('expires')) and numeric(now) and now<lease['expires']
        and lease['expires']-now>=(1020 if action=='install' else 0)
        and numeric(checked.get('expires')) and checked['expires']==lease['expires'])
    rows=central(['history','--after-seq',str(cap['seq']-1),'--limit','1']);require(type(rows) is list and len(rows)==1)
    acquired=rows[0];data=acquired['data']
    require(acquired.get('seq')==cap['seq'] and type(acquired.get('seq')) is int and acquired.get('kind')=='lease_acquired'
        and acquired.get('actor')==ACTOR and acquired.get('resources')==RESOURCES and data.get('manifest_event')==event
        and data.get('lease')==cap['lease'] and data.get('fence')==cap['fence'] and type(data.get('fence')) is int
        and data.get('operation')=='deploy' and type(data.get('manifest_event')) is int
        and numeric(data.get('expires')) and data['expires']==cap['expires'])
    return {'fence':cap['fence'],'lease_expires':lease['expires']}


class Gate:
    def __init__(self,event,capfile):self.event=event;self.capfile=Path(capfile)
    def __call__(self,action):
        result=None
        try:
            require(action in {'install','observe'} and integer(self.event))
            d,execution,window_closes=reviewed(self.event,action);lease=validate_lease(self.capfile,self.event,action)
            # Recheck dispositions after capability/history reads as well.
            active_notices({self.event,d['source_notice'],d['root_window_event'],SRI_SOURCE,d['qualification_release_event']})
            head,hashes=source_hashes()
            require(head==d['manifest']['commit'] and hashes==d['file_sha256'] and _execution(d['execution'])=={k:v for k,v in execution.items() if k!='remote_code_sha256'})
            result={'action':action,'execution':execution,'authority':{'session':SESSION,'execution_event':self.event,
                'source_notice':d['source_notice'],'root_window_notice':d['root_window_event'],'fence':lease['fence'],
                'lease_expires':lease['lease_expires'],'window_closes':window_closes}}
        except Exception:pass
        if result is None:raise GateDenied('rootinstaller_authority_unavailable_or_rejected') from None
        return result
