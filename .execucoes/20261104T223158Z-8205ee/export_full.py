#!/usr/bin/env python3
"""Export persisted form fields for exactly the recovered SQLite cohort."""
import argparse
import csv
import json
import os
from pathlib import Path
import shlex
import sqlite3
import subprocess
import sys
from urllib.parse import quote, unquote, urlparse

FIELDS = [
    ('nome', 'name'), ('email', 'email'), ('categoria', 'category'),
    ('instituicao', 'institution'), ('cargo', 'role'), ('campus', 'campus'),
    ('municipio', 'city'), ('uf', 'uf'), ('pais', 'country'),
    ('universidade', 'university'), ('idioma', 'locale'),
    ('instituicao_listada', 'institution_listed'), ('campus_listado', 'campus_listed'),
    ('municipio_ibge', 'city_ibge'), ('campus_ibge', 'campus_ibge'),
    ('regiao_declarada', 'region_declared'), ('regiao_validada', 'region_validated'),
    ('criterio_regional', 'region_criteria'), ('cpf_nome_conferencia', 'cpf_name_check'),
    ('criado_em', 'created_at'), ('consentimento_em', 'consent_at'),
    ('confirmado_em', 'confirmed_at'),
]
HEADERS = ['assinatura_id', 'nome', 'cpf'] + [label for label, _ in FIELDS if label != 'nome']


def cohort(path):
    conn = sqlite3.connect('file:' + quote(str(path.absolute()), safe='/') + '?mode=ro', uri=True)
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('SQLite inválido')
        rows = conn.execute('SELECT signature_id,cpf_hash,cpf FROM signatures WHERE cpf IS NOT NULL ORDER BY signature_id').fetchall()
    finally:
        conn.close()
    if not rows:
        raise RuntimeError('Nenhum CPF recuperado')
    for sid, digest, cpf in rows:
        if (not isinstance(sid, int) or len(digest) != 64 or
                any(c not in '0123456789abcdef' for c in digest) or
                not isinstance(cpf, str) or len(cpf) != 11 or not cpf.isascii() or not cpf.isdigit()):
            raise RuntimeError('Registro recuperado inválido')
    if len({sid for sid, _, _ in rows}) != len(rows) or len({cpf for _, _, cpf in rows}) != len(rows):
        raise RuntimeError('Duplicação no escopo')
    return rows


def connection(path):
    urls = []
    for line in path.read_text().splitlines():
        name, sep, raw = line.strip().partition('=')
        if sep and name == 'DATABASE_URL':
            parts = shlex.split(raw, comments=True)
            if len(parts) != 1:
                raise RuntimeError('Configuração não suportada')
            urls.append(parts[0])
    if len(urls) != 1:
        raise RuntimeError('Configuração não encontrada ou duplicada')
    uri = urlparse(urls[0])
    database = unquote(uri.path.lstrip('/'))
    if (uri.scheme not in ('postgres', 'postgresql') or
            uri.hostname not in ('127.0.0.1', 'localhost', '::1') or not database or
            not all(c.isalnum() or c in '_-' for c in database)):
        raise RuntimeError('Exige PostgreSQL local')
    return database, str(uri.port or 5432)


def make_query(rows):
    # Only validated numeric IDs and hex hashes are embedded, never names or CPFs.
    scope = json.dumps([{'signature_id': sid, 'cpf_hash': digest} for sid, digest, _ in rows])
    columns = ',\n'.join(f"to_jsonb(s)->>'{field}' AS {label}" for label, field in FIELDS)
    return f"""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
WITH scope AS (
 SELECT * FROM json_to_recordset($scope${scope}$scope$::json)
 AS r(signature_id integer, cpf_hash text)
)
SELECT coalesce(json_agg(row_to_json(result)), '[]'::json) FROM (
 SELECT s.id AS assinatura_id, {columns}
 FROM signatures s JOIN scope r ON s.id=r.signature_id AND s.cpf_hash=r.cpf_hash
 ORDER BY s.id
) result;
COMMIT;
"""


def validate_records(rows, records):
    expected = {sid for sid, _, _ in rows}
    actual = [record['assinatura_id'] for record in records]
    if len(actual) != len(rows) or set(actual) != expected:
        raise RuntimeError('Escopo divergente; nenhuma exportação foi gerada')
    for record in records:
        if not record.get('nome') or not record.get('email'):
            raise RuntimeError('Registro sem nome ou e-mail')


def write_csv(path, rows, records):
    validate_records(rows, records)
    cpfs = {sid: cpf for sid, _, cpf in rows}
    values = []
    for record in records:
        record = dict(record, cpf=cpfs[record['assinatura_id']])
        values.append(['' if record.get(label) is None else str(record[label]) for label in HEADERS])
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8-sig', newline='') as out:
            writer = csv.writer(out)
            writer.writerow(HEADERS)
            writer.writerows(values)
        with path.open(encoding='utf-8-sig', newline='') as result:
            if list(csv.reader(result)) != [HEADERS] + values:
                raise RuntimeError('CSV não passou na verificação')
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/root/peticao-recovery/assinaturas.sqlite'))
    parser.add_argument('--env-file', type=Path, default=Path('/etc/peticao/app.env'))
    parser.add_argument('--output', type=Path, default=Path('/root/peticao-recovery/dados-completos-recuperados.csv'))
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Execute como root na VPS')
    rows = cohort(args.source)
    database, port = connection(args.env_file)
    result = subprocess.run(
        ['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/psql',
         '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
         '-h', '/var/run/postgresql', '-p', port, '-d', database],
        input=make_query(rows), text=True, capture_output=True, timeout=75,
        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'},
    )
    if result.returncode:
        raise RuntimeError('Consulta somente leitura falhou')
    records = json.loads(result.stdout)
    write_csv(args.output, rows, records)
    print(f'CSV validado: {len(records)} registros; {len(HEADERS)} colunas; escopo conferido por ID e hash; permissão 600.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Falha na exportação completa ({type(exc).__name__}); detalhes privados omitidos.', file=sys.stderr)
        sys.exit(1)
