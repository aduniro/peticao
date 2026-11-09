#!/usr/bin/env python3
"""Read-only structural analysis of the downloaded divergent-name records."""
import collections
import csv
import difflib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TABLE = load('divergent_table', '/mnt/dev/peticao/tabela-divergentes.py')
COMPARE = load('name_comparison', '/mnt/dev/peticao/tools/recovery/cpf_compare.py')
GROUPS = {
    '1': (1, 'Nomes muito distintos, sem palavras úteis em comum', 'Prioridade máxima de revisão; possível CPF de outra pessoa, sem comprovação.'),
    '2': (2, 'Primeiro nome diferente, com outras partes em comum', 'Revisar o primeiro nome: pode haver outro titular, nome composto, apelido ou grafia diferente.'),
    '3': (2, 'Somente o primeiro nome coincide após os demais filtros', 'Os sobrenomes não apresentam correspondência exata suficiente; a causa permanece indeterminada.'),
    '4': (3, 'Primeiro nome e outras partes coincidem, mas há substituições', 'Há nomes ou sobrenomes acrescentados e retirados; pode envolver grafia ou alteração de sobrenome.'),
    '5': (3, 'Grafias próximas, iniciais ou abreviações, com outras diferenças', 'Hipótese de digitação/abreviação; não é aprovação automática nem prova de mesma pessoa.'),
    '6': (4, 'Todas as palavras informadas estão presentes no nome da API', 'O nome informado é menos extenso; pode faltar parte inicial, intermediária ou final e pode haver troca de ordem.'),
    '7': (4, 'Todas as palavras da API estão presentes no nome informado', 'O nome informado tem complementos que o retorno não contém; pode haver diferenças de ordem ou cadastro desatualizado.'),
    '8': (5, 'Mesmas palavras com repetições diferentes', 'As palavras são as mesmas, mas algumas aparecem repetidas mais vezes em uma das fontes.'),
    '9': (5, 'Separação de palavras ou espaços', 'Ao juntar as palavras normalizadas os textos ficam iguais: há palavras coladas/separadas.'),
}


def sequence(small, big, match):
    position = 0
    for word in small:
        found = next((i for i in range(position, len(big)) if match(word, big[i])), None)
        if found is None:
            return False
        position = found + 1
    return True


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def classify(row):
    a, b = COMPARE.tokens(row['nome']), COMPARE.tokens(row['nome_retornado'])
    aa, bb = collections.Counter(a), collections.Counter(b)
    shared = set(a) & set(b)
    if row['nome_classificacao'] == 'divergencia_forte':
        return '1'
    if ''.join(a) == ''.join(b):
        return '9'
    if set(a) == set(b) and aa != bb:
        return '8'
    if aa <= bb:
        return '6'
    if bb <= aa:
        return '7'
    def near(x, y):
        return x == y or (len(x) == 1 and y.startswith(x)) or (len(x) >= 3 and y.startswith(x)) or ratio(x, y) >= 0.80
    # Matching first/last words alone must not hide an unrelated middle name.
    # The reverse alignment is reserved for the no-exact-token case, where all
    # of the shorter returned name still has to match reasonably close spellings.
    reverse_near = lambda x, y: x == y or ratio(x, y) >= 0.70
    if ((near(a[0], b[0]) and sequence(a, b, near)) or
            (not shared and ratio(a[0], b[0]) >= 0.80 and ratio(a[-1], b[-1]) >= 0.80
             and sequence(b, a, reverse_near))):
        return '5'
    if a[0] != b[0]:
        return '2'
    if len(shared) <= 1:
        return '3'
    return '4'


def details(row):
    a, b = COMPARE.tokens(row['nome']), COMPARE.tokens(row['nome_retornado'])
    missing = list((collections.Counter(b)-collections.Counter(a)).elements())
    extra = list((collections.Counter(a)-collections.Counter(b)).elements())
    parts = []
    if a[0] != b[0]:
        parts.append('Primeiro termo: ' + a[0] + ' → ' + b[0])
    if a[-1] != b[-1]:
        parts.append('Último termo: ' + a[-1] + ' → ' + b[-1])
    if missing:
        parts.append('Só/mais vezes no retorno: ' + ', '.join(missing))
    if extra:
        parts.append('Só/mais vezes no informado: ' + ', '.join(extra))
    return '; '.join(parts) or 'Mesmas palavras, em estrutura diferente.'


def grouped_rows():
    source, rows = TABLE.load_rows()
    grouped = collections.defaultdict(list)
    for row in rows:
        group = classify(row)
        copy = dict(row, grupo_analitico=group, prioridade_revisao=str(GROUPS[group][0]),
                    motivo_analitico=details(row))
        grouped[group].append(copy)
    for values in grouped.values():
        values.sort(key=lambda r: (float(r['similaridade_nome_percentual']), int(r['_local_id'])))
    return source, grouped


def report(grouped):
    total = sum(map(len, grouped.values()))
    yield f'ANÁLISE DOS NOMES DIVERGENTES — {total} registros'
    yield 'Cada registro pertence a um único grupo. Prioridade indica revisão, não probabilidade de fraude.'
    yield 'Regras: ignora acentos, caixa e partículas; compara palavras, contenção, espaços, iniciais e grafias próximas.'
    widths = [6, 35, 35, 57]
    def border(left, middle, right):
        return left + middle.join('─'*(w+2) for w in widths) + right
    def block(values):
        wrapped = [TABLE.wrap(TABLE.safe(value), width) for value, width in zip(values, widths)]
        for line in range(max(map(len, wrapped))):
            cells = []
            for column, width in zip(wrapped, widths):
                value = column[line] if line < len(column) else ''
                cells.append(' ' + value + ' '*(width-TABLE.visible_width(value)) + ' ')
            yield '│' + '│'.join(cells) + '│'
    for group in sorted(grouped, key=lambda key: (GROUPS[key][0], int(key))):
        priority, title, explanation = GROUPS[group]
        values = grouped[group]
        yield '\n' + f'GRUPO {group} — PRIORIDADE {priority} — {title} ({len(values)})'
        yield explanation
        yield border('┌', '┬', '┐')
        yield from block(['ID local', 'Nome informado', 'Nome retornado pela API', 'Diferenças observadas'])
        yield border('├', '┼', '┤')
        for index, row in enumerate(values):
            yield from block([row['_local_id'], row['nome'], row['nome_retornado'], row['motivo_analitico']])
            yield border('└', '┴', '┘') if index == len(values)-1 else border('├', '┼', '┤')
    yield f'\nFIM — {total} registros classificados, sem alteração de dados ou nova consulta.'


def main():
    _, grouped = grouped_rows()
    text = '\n'.join(report(grouped)) + '\n'
    pager = shutil.which('less') if sys.stdout.isatty() else None
    if pager:
        print('Setas ↑↓ e ←→ para navegar; q para sair.', flush=True)
        process = subprocess.Popen([pager, '-R', '-S', '-F', '-X'], stdin=subprocess.PIPE, text=True)
        process.communicate(text)
    else:
        print(text, end='')


if __name__ == '__main__':
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    except Exception as exc:
        print(f'Falha na análise ({type(exc).__name__}): {exc}', file=sys.stderr)
        sys.exit(1)
