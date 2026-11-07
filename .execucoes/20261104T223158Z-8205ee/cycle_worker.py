#!/usr/bin/env python3
"""Private VPS worker for the self-contained recovery-cycle launcher."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import resource
import sqlite3
import subprocess
import sys
import tarfile
from urllib.parse import quote

BASE = Path('/root/peticao-recovery')


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, content):
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('wb') as out:
        out.write(content)
    temporary.chmod(0o600)
    os.replace(temporary, path)


def backup_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if target.exists():
        if target.is_symlink():
            raise RuntimeError('Link simbólico recusado')
        return  # Complete atomic backup from an interrupted invocation; preserve it.
    if source.is_symlink():
        raise RuntimeError('Link simbólico recusado')
    if source.suffix == '.sqlite':
        temporary = target.with_name(target.name + '.tmp')
        temporary.unlink(missing_ok=True)
        src = sqlite3.connect('file:' + quote(str(source), safe='/') + '?mode=ro', uri=True)
        dst = sqlite3.connect(temporary)
        try:
            src.backup(dst)
            if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup SQLite inválido')
        finally:
            dst.close()
            src.close()
        temporary.chmod(0o600)
        os.replace(temporary, target)
    else:
        before = source.stat()
        save(target, source.read_bytes())
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or sha(source) != sha(target):
            raise RuntimeError('Arquivo mudou durante o backup')
    target.chmod(0o600)


def package(directory, files, archive):
    manifest = [{'file': str(p.relative_to(directory)), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in files]
    save(directory / 'manifest.json', json.dumps(manifest, indent=2).encode())
    temporary = archive.with_name(archive.name + '.tmp')
    with tarfile.open(temporary, 'w:gz') as tar:
        for path in files + [directory / 'manifest.json']:
            tar.add(path, arcname=str(path.relative_to(directory)), recursive=False)
    temporary.chmod(0o600)
    os.replace(temporary, archive)


def backup(run):
    destination = BASE / 'backups' / run
    archive = destination / 'backup-vps.tar.gz'
    if archive.exists():
        print('BACKUP_VPS_PRONTO', flush=True)
        return
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    sources = sorted(p for p in BASE.rglob('*') if p.suffix in ('.sqlite', '.csv')
                     and not {'backups', 'jobs'}.intersection(p.relative_to(BASE).parts))
    files = []
    for source in sources:
        target = destination / 'arquivos' / source.relative_to(BASE)
        backup_file(source, target)
        files.append(target)
    package(destination, files, archive)
    print(f'BACKUP_VPS_PRONTO: {len(files)} arquivos', flush=True)


def state(job, value):
    save(job / 'status.json', json.dumps(value).encode())


def query_forms(source):
    import export_full
    with sqlite3.connect('file:' + quote(str(source), safe='/') + '?mode=ro', uri=True) as conn:
        rows = conn.execute('SELECT signature_id,cpf_hash,cpf FROM signatures ORDER BY signature_id').fetchall()
    database, port = export_full.connection(Path('/etc/peticao/app.env'))
    result = subprocess.run(['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/psql',
                             '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                             '-h', '/var/run/postgresql', '-p', port, '-d', database],
                            input=export_full.make_query(rows), text=True, capture_output=True,
                            timeout=75, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
    if result.returncode:
        raise RuntimeError('Snapshot dos formulários falhou')
    records = json.loads(result.stdout)
    export_full.validate_records(rows, records)
    return records


def exports(directory, group, source, forms):
    import export_full
    with sqlite3.connect('file:' + quote(str(source), safe='/') + '?mode=ro', uri=True) as conn:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('SQLite inválido')
        rows = conn.execute('SELECT signature_id,cpf_hash,cpf,name FROM signatures WHERE cpf IS NOT NULL ORDER BY signature_id').fetchall()
        total = conn.execute('SELECT count(*) FROM signatures').fetchone()[0]
        phase = dict(conn.execute('SELECT key,value FROM metadata'))['state']
    if len({r[2] for r in rows}) != len(rows) or any(len(r[2]) != 11 or not r[2].isascii() or not r[2].isdigit() for r in rows):
        raise RuntimeError('CPFs inválidos na exportação')
    recovered_ids = {r[0] for r in rows}
    records = [r for r in forms if r['assinatura_id'] in recovered_ids]
    export_full.validate_records([r[:3] for r in rows], records)
    by_id = {r['assinatura_id']: r for r in records}
    complete = []
    for sid, _, cpf, _ in rows:
        record = dict(by_id[sid], cpf=cpf)
        complete.append(['' if record.get(h) is None else str(record[h]) for h in export_full.HEADERS])
    tables = [
        (f'cpfs-{group}.csv', ['cpf'], [[r[2]] for r in rows]),
        (f'nomes-cpfs-{group}.csv', ['nome', 'cpf'], [[r[3], r[2]] for r in rows]),
        (f'dados-completos-{group}.csv', export_full.HEADERS, complete),
    ]
    files = [source]
    for filename, headers, values in tables:
        buffer = io.StringIO(newline='')
        writer = csv.writer(buffer)
        writer.writerow(headers)
        writer.writerows(values)
        if list(csv.reader(io.StringIO(buffer.getvalue()))) != [headers] + values:
            raise RuntimeError('CSV inválido')
        target = directory / filename
        save(target, buffer.getvalue().encode('utf-8-sig'))
        files.append(target)
    return files, {'grupo': group, 'total': total, 'recuperados': len(rows), 'restantes': total-len(rows), 'estado': phase}


def recover(run, job):
    directory = BASE / 'runs' / run
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not (BASE / 'backups' / run / 'backup-vps.tar.gz').is_file():
        raise RuntimeError('Backup obrigatório ausente')
    state(job, {'phase': 'running', 'stage': 'snapshots'})
    groups = [('confirmadas', 'recover_cpfs.py'), ('pendentes', 'recover_pending_cpfs.py')]
    # Capture both cohorts before either long search. Cache form fields so later
    # pending-signature deletion/recreation cannot change this export's scope.
    for group, script in groups:
        source = directory / f'assinaturas-{group}.sqlite'
        subprocess.run([sys.executable, str(job / script), '--output', str(source), '--max-candidates', '1'], check=True)
        forms_path = directory / f'formulario-{group}.json'
        if not forms_path.exists():
            save(forms_path, json.dumps(query_forms(source), ensure_ascii=False).encode())
    files, summaries = [], []
    for group, script in groups:
        state(job, {'phase': 'running', 'stage': group})
        source = directory / f'assinaturas-{group}.sqlite'
        subprocess.run([sys.executable, str(job / script), '--output', str(source)], check=True)
        forms = json.loads((directory / f'formulario-{group}.json').read_text())
        produced, summary = exports(directory, group, source, forms)
        files.extend(produced)
        summaries.append(summary)
    package(directory, files, directory / 'resultados.tar.gz')
    phase = 'complete' if all(s['restantes'] == 0 for s in summaries) else 'partial'
    state(job, {'phase': phase, 'groups': summaries})


def main():
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    phase, run = sys.argv[1:]
    if not run or any(c not in '0123456789abcdefTtZz-' for c in run):
        raise RuntimeError('Identificador inválido')
    if os.geteuid() != 0:
        raise RuntimeError('Execute na VPS como root')
    job = Path(__file__).resolve().parent
    if phase == 'backup':
        backup(run)
    elif phase == 'launch':
        unit = 'cpf-cycle-' + run
        active = subprocess.run(['systemctl', 'is-active', '--quiet', unit], capture_output=True).returncode == 0
        if not active:
            state(job, {'phase': 'starting'})
            subprocess.run(['systemd-run', '--unit=' + unit, '--collect',
                            '--property=CPUQuota=50%', '--property=MemoryMax=512M',
                            '--property=UMask=0077', '/usr/bin/python3', str(job / 'cycle_worker.py'),
                            'recover', run], check=True)
    elif phase == 'recover':
        try:
            recover(run, job)
        except Exception as exc:
            state(job, {'phase': 'failed', 'error_type': type(exc).__name__})
            raise
    elif phase == 'status':
        value = json.loads((job / 'status.json').read_text()) if (job / 'status.json').exists() else {'phase': 'waiting'}
        value['active'] = subprocess.run(['systemctl', 'is-active', '--quiet', 'cpf-cycle-' + run], capture_output=True).returncode == 0
        for group in ('confirmadas', 'pendentes'):
            source = BASE / 'runs' / run / f'assinaturas-{group}.sqlite'
            if source.exists():
                try:
                    with sqlite3.connect('file:' + quote(str(source), safe='/') + '?mode=ro', uri=True, timeout=2) as conn:
                        n, found = conn.execute('SELECT count(*),count(cpf) FROM signatures').fetchone()
                        value[group] = {'total': n, 'recuperados': found, 'restantes': n-found}
                except sqlite3.Error:
                    pass
        print(json.dumps(value), flush=True)
    else:
        raise RuntimeError('Ação inválida')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Falha na etapa da VPS ({type(exc).__name__}); detalhes privados omitidos.', file=sys.stderr)
        sys.exit(1)
