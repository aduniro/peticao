#!/usr/bin/env python3
"""Back up and snapshot production without importing or initializing the app."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys


def save(path, data):
    with path.open('xb') as stream:
        stream.write(data)
    path.chmod(0o600)


def psql(sql):
    result = subprocess.run(
        ['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/psql',
         '-X', '-qAt', '-d', 'peticao', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError('Read-only snapshot query failed; private details omitted')
    return json.loads(result.stdout)


def main():
    os.umask(0o077)
    root = Path(sys.argv[1])
    backup = root / 'backup'
    if root.parent != Path('/root/peticao-recovery/consolidacoes'):
        raise RuntimeError('Unexpected destination')
    backup.mkdir(exist_ok=True, mode=0o700)
    dump = backup / 'producao.dump'
    with dump.open('xb') as out:
        result = subprocess.run(
            ['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/pg_dump',
             '-Fc', '-Z', '3', '--dbname=peticao'], stdout=out,
            stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Database backup failed; private details omitted')
    result = subprocess.run(['/usr/bin/pg_restore', '--list', str(dump)],
                            capture_output=True)
    if result.returncode:
        raise RuntimeError('Database backup inventory failed')
    save(backup / 'producao.dump.inventory', result.stdout)
    snapshot = psql("""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='120s';
SELECT json_build_object(
 'at',now(),
 'signatures',(SELECT coalesce(json_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM signatures s),
 'batches',(SELECT coalesce(json_agg(to_jsonb(b)-'pdf'-'signed_pdf' ORDER BY b.id),'[]') FROM batches b),
 'pdfs',(SELECT coalesce(json_agg(json_build_object('id',id,'pdf',encode(pdf,'base64'),
     'signed_pdf',encode(signed_pdf,'base64')) ORDER BY id),'[]') FROM batches),
 'audit_last',(SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1),
 'settings',(SELECT coalesce(json_agg(to_jsonb(s)),'[]') FROM settings s
     WHERE key IN ('sending_enabled','reenvio_ativo'))
);
COMMIT;
""")
    pdfs = snapshot.pop('pdfs')
    save(backup / 'snapshot.json', json.dumps(snapshot, ensure_ascii=False).encode())
    pdf_dir = backup / 'pdfs'
    pdf_dir.mkdir(mode=0o700)
    for batch in pdfs:
        for field in ('pdf', 'signed_pdf'):
            if batch[field]:
                save(pdf_dir / f"lote-{batch['id']}-{field}.pdf", base64.b64decode(batch[field]))
    source = Path('/root/peticao-recovery/validacoes/20261105T145514Z-3def77')
    files = [source / 'entrada-confirmadas.csv', source / 'entrada-pendentes.csv',
             source / 'resultados/comparacao-cpf-brasil-todas.csv',
             source / 'resultados/comparacao-cpf-brasil.sqlite',
             Path('/root/peticao-recovery/validacao-cpf-brasil-cache.sqlite')]
    for folder in (Path('/root/peticao-recovery/runs/20261104T223158Z-8205ee'),):
        files.extend(p for p in folder.iterdir() if p.suffix in ('.sqlite', '.csv'))
    dest = backup / 'fontes'
    dest.mkdir(mode=0o700)
    for i, path in enumerate(files):
        target = dest / f'{i:02d}-{path.name}'
        if path.suffix == '.sqlite':
            src = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
            dst = sqlite3.connect(target)
            try:
                src.backup(dst)
                if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('SQLite backup integrity failed')
            finally:
                src.close()
                dst.close()
            target.chmod(0o600)
        else:
            save(target, path.read_bytes())
    manifest = [{'file': str(p.relative_to(backup)), 'bytes': p.stat().st_size,
                 'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()}
                for p in sorted(backup.rglob('*')) if p.is_file()]
    save(backup / 'manifest.json', json.dumps(manifest, indent=2).encode())
    print(json.dumps({'backup': str(backup), 'files': len(manifest),
                      'signatures': len(snapshot['signatures']), 'batches': len(pdfs)}))


if __name__ == '__main__':
    main()
