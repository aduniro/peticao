#!/usr/bin/env python3
"""Offline reconciliation of immutable backups. Never accesses the API or app DB."""
import argparse
import collections
import csv
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'recovery'))
from cpf_compare import compare, normalized


def readonly(path):
    conn = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    conn.execute('PRAGMA query_only=ON')
    conn.row_factory = sqlite3.Row
    return conn


def classify(signature, recovered, lookup):
    if signature.get('category') == 'estrangeiro':
        return 'estrangeiro_sem_cpf', None
    if recovered is None:
        return ('match_app_sem_retorno_auditavel' if signature.get('cpf_name_check') == 'match'
                else 'sem_consulta_associada'), None
    if lookup is None or lookup['status'] != 'ok':
        return 'consulta_' + (lookup['status'] if lookup else 'ausente'), None
    if lookup.get('returned_cpf') and lookup['returned_cpf'] != recovered['cpf']:
        return 'cpf_retornado_divergente', None
    result = compare(signature['name'], lookup['name'] or '')
    # A changed registration is never silently promoted from a historic query.
    if signature['id'] != recovered['signature_id']:
        return 'cadastro_substituido', result
    if normalized(signature['name']) != normalized(recovered['name']):
        return 'nome_alterado_desde_snapshot', result
    group = result['nome_classificacao']
    if group in ('coincidencia_exata', 'coincidencia_normalizada'):
        return 'correspondencia_completa', result
    return group, result


def reconcile(snapshot, recovered, lookups):
    groups = collections.Counter()
    by_status = collections.defaultdict(collections.Counter)
    report, eligible, changes = [], [], []
    for signature in snapshot['signatures']:
        prior = recovered.get(signature.get('cpf_hash'))
        lookup = lookups.get(prior['cpf']) if prior else None
        group, comparison = classify(signature, prior, lookup)
        status = signature['status']
        groups[group] += 1
        by_status[status][group] += 1
        row = {key: signature.get(key) for key in (
            'id', 'seq', 'status', 'category', 'name', 'institution', 'role',
            'campus', 'city', 'uf', 'created_at', 'consent_at', 'confirmed_at',
            'region_declared', 'region_validated', 'cpf_name_check', 'batch_id')}
        row.update(grupo=group, nome_api=lookup.get('name') if lookup else None,
                   consulta_em=lookup.get('queried_at') if lookup else None,
                   comparacao=comparison)
        report.append(row)
        if group == 'correspondencia_completa':
            evidence = {'expected': signature, 'lookup_at': lookup['queried_at'],
                        'api_name': lookup['name'], 'comparison': comparison['nome_classificacao']}
            eligible.append(evidence)
            if signature.get('cpf_name_check') != 'match':
                changes.append(evidence)
    return {'snapshot_at': snapshot['at'], 'total': len(report), 'grupos': dict(groups),
            'por_status': {k: dict(v) for k, v in by_status.items()},
            'elegiveis': len(eligible), 'atualizacoes_propostas': len(changes),
            'atualizacoes_por_status': dict(collections.Counter(x['expected']['status'] for x in changes))}, report, eligible, changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('backup', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    backup = args.backup
    for entry in json.loads((backup / 'manifest.json').read_text()):
        path = backup / entry['file']
        with path.open('rb') as f:
            digest = hashlib.file_digest(f, 'sha256').hexdigest()
        if digest != entry['sha256']:
            raise RuntimeError('Backup checksum mismatch')
    snapshot = json.loads((backup / 'snapshot.json').read_text())
    recovered, lookups = {}, {}
    for path in sorted((backup / 'fontes').glob('*.sqlite')):
        with readonly(path) as conn:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'signatures' in tables:
                for record in conn.execute('SELECT * FROM signatures WHERE cpf IS NOT NULL'):
                    row = dict(record)
                    if row['cpf_hash'] in recovered and recovered[row['cpf_hash']]['cpf'] != row['cpf']:
                        raise RuntimeError('Conflicting recovered CPF mapping')
                    recovered[row['cpf_hash']] = row
            if 'lookups' in tables:
                lookups = {r['cpf']: dict(r) for r in conn.execute('SELECT * FROM lookups')}
    if not recovered or not lookups:
        raise RuntimeError('Recovery inputs missing')
    summary, report, eligible, changes = reconcile(snapshot, recovered, lookups)
    args.output.mkdir(mode=0o700)
    for name, value in [('resumo.json', summary), ('relatorio.json', report),
                        ('elegiveis.json', eligible), ('atualizacoes-propostas.json', changes)]:
        path = args.output / name
        with path.open('x') as out:
            json.dump(value, out, ensure_ascii=False, indent=2)
        path.chmod(0o600)
    fields = [k for k in report[0] if k != 'comparacao'] + ['classificacao', 'diferencas']
    with (args.output / 'revisao.csv').open('x', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in report:
            comparison = row['comparacao'] or {}
            row = {k: v for k, v in row.items() if k != 'comparacao'}
            row.update(classificacao=comparison.get('nome_classificacao', ''),
                       diferencas=comparison.get('diferencas_nome', ''))
            writer.writerow(row)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
