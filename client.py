"""Source-only Root installer client. Default deny; Owner wire schema pending.

No CLI, capability acquisition or implicit network. Only trusted operator code
may bind Gate/Owner callbacks and the exact two reviewed public code blobs.
The incoming payload is DATA, never remote Python source.
"""
import base64
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import stat
import subprocess
import threading
import time

HOST='100.122.224.82'
HOST_KEY_ALIAS='212.2.241.70'
IDENTITY='/home/barre/.ssh/id_ed25519_peticao_tailnet_v2'
KNOWN_HOSTS='/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-owner-bundle-20261114/known_hosts'
KNOWN_HOSTS_SHA='011704a32b8bb573f75b6d67e8ce46421350584988394303a3e7fe365e6f013f'
INTERFACE_SHA='9345cef30e93c5e097a549d3d8bca59d44685737ee444a98e0304b221c907063'
MAX_HEADER=2*1024**2
MAX_REPLY=32768
MAX_PAYLOAD=1536*1024**2
CHUNK=65536
MAX_PUBLIC_CODE=65536
ACTIONS=frozenset({'install','observe'})
SOURCE_ONLY=True
QUALIFIED=False
OWNER_SCHEMA_INTEGRATED=True
OPERATOR_COMPOSITION_READY=False
WIRE_SCHEMA_SHA='da85ba434599d7fff14c513c5a70005e61233cdc67c084036e70141a932a8b61'
OPERATOR_SESSION='01a1d130-2948-7140-bcfb-34696b20ab8d'
HEADER_KEYS=frozenset({'version','operation_id','operator_session','scope','source_notice','execution_notice',
    'root_window_event','qualification_release_event','full_integrity_event','expected_boot_id','payload_sha256',
    'payload_bytes','unpacked_bytes','files','deadline_unix'})
_EVENTS=frozenset({'source_notice','execution_notice','root_window_event','qualification_release_event','full_integrity_event'})
_COMMON_OBSERVE={'state','no_retry','operational_ready'}
_WRITER_OBSERVE=_COMMON_OBSERVE|{'writer','writer_alive','prefix_exists'}
REPLY_KEYS={
 'SEALED_PUBLIC_TOOLCHAIN_CANDIDATE_PUBLISHED':{'state','operation_id','prefix','files','bytes','source_notice',
     'execution_notice','candidate_programs_executed','operational_ready','native_profiles_qualified','queue_cutover'},
 'NOT_STARTED':_COMMON_OBSERVE,
 'FOREIGN_PATH_WITHOUT_INTENT_UNCERTAIN':_COMMON_OBSERVE,
 'WRITER_ACTIVE_OBSERVE_ONLY':_WRITER_OBSERVE,
 'PARTIAL_OR_VISIBLE_WITHOUT_RECEIPT_RECONCILIATION_REQUIRED':_WRITER_OBSERVE,
 'PUBLISHED_CANDIDATE_RECEIPT_AND_TREE_VERIFIED':{'state','writer','writer_alive','files','operational_ready','native_profiles_qualified','queue_cutover'},
 'INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY':{'state','error_type'}}
_UUID=r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
_UNSET=object()


class IntegrationPending(PermissionError): pass
class ClientRefused(PermissionError): pass
class TransportUncertain(RuntimeError): pass


def denied(*args,**kwargs):raise ClientRefused('default_scope_denied')


def _integer(value,minimum,maximum):
    if type(value)is not int or not minimum<=value<=maximum:raise ClientRefused('exact_bounded_integer_required')


def _number(value):return type(value)in(int,float)and 0<=value<=2**53 and math.isfinite(value)


def concrete_deadline(now,lease_expires,window_closes):
    if not all(_number(x)for x in(now,lease_expires,window_closes)):raise ClientRefused('finite_clock_inputs_required')
    if min(lease_expires-now,window_closes-now)<1020:raise ClientRefused('install_authority_margin_below_1020')
    return min(now+900,lease_expires-120,window_closes-120)


