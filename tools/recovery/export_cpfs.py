#!/usr/bin/env python3
"""Export recovered CPFs only, without modifying the source SQLite."""
import argparse
import csv
import os
from pathlib import Path
import sqlite3
import sys
from urllib.parse import quote


def export(source, target):
    source = source.absolute()
    target = target.absolute()
    if not source.is_file() or source.is_symlink():
        raise RuntimeError('Fonte ausente ou inválida')
    conn = sqlite3.connect('file:' + quote(str(source), safe='/') + '?mode=ro', uri=True)
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('SQLite sem integridade')
        rows = conn.execute('SELECT cpf FROM signatures WHERE cpf IS NOT NULL ORDER BY signature_id').fetchall()
        total = conn.execute('SELECT count(*) FROM signatures').fetchone()[0]
    finally:
        conn.close()
    if any(not isinstance(cpf, str) or len(cpf) != 11 or not cpf.isascii() or not cpf.isdigit() for (cpf,) in rows):
        raise RuntimeError('CPF fora do formato esperado')
    if len({cpf for (cpf,) in rows}) != len(rows):
        raise RuntimeError('CPFs duplicados; exportação recusada')
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as out:
            writer = csv.writer(out)
            writer.writerow(['cpf'])
            writer.writerows(rows)
        with target.open(encoding='utf-8', newline='') as result:
            parsed = list(csv.reader(result))
        if parsed != [['cpf']] + [list(row) for row in rows]:
            raise RuntimeError('Verificação do CSV falhou')
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    print(f'CSV validado: {len(rows)} CPFs; {total-len(rows)} assinaturas sem CPF recuperado. Permissão 600.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/root/peticao-recovery/assinaturas.sqlite'))
    parser.add_argument('--output', type=Path, default=Path('/root/peticao-recovery/cpfs-recuperados.csv'))
    args = parser.parse_args()
    try:
        export(args.source, args.output)
    except Exception as exc:
        print(f'Falha na exportação ({type(exc).__name__}); detalhes privados omitidos.', file=sys.stderr)
        sys.exit(1)
