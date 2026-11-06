#!/usr/bin/env python3
"""Immutable publication identity and fixed-command root executor. Never reads app.env."""
import argparse, datetime, fcntl, grp, hashlib, json, os, pathlib, re, stat, subprocess, sys, tempfile, time

IGNORED = {'node_modules', '.git', 'secrets'}
ROOT_IGNORED = {'.next', '.next-dev', '.pgdata', 'data'}

def fingerprint(root):
    root = pathlib.Path(root)
    if root.is_symlink() or not root.is_dir(): raise ValueError('invalid_tree')
    files = []
    for base, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED and not d.startswith('.env') and not (pathlib.Path(base) == root and d in ROOT_IGNORED))
        for name in dirs:
            if (pathlib.Path(base) / name).is_symlink(): raise ValueError('source_symlink')
        for name in sorted(names):
            if name in {'.npmrc', 'tsconfig.tsbuildinfo'} or name.startswith('.env'): continue
            path = pathlib.Path(base) / name
            if path.is_symlink() or not path.is_file(): raise ValueError('source_not_regular')
            with path.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            files.append([path.relative_to(root).as_posix(), digest, int(bool(path.stat().st_mode & 0o100))])
    files.sort(key=lambda entry: entry[0].encode('utf8'))
    if not any(entry[0] == 'package.json' for entry in files): raise ValueError('missing_package')
    canonical = json.dumps(files, ensure_ascii=False, separators=(',', ':')).encode()
    version = (root / 'VERSAO').read_text().strip() if (root / 'VERSAO').exists() else ''
    return {'format': 1, 'sha256': hashlib.sha256(canonical).hexdigest(), 'files': files, 'commit': version if re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', version) else None}

def atomic(path, value):
    fd, tmp = tempfile.mkstemp(prefix='.publication-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.chmod(tmp, 0o644); os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def source_identity(stage):
    # Root does not read files owned by the deploy user directly.
    if os.geteuid() == 0 and os.environ.get('PUBLICAR_TESTING') != '1':
        result = subprocess.run(['runuser', '-u', 'adunir', '--', '/usr/bin/python3', str(pathlib.Path(__file__).resolve()), '--fingerprint', str(stage)], capture_output=True, timeout=120, check=True)
        return json.loads(result.stdout)
    return fingerprint(stage)

def settings():
    directory = pathlib.Path(os.environ.get('PUBLICAR_ESTADO_DIR', '/var/lib/peticao-publicar'))
    return directory, pathlib.Path(os.environ.get('PUBLICAR_STAGE', '/home/adunir/peticao-stage/site'))

def ensure_lock():
    path = os.environ.get('PUBLICAR_DEPLOY_LOCK', '/run/lock/peticao-deploy.lock')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o644)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or (os.geteuid() == 0 and (info.st_uid != 0 or info.st_mode & 0o022)):
        os.close(fd); raise ValueError('unsafe_lock')
    os.fchmod(fd, 0o640)
    if os.geteuid() == 0 and os.environ.get('PUBLICAR_TESTING') != '1': os.fchown(fd, 0, grp.getgrnam('adunir').gr_gid)
    return os.fdopen(fd, 'a')

def prepare():
    directory, stage = settings()
    directory.mkdir(mode=0o755, parents=True, exist_ok=True)
    directory_info = directory.lstat()
    if not stat.S_ISDIR(directory_info.st_mode) or (os.geteuid() == 0 and (directory_info.st_uid != 0 or directory_info.st_mode & 0o022)): raise ValueError('unsafe_state_directory')
    with ensure_lock() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        identity = source_identity(stage)
        identity['prepared_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        atomic(directory / 'candidato.json', identity)
    print(json.dumps({key: identity[key] for key in ('sha256', 'commit', 'prepared_at')}))

def run():
    directory, stage = settings()
    directory.mkdir(mode=0o755, parents=True, exist_ok=True)
    directory_info = directory.lstat()
    if not stat.S_ISDIR(directory_info.st_mode) or (os.geteuid() == 0 and (directory_info.st_uid != 0 or directory_info.st_mode & 0o022)): raise ValueError('unsafe_state_directory')
    with open(os.environ.get('PUBLICAR_LOCK', '/run/peticao-publicar.lock'), 'a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return
        request = pathlib.Path(os.environ.get('PUBLICAR_PEDIDO', '/var/lib/peticao/publicar.pedido'))
        claimed = directory / ('.pedido-' + os.urandom(12).hex())
        try: os.rename(request, claimed)
        except FileNotFoundError: return
        identifier, sha = '-', None
        def state(status, start=None, code=None):
            atomic(directory / 'publicar.estado', {'estado': status, 'id': identifier, 'inicio': start or stamp(), 'fim': '' if status == 'executando' else stamp(), 'codigo': code, 'candidato': sha})
        try:
            fd = os.open(claimed, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 2048: raise ValueError('invalid_request')
                payload = json.loads(stream.read(2049))
            if not isinstance(payload, dict) or not re.fullmatch(r'[a-f0-9]{16}', payload.get('id', '')): raise ValueError('invalid_id')
            identifier = payload['id']
            age = time.time() - info.st_mtime
            if age > int(os.environ.get('PUBLICAR_MAX_IDADE', '900')) or age < -60:
                state('expirado'); return
            provided = payload.get('candidato')
            if not isinstance(provided, str) or not re.fullmatch(r'[a-f0-9]{64}', provided): raise ValueError('invalid_candidate')
            sha = provided
            manifest = directory / 'candidato.json'
            meta = manifest.lstat()
            if manifest.is_symlink() or not stat.S_ISREG(meta.st_mode) or (os.geteuid() == 0 and (meta.st_uid != 0 or meta.st_mode & 0o022)): raise ValueError('untrusted_manifest')
            candidate = json.loads(manifest.read_text())
            if candidate['sha256'] != sha or source_identity(stage)['sha256'] != sha: raise ValueError('candidate_changed')
            ledger = directory / ('pedido-' + identifier + '.json')
            with ledger.open('x') as stream: json.dump({'id': identifier, 'candidato': sha, 'at': stamp()}, stream)
        except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
            state('recusado'); return
        finally:
            claimed.unlink(missing_ok=True)
        start = stamp(); state('executando', start)
        deploy = os.environ.get('PUBLICAR_DEPLOY', '/usr/local/sbin/peticao-deploy')
        log = directory / 'publicar.log.novo'
        with log.open('wb') as stream:
            try:
                result = subprocess.run([deploy], stdout=stream, stderr=subprocess.STDOUT, env={**os.environ, 'PETICAO_CANDIDATO_SHA256': sha}, timeout=int(os.environ.get('PUBLICAR_TIMEOUT', '1200')))
                code = result.returncode
            except subprocess.TimeoutExpired: code = 124
            except OSError: code = 127
        with log.open('rb') as stream:
            stream.seek(max(0, log.stat().st_size - 6000)); data = stream.read()
        (directory / 'publicar.log').write_bytes(data); (directory / 'publicar.log').chmod(0o644); log.unlink()
        state('ok' if code == 0 else 'falhou', start, code)

def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fingerprint', type=pathlib.Path)
    parser.add_argument('--expect')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--ensure-lock', action='store_true')
    parser.add_argument('--validate-lock-fd', type=int)
    args = parser.parse_args()
    try:
        if args.fingerprint:
            identity = fingerprint(args.fingerprint)
            if args.expect and identity['sha256'] != args.expect: raise ValueError('candidate_changed')
            print(json.dumps(identity, ensure_ascii=False))
        elif args.validate_lock_fd is not None:
            info = os.fstat(args.validate_lock_fd)
            expected = os.stat(os.environ.get('PUBLICAR_DEPLOY_LOCK', '/run/lock/peticao-deploy.lock'), follow_symlinks=False)
            if (info.st_dev, info.st_ino) != (expected.st_dev, expected.st_ino) or not stat.S_ISREG(info.st_mode): raise ValueError('invalid_lock_fd')
            if os.geteuid() == 0 and (info.st_uid != 0 or info.st_mode & 0o022): raise ValueError('unsafe_lock_fd')
            fcntl.flock(args.validate_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        elif args.ensure_lock:
            with ensure_lock(): pass
        elif args.prepare or args.run:
            if os.geteuid() != 0 and os.environ.get('PUBLICAR_TESTING') != '1': raise ValueError('requires_root')
            os.umask(0o022)
            prepare() if args.prepare else run()
        else: parser.error('choose an operation')
    except (OSError, ValueError, subprocess.SubprocessError):
        print('Publication refused: source or request verification failed.', file=sys.stderr); sys.exit(1)
