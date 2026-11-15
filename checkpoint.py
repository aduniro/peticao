"""Verified legacy checkpoint with executable metadata; no activation or promotion."""
import base64
import contextlib
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import socket
import stat
import tarfile
import tempfile
import uuid

MAX_ARCHIVE = 512 * 1024**2
MAX_QUEUE = 32 * 1024**2
TERMINAL = {'completed', 'failed', 'interrupted', 'canceled'}


def protected_material(parts):
    return '.codex' in parts or any(str(part).lower().endswith(('.p12','.pfx','.jks','.keystore')) for part in parts)


def copy_project_tree(source,target,recovery):
    source,target=Path(source),Path(target)
    if source.is_symlink():raise ValueError('linked project tree refused')
    if not source.exists():return
    for path in sorted(source.rglob('*')):
        relative=path.relative_to(source)
        if recovery.private_name(relative.parts) or protected_material(relative.parts):continue
        if path.is_symlink():raise ValueError('linked project object refused')
        if path.is_file():recovery.checked_copy(path,target/relative)
        elif not path.is_dir():raise ValueError('special project object refused')


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def encoded(value):
    if isinstance(value, bytes):
        return {'sqlite_blob_base64': base64.b64encode(value).decode()}
    raise TypeError('unsupported SQLite value')