def validate_wire_header(header,action,now=None):
    """Pure schema only; NOT Gate/Owner operational integration or authority."""
    if action not in ACTIONS or type(header)is not dict or set(header)!=HEADER_KEYS:raise ClientRefused('exact_owner_header_keys_required')
    if type(header['version'])is not int or header['version']!=1:raise ClientRefused('header_version_one_required')
    if type(header['operation_id'])is not str or not re.fullmatch('[a-f0-9]{32}',header['operation_id']):raise ClientRefused('fixed_operation_id_shape')
    if header['operator_session']!=OPERATOR_SESSION or header['scope']!='new-civo-sealed-toolchain-no-dispatch':raise ClientRefused('fixed_session_scope_required')
    for key in _EVENTS:_integer(header[key],1,2**53)
    if type(header['expected_boot_id'])is not str or not re.fullmatch(_UUID,header['expected_boot_id']):raise ClientRefused('boot_uuid_required')
    _sha(header['payload_sha256']);_integer(header['payload_bytes'],1,MAX_PAYLOAD);_integer(header['unpacked_bytes'],1,2*1024**3)
    files=header['files']
    if type(files)is not dict or not 1<=len(files)<=50000:raise ClientRefused('bounded_file_inventory_required')
    for path,row in files.items():
        if (type(path)is not str or not path or len(path)>1024 or path.startswith('/')or path!=str(PurePosixPath(path))
                or '\\'in path or any(ord(c)<32 or ord(c)==127 for c in path)or any(p in('.','..')for p in path.split('/'))):
            raise ClientRefused('relative_inventory_path_required')
        if type(row)is not dict or set(row)!={'sha256','bytes','mode'}:raise ClientRefused('exact_file_pin_keys_required')
        _sha(row['sha256']);_integer(row['bytes'],0,512*1024**2)
        if type(row['mode'])is not int or row['mode']not in(0o644,0o755):raise ClientRefused('fixed_public_file_mode_required')
    if not _number(header['deadline_unix']):raise ClientRefused('finite_deadline_required')
    if action=='install':
        if not _number(now)or not now<header['deadline_unix']<=now+900:raise ClientRefused('install_deadline_outside_window')
    canonical_header(header)


def validate_wire_reply(value,header):
    """Exact published whitelist. Owner authority/reconciliation still pending."""
    if type(value)is not dict or type(value.get('state'))is not str or value['state']not in REPLY_KEYS or set(value)!=REPLY_KEYS[value['state']]:
        raise TransportUncertain('exact_owner_reply_variant_required')
    for key in ('operational_ready','native_profiles_qualified','queue_cutover','candidate_programs_executed'):
        if key in value and value[key]is not False:raise TransportUncertain('readiness_must_remain_false')
    if 'no_retry'in value and value['no_retry']is not True:raise TransportUncertain('no_retry_must_remain_true')
    for key in ('writer_alive','prefix_exists'):
        if key in value and type(value[key])is not bool:raise TransportUncertain('exact_reply_boolean_required')
    if 'writer'in value:
        writer=value['writer']
        if type(writer)is not dict or set(writer)!={'pid','start_ticks','boot_id'}:raise TransportUncertain('exact_writer_identity_required')
        _integer(writer['pid'],1,2**31-1)
        if type(writer['start_ticks'])is not str or not re.fullmatch('[1-9][0-9]{0,19}',writer['start_ticks']):raise TransportUncertain('canonical_writer_start_ticks_string_required')
        if type(writer['boot_id'])is not str or not re.fullmatch(_UUID,writer['boot_id'])or writer['boot_id']!=header['expected_boot_id']:raise TransportUncertain('writer_boot_uuid_required')
    if 'files'in value:_integer(value['files'],0,50000)
    if 'bytes'in value:_integer(value['bytes'],0,2*1024**3)
    if 'prefix'in value and value['prefix']!='/opt/peticao-dev-profile-tools-v1':raise TransportUncertain('fixed_public_prefix_required')
    for key in ('operation_id','source_notice','execution_notice'):
        if key in value and key!='operation_id':_integer(value[key],1,2**53)
        if key in value and value[key]!=header[key]:raise TransportUncertain('reply_operation_identity_mismatch')
    if 'error_type'in value and(type(value['error_type'])is not str or not re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,63}',value['error_type'])):
        raise TransportUncertain('public_error_type_only')
    return dict(value)


def canonical_header(value):
    if type(value)is not dict:raise ClientRefused('header_object_required')
    try:raw=json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    except (ValueError,TypeError,RecursionError):raise ClientRefused('canonical_header_required')from None
    if not 0<len(raw)<=MAX_HEADER:raise ClientRefused('header_length_bound')
    return raw


