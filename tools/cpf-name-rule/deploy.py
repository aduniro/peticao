#!/usr/bin/env python3
"""Deploy only the tested name-rule patch. No signer updates or secret changes."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import urllib.error


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(tree):
    result = {}
    ignored = {'node_modules', '.next', '.next-dev', '.git', '.pgdata', 'data', 'secrets', 'geo-data'}
    for base, dirs, files in os.walk(tree):
        dirs[:] = [d for d in dirs if d not in ignored]
        for name in files:
            if name.startswith('.env') or name in {'.npmrc', 'tsconfig.tsbuildinfo', 'VERSAO', 'MUDANCAS'}:
                continue
            path = Path(base) / name
            if path.is_symlink():
                raise RuntimeError('Unexpected source symlink')
            if path.is_file():
                result[str(path.relative_to(tree))] = digest(path)
    return result


def healthy():
    result = {}
    for path, expected in (('/', 200), ('/api/contador', 200), ('/privacidade', 200), ('/confirmar', 200), ('/confirmar/whatsapp', 404)):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3000' + path, timeout=30) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        if status != expected:
            raise RuntimeError('HTTP verification failed')
        result[path] = status
    return result


def main(root, prepare_only=False):
    os.umask(0o077)
    if os.geteuid() != 0 or root.parent != Path('/root/peticao-recovery/name-rule-deploys'):
        raise RuntimeError('Unexpected deployment path')
    lock = Path('/run/lock/peticao-name-rule-deploy.lock').open('a')
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    state = {}

    def phase(name, **extra):
        state.update(phase=name, at=datetime.datetime.now(datetime.timezone.utc).isoformat(), **extra)
        (root / 'status.json').write_text(json.dumps(state, indent=2))
        print(name, flush=True)

    app = Path('/opt/peticao/app')
    stage = Path('/home/adunir/peticao-stage/site')
    backup = root / 'backup'
    patched = False
    deploy_started = False
    try:
        phase('preflight')
        bundle = root / 'candidate.tar.gz'
        expected = json.loads((root / 'package-checksum.json').read_text())['sha256']
        if digest(bundle) != expected:
            raise RuntimeError('Package checksum mismatch')
        package = root / 'package'
        package.mkdir(mode=0o700, exist_ok=True)
        with tarfile.open(bundle) as archive:
            archive.extractall(package, filter='data')
        manifest = json.loads((package / 'patch-manifest.json').read_text())
        before = inventory(app)
        if before != inventory(stage):
            raise RuntimeError('Stage differs from production; unrelated changes refused')
        for entry in manifest:
            rel = Path(entry['file'])
            if rel.is_absolute() or '..' in rel.parts or not str(rel).startswith('src/'):
                raise RuntimeError('Unexpected patch path')
            if before.get(str(rel)) != entry['before_sha256']:
                raise RuntimeError('Production changed since tests')
            if digest(package / 'site' / rel) != entry['after_sha256']:
                raise RuntimeError('Patch member checksum mismatch')

        phase('backup')
        backup.mkdir(mode=0o700, exist_ok=True)
        if not (root / 'backup-manifest.json').is_file():
            with (backup / 'producao.dump').open('xb') as stream:
                result = subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc', '-Z', '3', 'peticao'], stdout=stream, stderr=subprocess.PIPE)
            if result.returncode:
                raise RuntimeError('Database backup failed')
            for tree, name in ((app, 'app'), (stage, 'stage')):
                subprocess.run(['cp', '-a', str(tree), str(backup / name)], check=True, capture_output=True)
        result = subprocess.run(['pg_restore', '--list', str(backup / 'producao.dump')], capture_output=True)
        if result.returncode:
            raise RuntimeError('Database backup verification failed')
        (backup / 'producao.dump.inventory').write_bytes(result.stdout)
        if inventory(backup / 'app') != before or inventory(backup / 'stage') != before:
            raise RuntimeError('Backup source verification failed')
        env_digest = digest(Path('/etc/peticao/app.env'))
        (root / 'backup-manifest.json').write_text(json.dumps({
            'backup': str(backup), 'database_sha256': digest(backup / 'producao.dump'),
            'package_sha256': expected, 'no_secret_export': True,
        }, indent=2))

        if prepare_only:
            phase('backup_ready', published=False)
            return

        phase('stage_patch')
        patched = True
        for entry in manifest:
            target = stage / entry['file']
            shutil.copyfile(package / 'site' / entry['file'], target)
            shutil.chown(target, user='adunir', group='adunir')
            target.chmod(0o644)

        phase('build_and_deploy')
        deploy_started = True
        with (root / 'deploy.log').open('w') as log:
            result = subprocess.run(['/usr/local/sbin/peticao-deploy'], stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError('Build or deployment failed')

        phase('verification')
        after = inventory(app)
        expected_files = dict(before)
        for entry in manifest:
            expected_files[entry['file']] = entry['after_sha256']
        if after != expected_files or inventory(stage) != expected_files:
            raise RuntimeError('Unexpected deployed code change')
        public_paths = set(before) | set(after)
        public_files = [name for name in public_paths if Path(name).suffix in {'.tsx', '.css'} or name.startswith(('src/i18n/', 'src/content/')) or name == 'README.md']
        patched_files = {entry['file'] for entry in manifest}
        changed_public = sorted(name for name in public_files if before.get(name) != after.get(name))
        if any(name not in patched_files for name in changed_public):
            raise RuntimeError('Unlisted public text or interface changed')
        if digest(Path('/etc/peticao/app.env')) != env_digest:
            raise RuntimeError('Configuration changed during deployment')
        http = healthy()
        try:
            with urllib.request.urlopen('https://sancionaintegral.org/api/contador', timeout=30) as response:
                if response.status != 200:
                    raise RuntimeError('Public counter failed')
                http['public_counter'] = response.status
        except urllib.error.HTTPError as error:
            if error.code != 403:
                raise
            # Cloudflare may reject a request originating at the same VPS. Verify the public URL from the deploy operator's host.
            http['public_counter_from_vps'] = 'blocked_by_edge_403'
        phase('complete', http=http, external_public_check_required='public_counter_from_vps' in http, public_files_changed=changed_public,
              schema_unchanged=before['src/lib/db.ts'] == after['src/lib/db.ts'],
              configuration_unchanged=True, signer_bulk_updates=False)
    except Exception as error:
        if patched:
            phase('rolling_back', error_type=type(error).__name__, reason=str(error))
            # Restore code only. Restoring the database would erase legitimate new signatures.
            if deploy_started:
                restore = Path('/opt/peticao/app.name-rule-restore')
                if restore.exists():
                    raise RuntimeError('Rollback path occupied; manual recovery required') from error
                subprocess.run(['cp', '-a', str(backup / 'app'), str(restore)], check=True, capture_output=True)
                if app.exists():
                    app.rename(root / 'failed-app')
                restore.rename(app)
                subprocess.run(['systemctl', 'restart', 'peticao'], check=True, capture_output=True)
                for _ in range(30):
                    try:
                        healthy()
                        break
                    except Exception:
                        time.sleep(1)
                else:
                    raise RuntimeError('Rollback health check failed') from error
            for entry in manifest:
                target = stage / entry['file']
                old = backup / 'stage' / entry['file']
                if old.is_file():
                    subprocess.run(['cp', '-a', str(old), str(target)], check=True, capture_output=True)
                elif target.is_file() and digest(target) == entry['after_sha256']:
                    target.unlink()
            phase('rolled_back', reason=str(error), database_restored=False)
        else:
            phase('failed_before_deploy', error_type=type(error).__name__, reason=str(error))
        raise


if __name__ == '__main__':
    try:
        main(Path(sys.argv[1]), '--prepare-only' in sys.argv[2:])
    except Exception:
        print('DEPLOY_FAILED; inspect private status.json', flush=True)
        sys.exit(1)