def database_facts(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_QUEUE:
        raise ValueError('bounded existing regular queue required')
    with contextlib.closing(sqlite3.connect(path.absolute().as_uri() + '?mode=ro', uri=True, timeout=10)) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('queue integrity failure')
        schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
        tables = [x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        if not {'jobs', 'events'} <= set(tables):
            raise ValueError('legacy queue schema required')
        facts = {'schema_sha256': hashlib.sha256(json.dumps(schema, separators=(',', ':')).encode()).hexdigest(), 'tables': {}}
        for name in tables:
            if not re.fullmatch('[a-zA-Z_][a-zA-Z0-9_]*', name):
                raise ValueError('unexpected table identifier')
            columns = [r[1] for r in db.execute('PRAGMA table_info("' + name + '")')]
            count = db.execute('SELECT count(*) FROM "' + name + '"').fetchone()[0]
            if count > 100000:
                raise ValueError('queue row limit exceeded')
            order = ','.join('"' + col.replace('"', '""') + '"' for col in columns)
            rows = db.execute('SELECT * FROM "' + name + '" ORDER BY ' + order).fetchall()
            raw = json.dumps(rows, separators=(',', ':'), ensure_ascii=False, default=encoded).encode()
            facts['tables'][name] = {'rows': count, 'sha256': hashlib.sha256(raw).hexdigest()}
        states = dict(db.execute('SELECT state,count(*) FROM jobs GROUP BY state'))
        facts['jobs_by_state'] = states
        facts['nonterminal_jobs'] = sum(n for state, n in states.items() if state not in TERMINAL)
        return facts


def load_recovery(path, expected_sha):
    path = Path(path)
    if path.is_symlink() or digest(path) != expected_sha:
        raise ValueError('installed recovery module changed')
    spec = importlib.util.spec_from_file_location('legacy_recovery_verified', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def original_path(name, source, worker):
    parts = PurePosixPath(name).parts
    if parts[0] == 'coordinator':
        return Path(source).joinpath(*parts[1:])
    if parts[0] == 'worker':
        return Path(worker).joinpath(*parts[1:])
    return None


def consistent_snapshot(source, worker, output, recovery):
    """Legacy-compatible archive with explicitly closed, DELETE-mode SQLite copy.

    sqlite3.Connection.__exit__ commits but does not close. The legacy exporter
    can therefore include mutable backup -wal/-shm files. This companion closes
    both connections before hashing/archiving and never modifies the live DB.
    """
    source, worker, output = map(Path, (source, worker, output))
    authority = recovery.read_json(source/'authority.json')
    if authority.get('role') != 'primary' or type(authority.get('generation')) is not int or authority['generation'] < 1:
        raise ValueError('valid existing primary authority required')
    output.mkdir(mode=0o700, exist_ok=False)
    stage = output/'inputs';stage.mkdir(mode=0o700)
    coord = stage/'coordinator';coord.mkdir(mode=0o700)
    with contextlib.closing(sqlite3.connect((source/'queue.sqlite').absolute().as_uri()+'?mode=ro',uri=True)) as src:
        with contextlib.closing(sqlite3.connect(coord/'queue.sqlite')) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete':
                raise ValueError('standalone SQLite backup journal mode required')
            if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('checkpoint SQLite integrity failed')
    (coord/'queue.sqlite').chmod(0o600)
    if any(coord.glob('queue.sqlite-*')):
        raise ValueError('backup sidecars must be closed before capture')
    for name in ['authority.json','config.json','version.json']:
        recovery.checked_copy(source/name,coord/name)
    for name in ['sources','bundles']:
        copy_project_tree(source/name,coord/name,recovery)
    jobs=worker/'jobs'
    if jobs.is_symlink():raise ValueError('linked jobs root refused')
    if jobs.exists():
        for job in jobs.iterdir():
            if job.is_symlink() or not job.is_dir() or not re.fullmatch('[a-f0-9]{32}',job.name):
                raise ValueError('unexpected worker job directory')
            for name in ['config.json','state.json','result.json','output.log']:
                if (job/name).exists():recovery.checked_copy(job/name,stage/'worker/jobs'/job.name/name)
            copy_project_tree(job/'artifacts',stage/'worker/jobs'/job.name/'artifacts',recovery)
    if recovery.read_json(source/'authority.json') != authority:
        raise ValueError('authority changed during checkpoint')
    recovery.atomic_json(stage/'snapshot.json',{'format':1,'id':uuid.uuid4().hex,'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_host':socket.gethostname(),'generation':authority['generation'],'worker_files_are_best_effort':True,'sqlite_connections_closed':True})
    files=[p for p in stage.rglob('*') if p.is_file()]
    if len(files)>recovery.MAX_FILES or sum(p.stat().st_size for p in files)>recovery.MAX_BYTES:
        raise ValueError('checkpoint data budget exceeded')
    recovery.atomic_json(stage/'manifest.json',{str(p.relative_to(stage)):{'sha256':digest(p),'size':p.stat().st_size} for p in files})
    archive=output/'checkpoint-base.tar.gz'
    with tarfile.open(archive,'x:gz') as tf:
        for p in sorted(stage.rglob('*')):
            if p.is_file():
                info=tf.gettarinfo(str(p),str(p.relative_to(stage)));info.mode=0o600;info.uid=info.gid=0;info.uname=info.gname=''
                with p.open('rb') as stream:tf.addfile(info,stream)
    archive.chmod(0o600)
    recovery.verify(archive)
    return {'snapshot':str(archive),'sha256':digest(archive),'generation':authority['generation']}


def capture(source, worker, output, recovery):
    """Keep native checkpoint; derive a verified one with original executable bits."""
    source, worker, output = map(Path, (source, worker, output))
    if source.is_symlink() or worker.is_symlink() or not source.is_dir() or not worker.is_dir():
        raise ValueError('existing nonlinked development roots required')
    before = database_facts(source/'queue.sqlite')
    if before['nonterminal_jobs']:
        raise ValueError('queued or active work requires separate drain; no automatic change')
    authority_before = (source/'authority.json').read_bytes()
    output.mkdir(mode=0o700, exist_ok=False)
    native = consistent_snapshot(source, worker, output/'native', recovery)
    native_path = Path(native['snapshot'])
    recovery.verify(native_path)
    final = output/'checkpoint-with-modes.tar.gz'
    with tarfile.open(native_path, 'r:gz') as old:
        manifest = json.load(old.extractfile('manifest.json'))
        for name, record in manifest.items():
            origin = original_path(name, source, worker)
            mode = 0o600
            if origin is not None:
                if origin.is_symlink() or not origin.is_file():
                    raise ValueError('live checkpoint input changed or linked')
                # An online SQLite backup can change file-header bytes while
                # preserving every row/schema; compare its transactional facts.
                if name != 'coordinator/queue.sqlite' and digest(origin) != record['sha256']:
                    raise ValueError('live checkpoint input changed')
                mode = stat.S_IMODE(origin.stat().st_mode)
                if mode & 0o7000:
                    raise ValueError('special permission bits not accepted')
            record['original_mode'] = mode
        with tarfile.open(final, 'x:gz') as new:
            for member in old.getmembers():
                if member.name == 'manifest.json':
                    raw = json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()
                    info = tarfile.TarInfo('manifest.json'); info.size = len(raw); info.mode = 0o600
                    new.addfile(info, io.BytesIO(raw))
                else:
                    new.addfile(member, old.extractfile(member))
    final.chmod(0o600)
    if final.stat().st_size > MAX_ARCHIVE:
        raise ValueError('checkpoint transport budget exceeded; preserve attempt')
    meta = recovery.verify(final)
    with tempfile.TemporaryDirectory(prefix='check-', dir=output) as tmp:
        queue = Path(tmp)/'queue.sqlite'
        with tarfile.open(final, 'r:gz') as archive:
            member = archive.getmember('coordinator/queue.sqlite')
            if member.size > MAX_QUEUE:
                raise ValueError('checkpoint queue limit exceeded')
            with queue.open('xb') as stream:
                stream.write(archive.extractfile(member).read())
            queue.chmod(0o600)
        archived = database_facts(queue)
    after = database_facts(source/'queue.sqlite')
    if before != archived or after != before or (source/'authority.json').read_bytes() != authority_before:
        raise ValueError('source changed during checkpoint; no admission or retry inferred')
    return {'snapshot': str(final), 'sha256': digest(final), 'bytes': final.stat().st_size,
            'native_snapshot_preserved': str(native_path), 'native_sha256': native['sha256'],
            'facts': archived, 'generation': meta['generation'], 'source_host': meta['source_host'],
            'files': meta['files'], 'original_modes_added': len(manifest),
            'source_unchanged': True, 'services_started': False}


def read_manifest(archive, recovery):
    recovery.verify(archive)
    with tarfile.open(archive, 'r:gz') as tf:
        manifest = json.load(tf.extractfile('manifest.json'))
        for name,record in manifest.items():
            if protected_material(PurePosixPath(name).parts):
                raise ValueError('signing/session material excluded from this recovery scope')
            mode = record.get('original_mode')
            if type(mode) is not int or not 0 <= mode <= 0o777:
                raise ValueError('verified original permission metadata required')
    return manifest


def destination(name, target):
    parts = PurePosixPath(name).parts
    if parts[0] == 'coordinator':
        return Path(target).joinpath(*parts[1:])
    if parts[0] == 'worker':
        return Path(target)/'recovered-worker'/Path(*parts[1:])
    return None


def verify_restored(archive, target, expected, recovery):
    manifest = read_manifest(archive, recovery)
    target = Path(target)
    if target.is_symlink() or not target.is_dir():
        raise ValueError('regular restored root required')
    facts = database_facts(target/'queue.sqlite')
    if facts != expected or facts['nonterminal_jobs']:
        raise ValueError('restored queue rows/schema/state differ')
    authority = json.loads((target/'authority.json').read_text())
    with tarfile.open(archive, 'r:gz') as tf:
        original_authority = json.load(tf.extractfile('coordinator/authority.json'))
    required_authority = {**original_authority, 'role': 'standby', 'armed_boot_id': None}
    if authority != required_authority:
        raise ValueError('restored authority must only change to unarmed standby')
    verified = executable = 0
    for name, record in manifest.items():
        path = destination(name, target)
        if path is None or name in {'coordinator/authority.json', 'coordinator/queue.sqlite'}:
            continue
        if path.is_symlink() or not path.is_file() or digest(path) != record['sha256']:
            raise ValueError('restored source/config/artifact differs')
        verified += 1
        if record['original_mode'] & 0o111:
            executable += 1
    return {'role': 'standby', 'generation': authority['generation'], 'unarmed': True,
            'facts': facts, 'regular_files_verified': verified, 'original_executable_files': executable,
            'queue_rows_and_schema_preserved': True, 'services_started': False, 'cutover': False}


def restore(archive, target, expected_sha, expected_facts, recovery, uid, gid):
    archive, target = Path(archive), Path(target)
    if target.exists() or target.is_symlink():
        raise FileExistsError('restore attempt must not overwrite or reuse any target')
    if digest(archive) != expected_sha or expected_facts['nonterminal_jobs']:
        raise ValueError('checkpoint identity or idle state mismatch')
    manifest = read_manifest(archive, recovery)
    result = recovery.restore(archive, target)
    if result['jobs_requiring_reconciliation']:
        raise ValueError('unexpected live work: leave passive and reconcile separately')
    verified = verify_restored(archive, target, expected_facts, recovery)
    modes = {str(destination(name, target)): 0o700 if record['original_mode'] & 0o111 else 0o600
             for name, record in manifest.items() if destination(name, target) is not None}
    # Restore owner-only access. Retain executable bits, never setuid/setgid or
    # historical group/world permissions. Control JSON/SQLite remain private.
    for path in [target, *sorted(target.rglob('*'))]:
        if path.is_symlink():
            raise ValueError('linked restored object refused')
        if path.is_dir():
            mode = 0o700
        elif path.is_file():
            mode = modes.get(str(path), 0o600)
            if path.parent == target and path.suffix in {'.json', '.sqlite'}:
                mode = 0o600
        else:
            raise ValueError('special restored object refused')
        os.chmod(path, mode)
        os.chown(path, uid, gid)
    verified.update(owner_uid=uid, owner_gid=gid, ownership_applied=True,
                    bootstrap_credentials_restored=False, gateway_topology_adapted=False,
                    full_disaster_recovery_proven=False)
    return verified
