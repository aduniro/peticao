#!/usr/bin/env python3
"""Read-only live terminal monitor; never reads app.env or calls PostgreSQL."""
import argparse
import datetime
import fcntl
import os
from pathlib import Path
import sqlite3
import sys
import time
import unicodedata
from urllib.parse import quote

LIMIT = 1_000_000_000


def terminal_text(value):
    # Names are user-supplied: prevent terminal escapes and forged log lines.
    return ''.join(' ' if unicodedata.category(c).startswith('C') or c in '\u2028\u2029'
                   else c for c in str(value))


def worker_active(path):
    try:
        fd = os.open(str(path) + '.lock', os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    finally:
        os.close(fd)


def read_snapshot(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('SQLite ausente ou link simbólico')
    conn = sqlite3.connect('file:' + quote(str(path), safe='/') + '?mode=ro', uri=True, timeout=10)
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        meta = dict(conn.execute('SELECT key,value FROM metadata'))
        total, recovered = conn.execute(
            'SELECT count(*),count(cpf) FROM signatures').fetchone()
        rows = conn.execute('''SELECT signature_id,name,cpf FROM signatures
                               WHERE cpf IS NOT NULL ORDER BY recovered_at,signature_id''').fetchall()
        return meta, total, recovered, rows
    finally:
        conn.close()


def duration(seconds):
    hours, remainder = divmod(int(seconds), 3600)
    minutes, seconds = divmod(remainder, 60)
    return f'{hours:02d}:{minutes:02d}:{seconds:02d}'


def watch(path, interval, details):
    seen = set()
    started = time.monotonic()
    first_base = None
    print('Monitor somente leitura. Ctrl+C fecha apenas o monitor.', flush=True)
    print('Contagens refletem os checkpoints do processo de recuperação.', flush=True)
    if details:
        print('Exibição privada de nomes e CPFs habilitada neste terminal.', flush=True)
    while True:
        active = worker_active(path)
        meta, total, recovered, rows = read_snapshot(path)
        for sid, name, cpf in rows:
            if sid not in seen:
                seen.add(sid)
                if details:
                    formatted = f'{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}'
                    print(f'[RECUPERADO] assinatura={sid} | CPF={formatted} | Nome={terminal_text(name)}', flush=True)
        base = int(meta.get('next_base', 0))
        if first_base is None:
            first_base = base
        elapsed = time.monotonic() - started
        rate = (base - first_base) / elapsed if elapsed > 0 else 0
        eta = duration((LIMIT-base)/rate) if rate > 0 and active else 'calculando' if active else '--'
        state = 'em execução' if active else terminal_text(meta.get('state', 'sem processo ativo'))
        now = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
        print(f'[{now}] Hashes correspondidos: {recovered}/{total} | '
              f'CPFs recuperados: {recovered} | Restantes: {total-recovered} | '
              f'Busca: {base:,}/{LIMIT:,} ({base/LIMIT:.2%}) | '
              f'Bases/s: {rate:.0f} | Tempo até fim do espaço: {eta} | Estado: {state}', flush=True)
        if not active:
            print('Processo de recuperação inativo; monitor encerrado.', flush=True)
            return
        time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/root/peticao-recovery/assinaturas.sqlite'))
    parser.add_argument('--interval', type=float, default=2)
    parser.add_argument('--show-personal-data', action='store_true',
                        help='Show recovered names and CPFs; requires an interactive terminal')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Execute como root na VPS')
    if args.interval < 0.5 or args.interval > 3600:
        raise RuntimeError('Intervalo inválido')
    if args.show_personal_data and not sys.stdout.isatty():
        raise RuntimeError('Dados pessoais exigem terminal interativo; use ssh -t')
    watch(args.output.absolute(), args.interval, args.show_personal_data)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nMonitor fechado. O processo de recuperação não foi interrompido.', flush=True)
    except Exception as exc:
        print(f'Falha no monitor ({type(exc).__name__}); detalhes privados omitidos.', file=sys.stderr)
        sys.exit(1)
