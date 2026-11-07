#!/usr/bin/env python3
"""Recover CPFs for unconfirmed signatures only, into a separate resumable SQLite.

Does not import the application, modify PostgreSQL, or call external APIs.
Run on the VPS as root. Never logs names, hashes, CPFs, or credentials.
"""
import argparse
import datetime
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import resource
import shlex
import signal
import sqlite3
import subprocess
import sys
import time
from urllib.parse import unquote, urlparse

LIMIT = 1_000_000_000
SELECTION = "status=pending AND cpf_hash IS NOT NULL"
QUERY = """
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)
FROM (
 SELECT id, name, category, cpf_hash, cpf_name_check,
        created_at, consent_at, confirmed_at
 FROM signatures
 WHERE status = 'pending' AND cpf_hash IS NOT NULL
 ORDER BY id
) s;
COMMIT;
"""


def read_settings(path):
    result = {}
    for line in path.read_text().splitlines():
        name, sep, raw = line.strip().partition('=')
        if sep and name in ('HASH_PEPPER', 'DATABASE_URL'):
            parts = shlex.split(raw, comments=True)
            if len(parts) != 1 or name in result:
                raise RuntimeError('Formato de configuração não suportado')
            result[name] = parts[0]
    if len(result.get('HASH_PEPPER', '')) < 32:
        raise RuntimeError('Segredo de produção ausente ou inválido')
    uri = urlparse(result.get('DATABASE_URL', ''))
    if uri.scheme not in ('postgres', 'postgresql') or uri.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise RuntimeError('Este utilitário exige PostgreSQL local')
    database = unquote(uri.path.lstrip('/'))
    if not database or not all(c.isalnum() or c in '_-' for c in database):
        raise RuntimeError('Nome do banco não suportado')
    return result['HASH_PEPPER'].encode(), database, str(uri.port or 5432)


def snapshot(database, port):
    # Peer authentication as postgres; no database password on the command line.
    proc = subprocess.run(
        ['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/psql',
         '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
         '-h', '/var/run/postgresql', '-p', port, '-d', database],
        input=QUERY, text=True, capture_output=True, timeout=45,
        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'},
    )
    if proc.returncode:
        raise RuntimeError('Consulta somente leitura falhou; detalhes omitidos para proteger dados')
    rows = json.loads(proc.stdout)
    for row in rows:
        digest = row['cpf_hash']
        if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise RuntimeError('Hash fora do formato esperado')
    return rows


def cpf_from_base(base):
    digits = f'{base:09d}'.encode()
    total = sum((c - 48) * (10 - i) for i, c in enumerate(digits))
    d1 = (total * 10) % 11
    if d1 == 10:
        d1 = 0
    total2 = total + sum(c - 48 for c in digits) + 2 * d1
    d2 = (total2 * 10) % 11
    if d2 == 10:
        d2 = 0
    cpf = digits + bytes((48 + d1, 48 + d2))
    return None if len(set(cpf)) == 1 else cpf