def parse_reply(raw):
    if type(raw)is not bytes or not 0<len(raw)<=MAX_REPLY:raise TransportUncertain('bounded_reply_required')
    def pairs(rows):
        value={}
        for key,item in rows:
            if key in value:raise ValueError('duplicate')
            value[key]=item
        return value
    def constant(_):raise ValueError('nonfinite')
    try:value=json.loads(raw,object_pairs_hook=pairs,parse_constant=constant)
    except (ValueError,UnicodeError,TypeError,RecursionError):raise TransportUncertain('invalid_reply')from None
    if type(value)is not dict:raise TransportUncertain('reply_object_required')
    return value


def _sha(value):
    if type(value)is not str or not re.fullmatch('[a-f0-9]{64}',value):raise ClientRefused('exact_sha256_required')


def _path(path):
    value=os.fspath(path)
    if (type(value)is not str or not value.startswith('/') or value!=str(PurePosixPath(value))
            or '..'in PurePosixPath(value).parts or '\\'in value or '\0'in value):
        raise ClientRefused('canonical_absolute_file_required')
    return Path(value)


def _directory(path):
    path=_path(path);fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
        return fd
    except BaseException:os.close(fd);raise


def _signature(info):return tuple(getattr(info,key)for key in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))


def _hash(fp):
    fp.seek(0);value=hashlib.sha256()
    for block in iter(lambda:fp.read(CHUNK),b''):value.update(block)
    return value.hexdigest()


@contextmanager
def verified_payload(path,expected_sha,size):
    _sha(expected_sha)
    if type(size)is not int or not 0<size<=MAX_PAYLOAD:raise ClientRefused('bounded_exact_payload_size_required')
    path=_path(path);parent=_directory(path.parent)
    try:
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb')as fp:
            before=os.fstat(fp.fileno())
            if (not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or before.st_size!=size
                    or before.st_uid not in {0,os.geteuid()}or before.st_mode&0o022):
                raise ClientRefused('owned_readonly_exact_payload_required')
            if _hash(fp)!=expected_sha:raise ClientRefused('payload_sha_mismatch')
            fp.seek(0)
            yield fp
            if _hash(fp)!=expected_sha or _signature(before)!=_signature(os.fstat(fp.fileno()))or _signature(before)!=_signature(os.stat(path.name,dir_fd=parent,follow_symlinks=False)):
                raise TransportUncertain('payload_changed_preserve_intent')
    finally:os.close(parent)


def frame_chunks(header_bytes,payload=None,payload_sha=None,payload_size=0):
    """One iterable; no payload concatenation. Header MUST already be Owner-checked."""
    if type(header_bytes)is not bytes or not 0<len(header_bytes)<=MAX_HEADER:raise ClientRefused('bounded_header_bytes_required')
    if payload is None:
        if payload_sha is not None or type(payload_size)is not int or payload_size!=0:raise ClientRefused('observe_header_only')
    else:
        _sha(payload_sha)
        if type(payload_size)is not int or not 0<payload_size<=MAX_PAYLOAD:raise ClientRefused('bounded_payload_size_required')
    yield len(header_bytes).to_bytes(8,'big',signed=False)
    # Bound individual writes even when the allowed header itself is 2MiB.
    for start in range(0,len(header_bytes),CHUNK):yield header_bytes[start:start+CHUNK]
    if payload is not None:
        digest=hashlib.sha256();remaining=payload_size
        while remaining:
            block=payload.read(min(CHUNK,remaining))
            if not block:raise TransportUncertain('truncated_payload_preserve_intent')
            if len(block)>remaining:raise TransportUncertain('oversized_payload_chunk')
            digest.update(block);remaining-=len(block);yield block
        if payload.read(1)or digest.hexdigest()!=payload_sha:raise TransportUncertain('streamed_payload_pin_mismatch')


