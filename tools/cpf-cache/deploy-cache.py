#!/usr/bin/env python3
"""Apply the reviewed cache-only package; secrets remain inside the VPS."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import shutil
import subprocess
import sys
import tarfile
import urllib.request


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def settings(path):
    result = {}
    for line in path.read_text().splitlines():
        name, sep, raw = line.strip().partition('=')
        if sep and name in {'HASH_PEPPER', 'CPF_CACHE_ENCRYPTION_KEY', 'CRON_SECRET'}:
            if name in result:
                raise RuntimeError('Duplicate protected setting')
            values = shlex.split(raw, comments=True)
            if len(values) != 1:
                raise RuntimeError('Unsupported protected setting')
            result[name] = values[0]
    return result


def psql(sql):
    p = subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-qAt',
                        '-d', 'peticao', '-v', 'ON_ERROR_STOP=1'], input=sql,
                       text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError('Database command failed; private details omitted')
    return p.stdout.strip()


def main(root):
    os.umask(0o077)
    if os.geteuid() != 0 or root.parent != Path('/root/peticao-recovery/cache-deploys'):
        raise RuntimeError('Unexpected deployment context')
    status = {}
    def phase(name, **values):
        status.update(phase=name, at=datetime.datetime.now(datetime.timezone.utc).isoformat(), **values)
        (root/'status.json').write_text(json.dumps(status, indent=2))
        print(name, flush=True)
    phase('preflight')
    bundle = root/'cpf-cache-candidato.tar.gz'
    if sha(bundle) != 'eb1308e9f238f320003b2ddd65dc7860eb342369855e3f61a9e1f09649383a22':
        raise RuntimeError('Package checksum mismatch')
    extracted = root/'package'
    extracted.mkdir(mode=0o700)
    with tarfile.open(bundle) as archive:
        archive.extractall(extracted, filter='data')
    manifest = json.loads((extracted/'patch-manifest.json').read_text())
    app, stage = Path('/opt/peticao/app'), Path('/home/adunir/peticao-stage/site')
    for entry in manifest:
        rel = Path(entry['file']).relative_to('site')
        if sha(extracted/entry['file']) != entry['after_sha256']:
            raise RuntimeError('Package member mismatch')
        for tree in (app, stage):
            target = tree/rel
            actual = sha(target) if target.is_file() else None
            if target.is_symlink() or actual != entry['before_sha256']:
                raise RuntimeError('Production or stage changed since review')
    # Every existing code/asset file in stage must still match production.
    ignore = {'node_modules', '.next', '.next-dev', '.pgdata', '.git', 'data', 'secrets', 'geo-data'}
    def inventory(tree):
        out = {}
        for base, dirs, files in os.walk(tree):
            dirs[:] = [d for d in dirs if d not in ignore]
            for name in files:
                if name.startswith('.env') or name in {'.npmrc', 'tsconfig.tsbuildinfo', 'VERSAO', 'MUDANCAS'}:
                    continue
                path = Path(base)/name
                if path.is_file():
                    out[str(path.relative_to(tree))] = sha(path)
        return out
    if inventory(stage) != inventory(app):
        raise RuntimeError('Stage contains unrelated changes; no deployment performed')
    phase('backup')
    backup = root/'backup'
    backup.mkdir(mode=0o700)
    with (backup/'producao.dump').open('xb') as dump:
        p = subprocess.run(['runuser','-u','postgres','--','pg_dump','-Fc','-Z','3','peticao'], stdout=dump, stderr=subprocess.PIPE)
    if p.returncode:
        raise RuntimeError('Database backup failed')
    p = subprocess.run(['pg_restore','--list',str(backup/'producao.dump')],capture_output=True)
    if p.returncode:
        raise RuntimeError('Database backup inventory failed')
    (backup/'producao.dump.inventory').write_bytes(p.stdout)
    shutil.copytree(app, backup/'app', symlinks=True)
    shutil.copytree(stage, backup/'stage', symlinks=True)
    envfile = Path('/etc/peticao/app.env')
    if envfile.is_symlink():
        raise RuntimeError('Configuration symlink refused')
    shutil.copyfile(envfile, backup/'app.env.before')
    (backup/'app.env.before').chmod(0o600)
    original = settings(envfile)
    if not original.get('HASH_PEPPER'):
        raise RuntimeError('Production pepper missing')
    phase('cache_key')
    if not original.get('CPF_CACHE_ENCRYPTION_KEY'):
        temp = envfile.with_name('app.env.cpf-cache.tmp')
        with temp.open('x') as output:
            output.write(envfile.read_text().rstrip('\n') + '\nCPF_CACHE_ENCRYPTION_KEY=' + shlex.quote(secrets.token_hex(32)) + '\n')
        shutil.chown(temp, user='root', group='peticao')
        temp.chmod(0o640)
        os.replace(temp, envfile)
    current = settings(envfile)
    if current.get('HASH_PEPPER') != original['HASH_PEPPER'] or len(current.get('CPF_CACHE_ENCRYPTION_KEY','')) < 32:
        raise RuntimeError('Protected configuration verification failed')
    shutil.copyfile(envfile, backup/'app.env.with-cache-key')
    (backup/'app.env.with-cache-key').chmod(0o600)
    phase('cache_schema')
    psql("""BEGIN;
    CREATE TABLE IF NOT EXISTS cpf_lookup_cache (
      cpf_hash TEXT PRIMARY KEY,payload TEXT NOT NULL,fetched_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
      CHECK (expires_at > fetched_at AND expires_at <= fetched_at + interval '30 days'));
    ALTER TABLE public.cpf_lookup_cache OWNER TO peticao;
    CREATE INDEX IF NOT EXISTS cpf_lookup_cache_expiry ON cpf_lookup_cache(expires_at);
    COMMIT;""")
    phase('cache_import_dry_run')
    command = ['node',str(extracted/'tools/cpf-cache/seed-cache.mjs'),
               '--source','/root/peticao-recovery/validacao-cpf-brasil-cache.sqlite',
               '--maps','/root/peticao-recovery/consolidacoes/consolidacao-20261106T104518Z/backup/fontes',
               '--database','peticao']
    child_env = dict(os.environ, HASH_PEPPER=current['HASH_PEPPER'], CPF_CACHE_ENCRYPTION_KEY=current['CPF_CACHE_ENCRYPTION_KEY'])
    for commit in (False,True):
        result = subprocess.run(command + (['--apply'] if commit else []),env=child_env,capture_output=True,text=True)
        if result.returncode:
            raise RuntimeError('Cache import failed; private details omitted')
        report = json.loads(result.stdout)
        (root/('cache-import.json' if commit else 'cache-import-dry-run.json')).write_text(json.dumps(report,indent=2))
        phase('cache_imported' if commit else 'cache_import_validated', cache_records_eligible=report['eligible'])
    phase('stage_patch')
    for entry in manifest:
        rel = Path(entry['file']).relative_to('site')
        target = stage/rel
        shutil.copyfile(extracted/entry['file'], target)
        shutil.chown(target,user='adunir',group='adunir')
        target.chmod(0o644)
    phase('build_and_deploy')
    with (root/'deploy.log').open('w') as log:
        p = subprocess.run(['/usr/local/sbin/peticao-deploy'],stdout=log,stderr=subprocess.STDOUT)
    if p.returncode:
        raise RuntimeError('Deployment script failed; preserved backup available')
    phase('verification')
    for entry in manifest:
        if sha(app/Path(entry['file']).relative_to('site')) != entry['after_sha256']:
            raise RuntimeError('Deployed source mismatch')
    # Public text/UI stayed byte-for-byte equal to the preserved installation.
    ui_count = 0
    for old in (backup/'app').rglob('*'):
        if not old.is_file() or 'node_modules' in old.parts or '.next' in old.parts:
            continue
        rel = old.relative_to(backup/'app')
        if old.suffix in {'.tsx','.css'} or str(rel).startswith('src/i18n/') or str(rel)=='README.md':
            if not (app/rel).is_file() or sha(old)!=sha(app/rel):
                raise RuntimeError('Public UI changed unexpectedly')
            ui_count += 1
    http = {}
    for path in ('/','/api/contador','/privacidade','/confirmar'):
        with urllib.request.urlopen('http://127.0.0.1:3000'+path,timeout=30) as response:
            http[path] = response.status
    aggregate = json.loads(psql("""BEGIN READ ONLY;
      SELECT json_build_object('cache_total',(SELECT count(*) FROM cpf_lookup_cache),
        'active',(SELECT count(*) FROM cpf_lookup_cache WHERE expires_at>now()),
        'invalid_lifetime',(SELECT count(*) FROM cpf_lookup_cache WHERE expires_at-fetched_at>interval '30 days'),
        'confirmed_with_cache',(SELECT count(*) FROM signatures s JOIN cpf_lookup_cache c USING(cpf_hash) WHERE s.status='confirmed'),
        'pending_with_cache',(SELECT count(*) FROM signatures s JOIN cpf_lookup_cache c USING(cpf_hash) WHERE s.status='pending'));
      COMMIT;"""))
    phase('complete',http=http,public_files_unchanged=ui_count,**aggregate)
    (root/'backup-manifest.json').write_text(json.dumps({
        'database_sha256':sha(backup/'producao.dump'),'package_sha256':sha(bundle),
        'secret_backups_remain_on_vps':True,'backup':str(backup)},indent=2))


if __name__ == '__main__':
    root = Path(sys.argv[1])
    try:
        main(root)
    except Exception as exc:
        state = json.loads((root/'status.json').read_text()) if (root/'status.json').exists() else {}
        state.update(result='failed',error_type=type(exc).__name__,reason=str(exc))
        (root/'status.json').write_text(json.dumps(state,indent=2))
        print('DEPLOY_FAILED: '+str(exc),flush=True)
        sys.exit(1)