def set_meta(conn, key, value):
    conn.execute('INSERT OR REPLACE INTO metadata VALUES (?, ?)', (key, str(value)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, default=Path('/etc/peticao/app.env'))
    parser.add_argument('--output', type=Path, default=Path('/root/peticao-recovery/assinaturas-pendentes.sqlite'))
    parser.add_argument('--max-candidates', type=int, default=LIMIT,
                        help='Maximum base numbers in this invocation; default searches remaining space')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Execute como root na VPS')
    if not 1 <= args.max_candidates <= LIMIT:
        raise RuntimeError('Limite de candidatos inválido')
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.nice(19)
    key, database, port = read_settings(args.env_file)
    output = args.output.absolute()
    if not output.parent.is_dir() or output.parent.is_symlink():
        raise RuntimeError('Crie primeiro uma pasta privada para o resultado')
    if output.parent.stat().st_uid != 0 or output.parent.stat().st_mode & 0o077:
        raise RuntimeError('A pasta do resultado precisa pertencer ao root e ter modo 700')
    lock_fd = os.open(str(output) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    existed = output.exists()
    if output.is_symlink():
        raise RuntimeError('Link simbólico recusado')
    fd = os.open(output, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    os.close(fd)
    conn = sqlite3.connect(output)
    if existed:
        # Refuse any database outside this pending-signature recovery cohort.
        existing_meta = dict(conn.execute('SELECT key,value FROM metadata'))
        if existing_meta.get('selection') != SELECTION:
            conn.close()
            os.close(lock_fd)
            raise RuntimeError('SQLite de outro escopo; retomada recusada')
    conn.executescript('''
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS signatures (
        signature_id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
        cpf_hash TEXT NOT NULL, original_cpf_name_check TEXT,
        original_created_at TEXT, original_consent_at TEXT, original_confirmed_at TEXT,
        cpf TEXT CHECK(cpf IS NULL OR (length(cpf)=11 AND cpf NOT GLOB '*[^0-9]*')),
        recovered_at TEXT
      );
    ''')
    meta = dict(conn.execute('SELECT key,value FROM metadata'))
    key_tag = hmac.new(key, b'peticao-cpf-recovery-key-check-v1', hashlib.sha256).hexdigest()
    if 'snapshot_at' not in meta:
        if existed:
            raise RuntimeError('Arquivo existente sem snapshot completo; use outro nome de saída')
        rows = snapshot(database, port)
        for row in rows:
            conn.execute('INSERT INTO signatures VALUES (?,?,?,?,?,?,?,?,NULL,NULL)', (
                row['id'], row['name'], row['category'], row['cpf_hash'], row['cpf_name_check'],
                row['created_at'], row['consent_at'], row['confirmed_at']))
        set_meta(conn, 'snapshot_at', datetime.datetime.now(datetime.timezone.utc).isoformat())
        set_meta(conn, 'selection', SELECTION)
        set_meta(conn, 'source_status', 'pending')
        set_meta(conn, 'key_check', key_tag)
        set_meta(conn, 'next_base', 0)
        set_meta(conn, 'source_database', database)
        conn.commit()
        meta = dict(conn.execute('SELECT key,value FROM metadata'))
    if not hmac.compare_digest(meta['key_check'], key_tag) or meta['source_database'] != database:
        raise RuntimeError('Segredo ou banco diferente do usado na criação; retomada recusada')
    pending = {bytes.fromhex(h): sid for sid, h in conn.execute(
        'SELECT signature_id,cpf_hash FROM signatures WHERE cpf IS NULL')}
    total = conn.execute('SELECT count(*) FROM signatures').fetchone()[0]
    print(f'Assinaturas sem confirmação no snapshot: {total}; CPFs ainda não recuperados: {len(pending)}.', flush=True)
    stop = False

    def request_stop(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    base = int(meta['next_base'])
    end = min(LIMIT, base + args.max_candidates)
    template = hmac.new(key, digestmod=hashlib.sha256)
    last_report = time.monotonic()
    started = last_report
    initial = base
    while pending and base < end and not stop:
        cpf = cpf_from_base(base)
        if cpf is not None:
            candidate = template.copy()
            candidate.update(cpf)
            digest = candidate.digest()
            if digest in pending:
                sid = pending.pop(digest)
                conn.execute('UPDATE signatures SET cpf=?, recovered_at=? WHERE signature_id=?', (
                    cpf.decode(), datetime.datetime.now(datetime.timezone.utc).isoformat(), sid))
        base += 1
        if base % 100_000 == 0:
            set_meta(conn, 'next_base', base)
            conn.commit()
        if time.monotonic() - last_report >= 60:
            rate = (base - initial) / max(time.monotonic() - started, 0.001)
            print(f'Busca: {base}/{LIMIT}; recuperados: {total-len(pending)}; pendentes: {len(pending)}; bases/s: {rate:.0f}.', flush=True)
            last_report = time.monotonic()
    state = 'complete' if not pending else 'exhausted_with_pending' if base == LIMIT else 'paused'
    set_meta(conn, 'next_base', base)
    set_meta(conn, 'state', state)
    conn.commit()
    if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise RuntimeError('Verificação de integridade SQLite falhou')
    conn.close()
    os.close(lock_fd)
    print(f'Estado: {state}; recuperados: {total-len(pending)}; pendentes: {len(pending)}. SQLite íntegro.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Exception text may contain a URI, a query or personal data. Do not print it.
        print(f'Falha ({type(exc).__name__}); nenhum segredo ou dado pessoal foi impresso.', file=sys.stderr)
        sys.exit(1)