class OwnerContract:
    """Concrete Owner rules; None template stays closed. No validator callbacks.

    The trusted composition supplies the reviewed canonical 15-key template,
    never a job-selected object. Gate returns public stable authority, no token.
    Only execution_notice and deadline_unix may differ from template zeros.
    """
    def __init__(self,header_template=None,clock=time.time):
        self.clock=clock;self.template=None;self._prepared=None;self._requests={}
        if header_template is not None:
            raw=canonical_header(header_template);value=json.loads(raw)
            if set(value)!=HEADER_KEYS or type(value['execution_notice'])is not int or value['execution_notice']!=0 or type(value['deadline_unix'])is not int or value['deadline_unix']!=0:
                raise ClientRefused('exact_two_zero_runtime_placeholders_required')
            probe=dict(value);probe.update(execution_notice=1,deadline_unix=1)
            validate_wire_header(probe,'observe')
            self.template=value;self.template_bytes=raw
    def ready(self):
        if self.template is None:raise IntegrationPending('owner_template_integration_pending')
    def _authority(self,action,grant,*,require_live=True):
        self.ready()
        if type(grant)is not dict or grant.get('action')!=action or type(grant.get('authority'))is not dict or type(grant.get('execution'))is not dict:
            raise ClientRefused('gate_public_grant_required')
        a=grant['authority'];e=grant['execution'];now=self.clock()
        if not _number(now)or a.get('session')!=OPERATOR_SESSION:raise ClientRefused('current_public_authority_required')
        _integer(a.get('execution_event'),1,2**53);_integer(a.get('fence'),1,2**63-1)
        # Header source_notice is authenticated by the reviewed template hash;
        # authority.source_notice may identify the separate operator source.
        if a.get('root_window_notice')!=self.template['root_window_event']:
            raise ClientRefused('same_original_window_required')
        if not _number(a.get('lease_expires'))or not _number(a.get('window_closes'))or(require_live and min(a['lease_expires'],a['window_closes'])<=now):
            raise ClientRefused('original_authority_expired_observe_blocked')
        if action=='install'and require_live:concrete_deadline(now,a['lease_expires'],a['window_closes'])
        if e.get('operation_id')!=self.template['operation_id']or e.get('payload_sha256')!=self.template['payload_sha256']or type(e.get('payload_bytes'))is not int or e['payload_bytes']!=self.template['payload_bytes']:
            raise ClientRefused('exact_execution_payload_binding_required')
        if e.get('header_sha256')!=hashlib.sha256(self.template_bytes).hexdigest()or e.get('header_bytes')!=len(self.template_bytes):
            raise ClientRefused('reviewed_canonical_template_binding_required')
        if canonical_header(e.get('header_template'))!=self.template_bytes:raise ClientRefused('gate_reparsed_template_mismatch')
        return a,e,now
    def prepare(self,grant):
        a,e,now=self._authority('install',grant)
        value=json.loads(self.template_bytes);value['execution_notice']=a['execution_event']
        value['deadline_unix']=concrete_deadline(now,a['lease_expires'],a['window_closes'])
        self._prepared=canonical_header(value)
        return value
    def request(self,action,header,sha,size,grant):
        a,e,now=self._authority(action,grant)
        validate_wire_header(header,action,now)
        stable=dict(header);stable.update(execution_notice=0,deadline_unix=0)
        if canonical_header(stable)!=self.template_bytes or type(header['execution_notice'])is not int or header['execution_notice']!=a['execution_event']:
            raise ClientRefused('only_two_authorized_runtime_header_bindings')
        raw=canonical_header(header)
        if action=='install':
            if self._prepared is None or raw!=self._prepared:raise ClientRefused('concrete_header_must_be_prepared_once')
            if sha!=header['payload_sha256']or type(size)is not int or size!=header['payload_bytes']:raise ClientRefused('exact_payload_binding_required')
        elif sha is not None or size!=0:raise ClientRefused('observe_has_no_payload')
        self._requests[action]=json.loads(raw)
    def payload_path(self,grant):
        relative=grant['execution'].get('payload_path')
        if type(relative)is not str or not relative or relative.startswith('/')or relative!=str(PurePosixPath(relative))or any(p in('.','..')for p in relative.split('/'))or '\\'in relative:
            raise ClientRefused('reviewed_packet_relative_payload_required')
        return Path(__file__).absolute().parent/relative
    def reply(self,action,value,grant):
        # Recording an already received bounded reply is not a new SSH/action.
        # Fresh authority is checked before every exchange, not renewed here.
        self._authority(action,grant,require_live=False)
        matrix={'install':{'SEALED_PUBLIC_TOOLCHAIN_CANDIDATE_PUBLISHED','INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY'},
            'observe':set(REPLY_KEYS)-{'SEALED_PUBLIC_TOOLCHAIN_CANDIDATE_PUBLISHED'}}
        if type(value)is not dict or value.get('state')not in matrix[action]or action not in self._requests:
            raise TransportUncertain('reply_action_matrix_mismatch')
        header=self._requests[action];safe=validate_wire_reply(value,header)
        if 'files'in safe and safe['files']!=len(header['files']):raise TransportUncertain('reply_file_count_mismatch')
        if 'bytes'in safe and safe['bytes']!=sum(r['bytes']for r in header['files'].values()):raise TransportUncertain('reply_byte_count_mismatch')
        return safe


