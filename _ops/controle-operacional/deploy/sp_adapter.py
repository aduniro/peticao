#!/usr/bin/python3
"""Fixed-target SP publisher. Production disabled; fixtures require explicit injection."""
from __future__ import annotations
import contextlib
import ctypes
import dataclasses
import errno
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import grp
import re
import socket
import sqlite3
import stat
import subprocess
import sys
import tarfile
import time
import uuid

CONFIG_PATH = Path('/etc/ops-deploy-sp/config.json')
APP = Path('/opt/peticao/app')
UNIT = 'peticao.service'
DESTINATION = 'sp-production'
TARGET = 'peticao-sp'
MAX_HEADER = 32768
MAX_MANIFEST = 32 * 1024 * 1024
MAX_ARTIFACT = 1024**3
MAX_UNPACKED = 3 * 1024**3
MAX_MEMBERS = 100000
IDENT = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}')
HASH = re.compile(r'[0-9a-f]{64}')
PRIVATE = {'.ssh', 'secrets', 'authorized_keys', 'sudoers', 'app.env'}
SCOPE = ('request_id', 'job_id', 'release_id', 'manifest_hash', 'runtime_manifest_sha256', 'artifact_sha256', 'artifact_size', 'destination')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def signed(key, value):
    return hmac.new(key, b'sp-grant-v1\n' + canonical(value), hashlib.sha256).hexdigest()


def identity(path):
    if path.is_symlink() or not path.is_dir():
        raise ValueError('real_directory_required')
    value = path.stat()
    return [value.st_dev, value.st_ino]


def exchange(left, right):
    """Single Linux atomic exchange; no rename-away/rename-in gap or fallback."""
    function = getattr(ctypes.CDLL(None, use_errno=True), 'renameat2', None)
    if function is None:
        raise OSError(errno.ENOSYS, 'atomic_exchange_unavailable')
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    if function(-100, os.fsencode(left), -100, os.fsencode(right), 2):
        code = ctypes.get_errno()
        raise OSError(code, 'atomic_exchange_failed')
    for parent in {Path(left).parent, Path(right).parent}:
        descriptor = os.open(parent, os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def root_owned(path):
    path = Path(path)
    if not path.is_absolute():
        raise PermissionError('absolute_root_path_required')
    for item in [path, *path.parents]:
        value = item.lstat()
        if stat.S_ISLNK(value.st_mode) or value.st_uid != 0 or value.st_mode & 0o022:
            raise PermissionError('root_owned_nonwritable_path_required')


@dataclasses.dataclass(frozen=True)
class Config:
    enabled: bool = False
    fixture: bool = False
    app: Path = APP
    state: Path = Path('/var/lib/ops-deploy-sp')
    staging: Path = Path('/opt/peticao/.ops-deploy-sp')
    backups: Path = Path('/var/backups/peticao-deploy')
    grant_key: bytes = b''
    callbacks: dict = dataclasses.field(default_factory=dict)
    migrations: dict = dataclasses.field(default_factory=dict)

    @classmethod
    def load(cls):
        root_owned(CONFIG_PATH)
        if CONFIG_PATH.stat().st_mode & 0o077:
            raise PermissionError('private_root_configuration_required')
        raw = json.loads(CONFIG_PATH.read_text())
        if set(raw) - {'enabled', 'grant_key', 'callbacks', 'migrations'}:
            raise ValueError('configuration_has_unapproved_fields')
        if type(raw.get('enabled', False)) is not bool:
            raise ValueError('invalid_enable_flag')
        raw['grant_key'] = bytes.fromhex(raw.get('grant_key', ''))
        return cls(**raw)


class RootCallbacks:
    """Only root-configured executables, fixed argv, JSON stdin; never shell."""
    def __init__(self, config):
        self.config = config

    def call(self, name, value):
        filename = self.config.callbacks.get(name)
        if not filename:
            raise PermissionError('root_callback_not_installed_' + name)
        root_owned(filename)
        if not stat.S_ISREG(Path(filename).stat().st_mode):
            raise PermissionError('regular_callback_required')
        result = subprocess.run([filename], input=canonical(value), capture_output=True, timeout=600, env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}, check=True)
        if len(result.stdout) > MAX_HEADER:
            raise ValueError('callback_output_limit')
        reply = json.loads(result.stdout)
        if not isinstance(reply, dict):
            raise ValueError('callback_object_required')
        return reply


