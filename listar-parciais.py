#!/usr/bin/env python3
"""Print every partially compatible record from the latest downloaded validation."""
import csv
import hashlib
import json
from pathlib import Path
import sys
import unicodedata

ROOT = Path('/mnt/dev/cpfs')


def safe(value):
    # Preserve accents while preventing input fields from issuing terminal commands.
    return ''.join(c if not unicodedata.category(c).startswith('C') and c not in '\u2028\u2029'
                   else '\\u' + format(ord(c), '04x') for c in str(value))


def main():
    manifests = sorted(ROOT.glob('manifest-validacao-*.json'))
    if not manifests:
        raise RuntimeError('Nenhum resultado de validação baixado')
    manifest = json.loads(manifests[-1].read_text())
    matches = [r for r in manifest if r['file'].startswith('comparacao-cpf-brasil-todas-') and r['file'].endswith('.csv')]
    if len(matches) != 1:
        raise RuntimeError('Manifesto sem tabela única dos dois grupos')
    entry = matches[0]
    if Path(entry['file']).name != entry['file']:
        raise RuntimeError('Nome de arquivo inválido')
    source = ROOT / entry['file']
    if source.is_symlink():
        raise RuntimeError('Link simbólico recusado')
    with source.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
            raise RuntimeError('Checksum do CSV divergente')
    with source.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        columns = reader.fieldnames or []
        rows = [r for r in reader if r.get('nome_confere') == 'parcial']
    # The first extra column marks the end of all original form/export columns.
    split = columns.index('grupo_assinatura')
    original = columns[:split]
    returned = ['cpf_retornado', 'nome_retornado', 'nascimento_retornado', 'nome_mae_retornado',
                'sexo_retornado', 'sexo_normalizado', 'campos_nao_retornados']
    remaining = [c for c in columns[split:] if c not in returned]
    print('LISTA COMPLETA — NOMES PARCIALMENTE COMPATÍVEIS')
    print('Fonte: ' + source.name)
    print(f'Total: {len(rows)} registros. Os nomes originais não foram substituídos.')
    for index, row in enumerate(rows, 1):
        print('\n' + '=' * 78)
        print(f'REGISTRO {index}/{len(rows)} | assinatura_id={safe(row["assinatura_id"])} | grupo={safe(row["grupo_assinatura"])}')
        for heading, fields in [('DADOS ORIGINAIS DA BASE', original),
                                ('DADOS RETORNADOS PELA API', returned),
                                ('COMPARAÇÃO E RASTREABILIDADE', remaining)]:
            print('\n' + heading)
            for field in fields:
                print(f'  {field}: {safe(row.get(field, "")) or "(vazio)"}')
    print(f'\nFIM DA LISTA — {len(rows)} registros exibidos.')


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
    except Exception as exc:
        print(f'Falha na listagem ({type(exc).__name__}): {exc}', file=sys.stderr)
        sys.exit(1)