def _read_public_blob(row,limit):
    if type(row)is not dict or set(row)!={'path','sha256','bytes'}:raise ClientRefused('exact_public_blob_pin_required')
    _sha(row['sha256'])
    if type(row['bytes'])is not int or not 0<row['bytes']<=limit:raise ClientRefused('public_blob_budget')
    with verified_payload(row['path'],row['sha256'],row['bytes'])as fp:return fp.read(limit+1)


def public_remote_command(action,blobs):
    if action not in ACTIONS:raise ClientRefused('fixed_action_required')
    if type(blobs)is not dict or set(blobs)!={'materializer.py','root_entry.py'}:raise IntegrationPending('exact_two_public_blobs_required')
    values={name:_read_public_blob(row,MAX_PUBLIC_CODE)for name,row in blobs.items()}
    if sum(map(len,values.values()))>MAX_PUBLIC_CODE:raise ClientRefused('combined_public_code_budget')
    # These bytes are reviewed PUBLIC installer code, not incoming tar data.
    bootstrap='import base64,json,sys,types\ntry:\n'
    for name in ('materializer','root_entry'):
        encoded=base64.b64encode(values[name+'.py']).decode()
        bootstrap+=(" m=types.ModuleType("+repr(name)+");m.__file__="+repr('<pinned-public-'+name+'>')+
            ";sys.modules["+repr(name)+"]=m;exec(compile(base64.b64decode("+repr(encoded)+"),m.__file__,'exec'),m.__dict__)\n")
    bootstrap+=" result=sys.modules['root_entry'].dispatch("+repr(action)+",sys.stdin.buffer)\n"
    bootstrap+=" if type(result) is not dict:raise TypeError()\n print(json.dumps(result,sort_keys=True,separators=(',',':'),allow_nan=False))\n"
    bootstrap+="except Exception as error:\n print(json.dumps({'state':'INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY','error_type':type(error).__name__},sort_keys=True,separators=(',',':')))\n sys.exit(1)\n"
    command='/usr/bin/python3 -I -S -B -c '+shlex.quote(bootstrap)
    if len(command.encode())>96*1024:raise ClientRefused('bounded_public_remote_command_required')
    return command