class Engine:
    def __init__(self, config, callbacks=None, crash_hook=None):
        self.config = config
        self.callbacks = callbacks or RootCallbacks(config)
        self.crash_hook = crash_hook or (lambda phase: None)
        if not config.fixture:
            if config.app != APP or os.geteuid() != 0 or socket.gethostname().split('.')[0] != TARGET:
                raise PermissionError('fixed_sp_root_target_required')
        for path in (config.state, config.staging, config.backups):
            if path.is_symlink():
                raise ValueError('control_directory_symlink_refused')
            path.mkdir(parents=True, mode=0o700, exist_ok=True)
            if not config.fixture:
                root_owned(path)
                path.chmod(0o700)
        self.database = config.state / 'journal.sqlite'
        if self.database.is_symlink():
            raise ValueError('journal_symlink_refused')
        with self.db() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS jobs(request_id TEXT PRIMARY KEY,
              fingerprint TEXT,scope TEXT,state TEXT,phase TEXT,detail TEXT,
              old_identity TEXT,new_identity TEXT,created_at INTEGER,updated_at INTEGER);
            CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,
              request_id TEXT,at INTEGER,state TEXT,phase TEXT,detail TEXT);
            CREATE TABLE IF NOT EXISTS job_bindings(job_id TEXT PRIMARY KEY,request_id TEXT UNIQUE);
            ''')
        self.database.chmod(0o600)

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def record(self, request_id, state, phase, detail=None):
        value = canonical(detail or {}).decode()
        with self.db() as db:
            now = int(time.time())
            db.execute('UPDATE jobs SET state=?,phase=?,detail=?,updated_at=? WHERE request_id=?', (state, phase, value, now, request_id))
            db.execute('INSERT INTO events(request_id,at,state,phase,detail) VALUES(?,?,?,?,?)', (request_id, now, state, phase, value))
        self.crash_hook(phase)

    def row(self, request_id):
        with self.db() as db:
            value = db.execute('SELECT * FROM jobs WHERE request_id=?', (request_id,)).fetchone()
            return dict(value) if value else None

    def public(self, request_id):
        row = self.row(request_id)
        if not row:
            return {'request_id':request_id,'state':'not_found'}
        observation = {}
        if row['old_identity'] and row['new_identity']:
            previous, candidate = json.loads(row['old_identity']), json.loads(row['new_identity'])
            for name,path in (('app',self.config.app),('staging',self.config.staging/request_id/'runtime')):
                try:
                    observed = identity(path)
                    observation[name] = 'previous' if observed==previous else 'candidate' if observed==candidate else 'unknown'
                except (OSError,ValueError):
                    observation[name] = 'unknown'
        return {'request_id': request_id, 'state':row['state'], 'phase':row['phase'], 'detail':json.loads(row['detail']), 'directory_observation':observation, 'updated_at':row['updated_at'], 'target':TARGET, 'production_enabled':self.config.enabled and not self.config.fixture, 'fixture':self.config.fixture}

    def validate(self, header, allow_expired=False):
        if not isinstance(header, dict) or set(header) != {*SCOPE, 'action', 'grant', 'lease'}:
            raise ValueError('fixed_header_fields_required')
        if header['action'] not in {'preflight','upload','prepared','publish','status','rollback'}:
            raise ValueError('unsupported_action')
        for name in ('request_id','job_id','release_id'):
            if not isinstance(header[name], str) or not IDENT.fullmatch(header[name]):
                raise ValueError('invalid_identifier')
        if header['destination'] != DESTINATION:
            raise PermissionError('fixed_destination_required')
        if any(not isinstance(header[name], str) or not HASH.fullmatch(header[name]) for name in ('manifest_hash','runtime_manifest_sha256','artifact_sha256')):
            raise ValueError('invalid_pinned_hash')
        if type(header['artifact_size']) is not int or not 0 < header['artifact_size'] <= MAX_ARTIFACT:
            raise ValueError('artifact_size_limit')
        if len(self.config.grant_key) < 32:
            raise PermissionError('owner_grant_key_unconfigured')
        grant = header['grant']
        if not isinstance(grant, dict) or set(grant) != {'claims','signature'} or not isinstance(grant['claims'], dict):
            raise PermissionError('owner_grant_required')
        claims = grant['claims']
        required = {*SCOPE,'owner','owner_nonce','operation','issued_at','expires_at','migration_id','migration_ack_sha256'}
        if set(claims) != required or any(claims[k] != header[k] for k in SCOPE):
            raise PermissionError('owner_grant_scope_mismatch')
        if claims['owner'] != 'operator-1608598f41@example.invalid' or not isinstance(claims['owner_nonce'], str) or not IDENT.fullmatch(claims['owner_nonce']):
            raise PermissionError('owner_identity_required')
        if not isinstance(grant['signature'], str) or not hmac.compare_digest(signed(self.config.grant_key, claims), grant['signature']):
            raise PermissionError('invalid_owner_grant_signature')
        now = int(time.time())
        if type(claims['issued_at']) is not int or type(claims['expires_at']) is not int or claims['issued_at'] > now+30 or claims['expires_at'] <= claims['issued_at'] or claims['expires_at']-claims['issued_at'] > 3600 or (not allow_expired and claims['expires_at'] < now):
            raise PermissionError('owner_grant_expired')
        expected = 'rollback' if header['action'] == 'rollback' else 'deploy'
        if header['action'] != 'status' and claims['operation'] != expected:
            raise PermissionError('owner_grant_operation_mismatch')
        if claims['migration_id'] is not None and (claims['migration_id'] not in self.config.migrations or not isinstance(claims['migration_ack_sha256'], str) or not HASH.fullmatch(claims['migration_ack_sha256'])):
            raise PermissionError('migration_not_preapproved')
        return {**{k:header[k] for k in SCOPE},'migration_id':claims['migration_id'],'migration_ack_sha256':claims['migration_ack_sha256']}

    def lease(self, header):
        proof = self.callbacks.call('lease', {'scope':self.validate(header),'proof':header['lease']})
        if proof.get('valid') is not True or proof.get('job_id') != header['job_id'] or type(proof.get('generation')) is not int or type(proof.get('expires_at')) is not int or proof['expires_at'] <= int(time.time()):
            raise PermissionError('live_lease_fence_not_validated')
        return proof

    def base(self, scope):
        return self.config.staging / scope['request_id']

    def callback(self, name, scope, **extra):
        return self.callbacks.call(name, {'scope':scope,'target':TARGET,'unit':UNIT,'app':str(self.config.app),**extra})

    def invoke(self, header, stream=None):
        scope = self.validate(header, allow_expired=header.get('action') == 'status')
        request_id, action = scope['request_id'], header['action']
        fingerprint = hashlib.sha256(canonical(scope)).hexdigest()
        with (self.config.state / 'publisher.lock').open('a') as lock:
            os.chmod(lock.name, 0o600)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                if action == 'status':
                    existing = self.row(request_id)
                    if existing and existing['fingerprint'] != fingerprint:
                        raise ValueError('request_id_fingerprint_conflict')
                    return {**self.public(request_id),'operation_in_progress':True}
                raise BlockingIOError('publisher_busy') from None
            row = self.row(request_id)
            if row and row['fingerprint'] != fingerprint:
                raise ValueError('request_id_fingerprint_conflict')
            if row and row['state'] == 'active':
                self.record(request_id,'uncertain',row['phase'],{'error_code':'interrupted_operation_requires_reconciliation'})
                row = self.row(request_id)
            if action == 'status':
                return self.public(request_id)
            if not self.config.fixture and not self.config.enabled:
                raise PermissionError('production_disabled')
            self.lease(header)
            if not row:
                if action != 'preflight':
                    raise ValueError('preflight_required')
                with self.db() as db:
                    now = int(time.time())
                    db.execute('INSERT INTO job_bindings VALUES(?,?)',(scope['job_id'],request_id))
                    db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)',(request_id,fingerprint,canonical(scope).decode(),'new','new','{}',None,None,now,now))
                row = self.row(request_id)
            if row['state'] in {'uncertain','failed'}:
                if action != 'rollback':
                    return self.public(request_id)
            if action == 'rollback' and row['state'] == 'rolled_back':
                return self.public(request_id)
            if row['state'] == 'completed' and action != 'rollback':
                return self.public(request_id)
            with self.db() as db:
                other = db.execute("SELECT 1 FROM jobs WHERE request_id<>? AND state IN ('active','uncertain')",(request_id,)).fetchone()
                if other:
                    raise PermissionError('other_operation_requires_reconciliation')
            if action == 'preflight':
                if row['state'] != 'new':
                    return self.public(request_id)
                try:
                    return self.preflight(scope)
                except Exception:
                    self.record(request_id,'failed','preflight_failed',{'error_code':'preflight_not_qualified'})
                    raise
            if action == 'upload':
                return self.upload(scope,stream)
            if action == 'prepared':
                return self.prepare(scope,header)
            if action == 'publish':
                return self.publish(scope,header)
            return self.rollback(scope,header)

    def preflight(self, scope):
        app = self.config.app
        old = identity(app)
        base = self.base(scope)
        base.mkdir(mode=0o700)
        if base.stat().st_dev != app.stat().st_dev:
            raise ValueError('atomic_cutover_requires_same_filesystem')
        # Prove renameat2 support without touching the application.
        left, right = base / 'exchange-a', base / 'exchange-b'
        left.mkdir(); right.mkdir()
        try:
            exchange(left,right)
            exchange(left,right)
        finally:
            left.rmdir(); right.rmdir()
        result = self.callback('preflight',scope)
        if result.get('ready') is not True or result.get('protected_config_external') is not True or result.get('service_user') != 'peticao' or result.get('service_group') != 'peticao' or result.get('runtime_format') != 'next-start-v1' or result.get('environment_file') != '/etc/peticao/app.env':
            raise ValueError('fixed_runtime_preflight_not_qualified')
        if any(app.glob('.env*')):
            raise ValueError('in_app_environment_requires_separate_preservation_plan')
        with self.db() as db:
            db.execute('UPDATE jobs SET old_identity=? WHERE request_id=?',(json.dumps(old),scope['request_id']))
        self.record(scope['request_id'],'preflighted','preflighted',{'runtime_format':'next-start-v1','environment_file_preserved':True})
        return self.public(scope['request_id'])

    def upload(self, scope, stream):
        ref = scope['request_id']
        if self.row(ref)['state'] != 'preflighted':
            return self.public(ref)
        if stream is None:
            raise ValueError('binary_stream_required')
        self.record(ref,'active','upload_intent')
        temporary = self.base(scope) / 'artifact.part'
        try:
            digest, remaining = hashlib.sha256(), scope['artifact_size']
            with temporary.open('xb') as dest:
                os.chmod(temporary,0o600)
                while remaining:
                    chunk = stream.read(min(1024*1024,remaining))
                    if not chunk:
                        raise ValueError('artifact_truncated')
                    dest.write(chunk); digest.update(chunk); remaining -= len(chunk)
                if stream.read(1):
                    raise ValueError('artifact_extra_bytes')
                dest.flush(); os.fsync(dest.fileno())
            if digest.hexdigest() != scope['artifact_sha256']:
                raise ValueError('artifact_hash_mismatch')
            temporary.rename(self.base(scope) / 'artifact.tar')
            self.record(ref,'uploaded','uploaded',{'artifact_sha256':scope['artifact_sha256']})
        except Exception:
            self.record(ref,'failed','upload_failed',{'error_code':'artifact_verification_failed'})
            raise
        return self.public(ref)

    def prepare(self, scope, header):
        ref = scope['request_id']
        if self.row(ref)['state'] != 'uploaded':
            return self.public(ref)
        self.record(ref,'active','prepare_intent')
        base, runtime = self.base(scope), self.base(scope) / 'runtime'
        try:
            artifact = base / 'artifact.tar'
            if artifact.is_symlink() or artifact.stat().st_size != scope['artifact_size'] or sha(artifact) != scope['artifact_sha256']:
                raise ValueError('artifact_changed')
            with tarfile.open(artifact,'r:*') as tar:
                members,total = [],0
                for member in tar:
                    total += member.size
                    if len(members)>=MAX_MEMBERS or total>MAX_UNPACKED:
                        raise ValueError('unpacked_artifact_limit')
                    members.append(member)
                names = set()
                for member in members:
                    name = member.name
                    parts = PurePosixPath(name).parts
                    if not name or '\\' in name or name.startswith('/') or any(p in {'','..','.'} for p in name.split('/')) or name in names or not member.isfile() or member.mode & 0o7000:
                        raise ValueError('unsafe_tar_member')
                    if name != 'release-manifest.json' and (len(parts)<2 or parts[0]!='runtime'):
                        raise ValueError('unapproved_tar_namespace')
                    if any(p in PRIVATE or p.startswith('.env') or p.endswith(('.key','.pem','.pfx','.p12')) or p.startswith(('id_rsa','id_ed25519')) for p in parts):
                        raise ValueError('private_artifact_member')
                    names.add(name)
                raw = tar.extractfile('release-manifest.json').read(MAX_MANIFEST+1)
                if len(raw)>MAX_MANIFEST or hashlib.sha256(raw).hexdigest()!=scope['runtime_manifest_sha256']:
                    raise ValueError('pinned_manifest_mismatch')
                manifest = json.loads(raw)
                self.validate_manifest(manifest,scope,header)
                files = manifest['files']
                if names != {'release-manifest.json'} | {'runtime/'+name for name in files}:
                    raise ValueError('runtime_file_inventory_mismatch')
                runtime.mkdir(mode=0o750)
                for name, expected in files.items():
                    member = tar.getmember('runtime/'+name)
                    if not isinstance(expected,dict) or set(expected)!={'sha256','bytes'} or type(expected['bytes']) is not int or expected['bytes']!=member.size or not isinstance(expected['sha256'],str) or not HASH.fullmatch(expected['sha256']):
                        raise ValueError('invalid_runtime_inventory')
                    destination = runtime / name
                    destination.parent.mkdir(parents=True,mode=0o750,exist_ok=True)
                    digest = hashlib.sha256()
                    with tar.extractfile(member) as source, destination.open('xb') as dest:
                        os.chmod(destination,0o640)
                        for chunk in iter(lambda:source.read(1024*1024),b''):
                            digest.update(chunk);dest.write(chunk)
                        dest.flush();os.fsync(dest.fileno())
                    if digest.hexdigest()!=expected['sha256']:
                        raise ValueError('runtime_file_hash_mismatch')
            qualified = self.callback('qualify',scope,runtime=str(runtime),manifest=manifest)
            required = ('runtime_complete','tests_passed','schema_compatible','rollback_compatible','catalog_sealed')
            if not all(qualified.get(k) is True for k in required) or qualified.get('manifest_hash')!=scope['manifest_hash'] or qualified.get('runtime_manifest_sha256')!=scope['runtime_manifest_sha256'] or qualified.get('source_commit')!=manifest['source_commit'] or qualified.get('runtime_format')!='next-start-v1':
                raise ValueError('external_runtime_qualification_required')
            if not self.config.fixture:
                uid,gid = pwd.getpwnam('peticao').pw_uid,grp.getgrnam('peticao').gr_gid
                for path in [runtime,*runtime.rglob('*')]:
                    os.chown(path,uid,gid)
                    os.chmod(path,0o750 if path.is_dir() else 0o640)
            with self.db() as db:
                db.execute('UPDATE jobs SET new_identity=? WHERE request_id=?',(json.dumps(identity(runtime)),ref))
            self.record(ref,'prepared','prepared',{'runtime_format':'next-start-v1','qualified_manifest_hash':scope['manifest_hash']})
        except Exception:
            self.record(ref,'failed','prepare_failed',{'error_code':'runtime_not_qualified'})
            raise
        return self.public(ref)

    def validate_manifest(self, manifest, scope, header):
        fields = {'schema_version','release_id','source_commit','runtime_format','entrypoint','files','migration_id','migration_ack_sha256'}
        if not isinstance(manifest,dict) or set(manifest)!=fields or type(manifest['schema_version']) is not int or manifest['schema_version']!=1 or manifest['release_id']!=scope['release_id']:
            raise ValueError('invalid_runtime_manifest')
        if manifest['runtime_format']!='next-start-v1' or manifest['entrypoint']!='node_modules/next/dist/bin/next':
            raise ValueError('standalone_or_other_runtime_not_qualified')
        if not isinstance(manifest['source_commit'],str) or not re.fullmatch(r'[0-9a-f]{40,64}',manifest['source_commit']):
            raise ValueError('source_commit_required')
        files = manifest['files']
        required = {'package.json','node_modules/next/dist/bin/next','node_modules/next/package.json','.next/BUILD_ID'}
        if not isinstance(files,dict) or not required.issubset(files) or not any(p.startswith('.next/server/') for p in files) or not any(p.startswith('.next/static/') for p in files):
            raise ValueError('complete_next_runtime_required')
        if any(manifest[k]!=header['grant']['claims'][k] for k in ('migration_id','migration_ack_sha256')):
            raise PermissionError('migration_owner_ack_mismatch')

    def step(self, scope, journal_phase, name, **extra):
        self.record(scope['request_id'],'active',journal_phase+'_intent')
        result = self.callback(name,scope,**extra)
        safe = {key:result[key] for key in ('healthy','verified','consistent','completed') if type(result.get(key)) is bool}
        if result.get('state') in {'active','inactive'}:safe['service_state']=result['state']
        self.record(scope['request_id'],'active',journal_phase,{'callback_returned':True,**safe})
        return result

    def verified_backup(self, result, path, consistent=False):
        if result.get('verified') is not True or (consistent and result.get('consistent') is not True) or path.is_symlink() or not path.is_file() or not path.stat().st_size or sha(path)!=result.get('sha256'):
            raise ValueError('verified_backup_required')
        path.chmod(0o600)
        descriptor=os.open(path,os.O_RDONLY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
        for parent in (path.parent,path.parent.parent):
            descriptor=os.open(parent,os.O_DIRECTORY)
            try:os.fsync(descriptor)
            finally:os.close(descriptor)

    def verify_prepared(self,scope,header):
        base=self.base(scope)
        artifact=base/'artifact.tar'
        if artifact.is_symlink() or artifact.stat().st_size!=scope['artifact_size'] or sha(artifact)!=scope['artifact_sha256']:
            raise ValueError('sealed_artifact_changed')
        with tarfile.open(artifact,'r:*') as tar:
            raw=tar.extractfile('release-manifest.json').read(MAX_MANIFEST+1)
        if len(raw)>MAX_MANIFEST or hashlib.sha256(raw).hexdigest()!=scope['runtime_manifest_sha256']:
            raise ValueError('sealed_runtime_manifest_changed')
        manifest=json.loads(raw)
        self.validate_manifest(manifest,scope,header)
        runtime=base/'runtime'
        observed=set()
        for path in runtime.rglob('*'):
            if path.is_symlink():raise ValueError('runtime_link_changed')
            if path.is_dir():continue
            if not path.is_file():raise ValueError('runtime_special_file_changed')
            name=str(path.relative_to(runtime))
            expected=manifest['files'].get(name)
            if not expected or path.stat().st_size!=expected['bytes'] or sha(path)!=expected['sha256']:
                raise ValueError('prepared_runtime_changed')
            observed.add(name)
        if observed!=set(manifest['files']):raise ValueError('prepared_runtime_incomplete')

    def service(self, scope, operation):
        result = self.step(scope,operation,'service',operation=operation)
        expected = 'inactive' if operation=='stop' else 'active'
        if result.get('state')!=expected:
            raise ValueError('service_state_not_confirmed')

    def publish(self, scope, header):
        ref = scope['request_id']
        if self.row(ref)['state'] != 'prepared':
            return self.public(ref)
        try:
            self.verify_prepared(scope,header)
            backup = self.config.backups / ref
            backup.mkdir(mode=0o700)
            app = self.step(scope,'application_backup','backup_app',output=str(backup / 'app.tar'))
            self.verified_backup(app,backup / 'app.tar')
            pg = self.step(scope,'postgres_backup','backup_pg',output=str(backup / 'postgres.dump'))
            self.verified_backup(pg,backup / 'postgres.dump',consistent=True)
            self.lease(header)
            self.service(scope,'stop')
            migration = header['grant']['claims']['migration_id']
            if migration is not None:
                # The callback executable is selected by a root allowlist, never tar.
                reply = self.step(scope,'migration','migration',migration_id=migration,adapter=self.config.migrations[migration],ack_sha256=header['grant']['claims']['migration_ack_sha256'])
                if reply.get('completed') is not True:
                    raise ValueError('migration_not_confirmed')
            self.lease(header)
            self.verify_prepared(scope,header)
            row = self.row(ref)
            runtime = self.base(scope) / 'runtime'
            if identity(self.config.app)!=json.loads(row['old_identity']) or identity(runtime)!=json.loads(row['new_identity']):
                raise ValueError('cutover_directory_identity_changed')
            self.record(ref,'active','exchange_intent')
            exchange(self.config.app,runtime)
            self.crash_hook('exchange_performed')
            self.record(ref,'active','exchanged')
            self.lease(header)
            self.service(scope,'start')
            health = self.step(scope,'smoke','health',phase='publish')
            if health.get('healthy') is not True:
                self._rollback(scope,header,'smoke_failed_rolled_back')
            else:
                self.record(ref,'completed','completed',{'artifact_sha256':scope['artifact_sha256'],'database_restored':False})
        except Exception:
            if self.row(ref)['state'] not in {'completed','rolled_back'}:
                self.record(ref,'uncertain',self.row(ref)['phase'],{'error_code':'publish_interrupted_requires_reconciliation','database_restored':False})
            raise
        return self.public(ref)

    def rollback(self, scope, header):
        return self._rollback(scope,header,'operator_rollback')

    def _rollback(self, scope, header, reason):
        ref = scope['request_id']
        row = self.row(ref)
        runtime = self.base(scope) / 'runtime'
        if not row['old_identity'] or not row['new_identity']:
            raise ValueError('rollback_requires_verified_exchanged_directories')
        app_id,slot_id = identity(self.config.app),identity(runtime)
        old,new = json.loads(row['old_identity']),json.loads(row['new_identity'])
        exchanged = app_id==new and slot_id==old
        previous_already_installed = app_id==old and slot_id==new
        if not exchanged and not previous_already_installed:
            raise ValueError('rollback_requires_verified_directory_identities')
        try:
            self.lease(header)
            self.service(scope,'stop')
            if exchanged:
                self.lease(header)
                self.record(ref,'active','rollback_exchange_intent')
                exchange(self.config.app,runtime)
                self.record(ref,'active','rollback_exchanged')
            self.lease(header)
            self.service(scope,'start')
            health = self.step(scope,'rollback_smoke','health',phase='rollback')
            if health.get('healthy') is not True:
                raise ValueError('rollback_health_not_confirmed')
            self.record(ref,'rolled_back','rolled_back',{'reason':reason,'database_restored':False})
        except Exception:
            self.record(ref,'uncertain',self.row(ref)['phase'],{'error_code':'rollback_requires_reconciliation','database_restored':False})
            raise
        return self.public(ref)


def main():
    os.umask(0o077)
    line = sys.stdin.buffer.readline(MAX_HEADER+1)
    if len(line)>MAX_HEADER or not line.endswith(b'\n'):
        raise ValueError('bounded_json_header_line_required')
    header = json.loads(line)
    config = Config.load()
    engine = Engine(config)
    result = engine.invoke(header,sys.stdin.buffer if header.get('action')=='upload' else None)
    print(json.dumps(result))


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'state':'error','error_code':type(error).__name__,'trace_id':uuid.uuid4().hex}))
        raise SystemExit(1)