class PinnedSSH:
    """Integration-closed by default. Never read identity private key ourselves."""
    def __init__(self,blobs=None,*,integration_enabled=False,deadline_seconds=900):
        self.blobs=blobs;self.integration_enabled=integration_enabled;self.deadline_seconds=deadline_seconds
    @staticmethod
    def argv():
        return ['/usr/bin/ssh','-F','/dev/null','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
            '-o','UserKnownHostsFile='+KNOWN_HOSTS,'-o','HostKeyAlias='+HOST_KEY_ALIAS,
            '-o','GlobalKnownHostsFile=/dev/null','-o','IdentityAgent=none','-o','PreferredAuthentications=publickey',
            '-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no',
            '-o','IdentitiesOnly=yes','-o','IdentityFile='+IDENTITY,'-o','ControlMaster=no',
            '-o','ControlPath=none','-o','ControlPersist=no','-o','ClearAllForwardings=yes',
            '-o','ForwardAgent=no','-o','ForwardX11=no','-o','ProxyCommand=none','-o','ProxyJump=none',
            '-o','ConnectTimeout=20','-p','22','root@'+HOST]
    def exchange(self,action,chunks,pre_ssh):
        if self.integration_enabled is not True:raise IntegrationPending('ssh_integration_closed')
        if type(self.deadline_seconds)is not int or not 1<=self.deadline_seconds<=3600:raise ClientRefused('reviewed_transport_deadline_required')
        if type(self.blobs)is not dict or set(self.blobs)!={'materializer.py','root_entry.py'}:raise IntegrationPending('two_reviewed_remote_blobs_required')
        blobs={name:dict(row)for name,row in self.blobs.items()}
        command=public_remote_command(action,blobs)
        # Fixed public host key, no identity/capability bytes ever copied.
        path=_path(KNOWN_HOSTS);parent=_directory(path.parent)
        try:
            fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
            with os.fdopen(fd,'rb')as fp:
                info=os.fstat(fp.fileno())
                if not stat.S_ISREG(info.st_mode)or info.st_size>65536 or _hash(fp)!=KNOWN_HOSTS_SHA:raise ClientRefused('fixed_public_host_pin_changed')
        finally:os.close(parent)
        try:
            grant=pre_ssh()  # Immediately before EVERY actual SSH subprocess.
            remote=grant['execution']['remote_code_sha256']
            if type(remote)is not dict or len(remote)!=2:raise ClientRefused('two_gate_remote_hashes_required')
            actual={Path(name).name:value for name,value in remote.items()}
            if actual!={name:row['sha256']for name,row in blobs.items()}:raise ClientRefused('gate_remote_code_pin_changed')
        except Exception:raise ClientRefused('scope_recheck_denied_or_unavailable')from None
        process=None;writer=None;reader=None;state={'reply':bytearray(),'overflow':False,'io_error':False}
        try:
            process=subprocess.Popen(self.argv()+[command],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,bufsize=0,close_fds=True,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
            def write():
                try:
                    for block in chunks:
                        view=memoryview(block)
                        while view:
                            n=process.stdin.write(view)
                            if not n:raise OSError('short_write')
                            view=view[n:]
                except Exception:state['io_error']=True
                finally:
                    try:process.stdin.close()
                    except Exception:pass
            def read():
                try:
                    for block in iter(lambda:process.stdout.read(CHUNK),b''):
                        remaining=MAX_REPLY-len(state['reply']);state['reply'].extend(block[:max(0,remaining)])
                        if len(block)>remaining:state['overflow']=True
                except Exception:state['io_error']=True
            writer=threading.Thread(target=write,daemon=True);reader=threading.Thread(target=read,daemon=True)
            reader.start();writer.start();process.wait(timeout=self.deadline_seconds)
            writer.join(timeout=2);reader.join(timeout=2)
            if writer.is_alive()or reader.is_alive()or state['overflow']:
                raise TransportUncertain('ssh_outcome_uncertain_observe_only')
            if process.returncode or state['io_error']:
                # Owner bootstrap returns exactly this safe JSON + exit1.
                value=parse_reply(bytes(state['reply']))
                if value.get('state')!='INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY':raise TransportUncertain('ssh_outcome_uncertain_observe_only')
                validate_wire_reply(value,{})
            return bytes(state['reply'])
        except Exception:
            # Deliberately discard TimeoutExpired/OSError argv/stdout/stderr.
            raise TransportUncertain('ssh_outcome_uncertain_observe_only')from None
        finally:
            if process is not None:
                if process.poll()is None:
                    try:process.kill();process.wait(timeout=5)
                    except Exception:pass
                if writer is not None and writer.is_alive():writer.join(timeout=2)
                if reader is not None and reader.is_alive():reader.join(timeout=2)
                for stream in (process.stdin,process.stdout):
                    try:stream.close()
                    except Exception:pass


class Client:
    def __init__(self,scope_guard=denied,transport=None,contract=None):
        self.scope_guard=scope_guard;self.transport=transport;self.contract=contract or OwnerContract()
    def _guard(self,action):
        try:return self.scope_guard(action)
        except Exception:raise ClientRefused('scope_authority_denied_or_unavailable')from None
    def _request(self,action,header,sha,size,grant=_UNSET):
        if grant is _UNSET:grant=self._guard(action)  # FIRST: default deny before effects.
        try:self.contract.request(action,header,sha,size,grant)
        except IntegrationPending:raise IntegrationPending('owner_integration_pending')from None
        except Exception:raise ClientRefused('owner_request_denied')from None
        raw=canonical_header(header)
        frozen=json.loads(raw)
        def recheck():
            current=self._guard(action)
            self.contract.request(action,frozen,sha,size,current)
            if current!=grant:raise ClientRefused('scope_changed_before_ssh')
            return current
        return grant,raw,recheck
    @contextmanager
    def _state(self,create=True):
        packet=_path(Path(__file__).absolute().parent);parent=_directory(packet)
        try:
            before=os.fstat(parent)
            if before.st_uid!=os.geteuid()or stat.S_IMODE(before.st_mode)!=0o700:raise ClientRefused('own_private_packet_required')
            if create:
                try:os.mkdir('execution-state',0o700,dir_fd=parent);os.fsync(parent)
                except FileExistsError:pass
            fd=os.open('execution-state',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            try:
                info=os.fstat(fd)
                if info.st_uid!=os.geteuid()or stat.S_IMODE(info.st_mode)!=0o700:raise ClientRefused('own_private_state_required')
                yield fd
                named=os.stat('execution-state',dir_fd=parent,follow_symlinks=False)
                if (info.st_dev,info.st_ino)!=(named.st_dev,named.st_ino)or(before.st_dev,before.st_ino)!=(packet.lstat().st_dev,packet.lstat().st_ino):
                    raise TransportUncertain('local_state_replaced_preserve_intent')
            finally:os.close(fd)
        finally:os.close(parent)
    @staticmethod
    def _record(fd,name,value):
        raw=value if type(value)is bytes else json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()+b'\n'
        child=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
        os.fchmod(child,0o600)
        with os.fdopen(child,'wb')as fp:fp.write(raw);fp.flush();os.fsync(fp.fileno())
        os.fsync(fd)
    def _saved_header(self):
        with self._state(create=False)as state:
            fd=os.open('install-header.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=state)
            with os.fdopen(fd,'rb')as fp:
                before=os.fstat(fp.fileno())
                if(not stat.S_ISREG(before.st_mode)or before.st_uid!=os.geteuid()or before.st_nlink!=1
                    or stat.S_IMODE(before.st_mode)!=0o600 or not 0<before.st_size<=MAX_HEADER):raise ClientRefused('private_saved_header_required')
                raw=fp.read(MAX_HEADER+1)
                if len(raw)!=before.st_size or _signature(before)!=_signature(os.fstat(fp.fileno()))or _signature(before)!=_signature(os.stat('install-header.json',dir_fd=state,follow_symlinks=False)):raise ClientRefused('saved_header_changed')
                value=json.loads(raw)
                if canonical_header(value)!=raw:raise ClientRefused('exact_canonical_saved_header_required')
                return raw,value
    def install(self,header,payload_path,payload_sha256,payload_bytes):
        grant=self._guard('install')
        self.contract.ready()
        if header is None:header=self.contract.prepare(grant)
        grant,raw,recheck=self._request('install',header,payload_sha256,payload_bytes,grant=grant)
        if self.transport is None:raise IntegrationPending('transport_integration_pending')
        if type(self.contract)is OwnerContract and _path(payload_path)!=self.contract.payload_path(grant):raise ClientRefused('exact_reviewed_payload_path_required')
        with self._state()as state:
            with verified_payload(payload_path,payload_sha256,payload_bytes)as fp:
                self._record(state,'install-header.json',raw)
                self._record(state,'install-intent.json',{'version':1,'action':'install','header_sha256':hashlib.sha256(raw).hexdigest(),
                    'payload_sha256':payload_sha256,'payload_bytes':payload_bytes,'unknown_failure_policy':'never_retry_observe_only'})
                try:
                    reply=self.transport.exchange('install',frame_chunks(raw,fp,payload_sha256,payload_bytes),recheck)
                    safe=self.contract.reply('install',parse_reply(reply),grant)
                except Exception:raise TransportUncertain('install_outcome_uncertain_observe_only')from None
            # SourceExit/hash/stat must succeed while the SAME state fd is held.
            self._record(state,'install-receipt.json',safe)
        return safe
    def observe(self,header=None):
        grant=self._guard('observe')  # Before saved state reads or any IO.
        self.contract.ready()
        saved=None
        try:saved,saved_value=self._saved_header()
        except FileNotFoundError:
            if header is None:raise ClientRefused('original_concrete_header_required')from None
        if header is None:header=saved_value
        grant,raw,recheck=self._request('observe',header,None,0,grant=grant)
        if saved is not None and raw!=saved:raise ClientRefused('observe_must_reuse_original_concrete_header')
        if self.transport is None:raise IntegrationPending('transport_integration_pending')
        try:
            reply=self.transport.exchange('observe',frame_chunks(raw),recheck)
            return self.contract.reply('observe',parse_reply(reply),grant)
        except Exception:raise TransportUncertain('observe_unavailable_no_mutation')from None


def main():
    """Production composition stays closed until Owner + Gate integration review."""
    raise IntegrationPending('operator_composition_pending_no_network_authority')


if __name__=='__main__':
    # No argv parsing, private values or traceback in the closed CLI.
    print(json.dumps({'ok':False,'state':'INTEGRATION_PENDING','qualified':False}))
    raise SystemExit(1)
