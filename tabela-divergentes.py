#!/usr/bin/env python3
"""Readable side-by-side terminal table of divergent names; no API calls."""
import argparse
import csv
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
import unicodedata
from urllib.parse import quote
from zoneinfo import ZoneInfo

ROOT = Path('/mnt/dev/cpfs')
MUNICIPALITIES = Path('/mnt/dev/peticao/site/public/data/municipios.json')
HEADERS = ['ID\nlocal', 'Nº\ninscrição', 'Cadastro\ndata/hora', 'Categoria\nassinatura', 'Nome informado',
           'Instituição', 'Campus', 'UF', 'Cidade', 'Checkbox\nregião', 'Nome retornado pela API']
BASE_WIDTHS = [5, 9, 10, 10, 24, 11, 16, 2, 15, 8, 27]

REMOTE_CODE = r'''
import json,re,shlex,subprocess,sys
from pathlib import Path
from urllib.parse import urlparse,unquote
try:
 ids=json.load(sys.stdin)
 if not isinstance(ids,list) or not ids or len(ids)>20000 or any(type(v)is not int or v<=0 for v in ids): raise ValueError()
 urls=[]
 for line in Path('/etc/peticao/app.env').read_text().splitlines():
  name,sep,raw=line.strip().partition('=')
  if sep and name=='DATABASE_URL':
   values=shlex.split(raw,comments=True)
   if len(values)!=1: raise ValueError()
   urls.append(values[0])
 if len(urls)!=1: raise ValueError()
 uri=urlparse(urls[0]); database=unquote(uri.path.lstrip('/'))
 if uri.scheme not in ('postgres','postgresql') or uri.hostname not in ('localhost','127.0.0.1','::1') or not re.fullmatch(r'[A-Za-z0-9_-]+',database): raise ValueError()
 sql="BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SELECT coalesce(json_agg(row_to_json(r)),'[]'::json) FROM (SELECT id,seq FROM signatures WHERE id=ANY(ARRAY["+','.join(map(str,ids))+"]) ORDER BY id) r; COMMIT;"
 result=subprocess.run(['/usr/sbin/runuser','-u','postgres','--','/usr/bin/psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-p',str(uri.port or 5432),'-d',database],input=sql,capture_output=True,text=True,timeout=40,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
 if result.returncode: raise RuntimeError()
 rows=json.loads(result.stdout)
 print(json.dumps(rows))
except Exception:
 print('Não foi possível ler os números de inscrição; nenhum dado foi alterado.',file=sys.stderr)
 sys.exit(1)
'''


def safe(value):
    return ''.join(' ' if unicodedata.category(c).startswith('C') or c in '\u2028\u2029' else c for c in str(value))


def visible_width(text):
    return sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in ('W', 'F') else 1 for c in text)


def wrap(text, width):
    lines = []
    for paragraph in str(text).split('\n'):
        words = paragraph.split()
        line = ''
        for word in words:
            if line and visible_width(line + ' ' + word) > width:
                lines.append(line)
                line = ''
            part = ''
            for char in word:
                if visible_width(part + char) > width:
                    if line:
                        lines.append(line)
                        line = ''
                    lines.append(part)
                    part = ''
                part += char
            if line and visible_width(line + ' ' + part) <= width:
                line += ' ' + part
            else:
                if line:
                    lines.append(line)
                line = part
        lines.append(line)
    return lines or ['']


def load_rows():
    manifests = sorted(ROOT.glob('manifest-validacao-*.json'))
    if not manifests:
        raise RuntimeError('Resultados de validação não encontrados')
    entries = json.loads(manifests[-1].read_text())
    def verified(predicate):
        found = [r for r in entries if predicate(r['file'])]
        if len(found) != 1 or Path(found[0]['file']).name != found[0]['file']:
            raise RuntimeError('Manifesto inválido')
        path = ROOT / found[0]['file']
        if path.is_symlink():
            raise RuntimeError('Link simbólico recusado')
        with path.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != found[0]['sha256']:
                raise RuntimeError('Checksum divergente')
        return path
    source = verified(lambda name: name.startswith('comparacao-cpf-brasil-todas-') and name.endswith('.csv'))
    database = verified(lambda name: name.endswith('.sqlite'))
    with source.open(encoding='utf-8-sig', newline='') as stream:
        rows = [row for row in csv.DictReader(stream) if row['nome_confere'] == 'nao']
    conn = sqlite3.connect('file:' + quote(str(database), safe='/') + '?mode=ro', uri=True)
    try:
        conn.execute('PRAGMA query_only=ON')
        mapping = {(group, sid): (line, cpf) for line, group, sid, cpf in conn.execute('SELECT linha,grupo,assinatura_id,cpf FROM resultados')}
    finally:
        conn.close()
    for row in rows:
        key = (row['grupo_assinatura'], row['assinatura_id'])
        if key not in mapping or mapping[key][1] != row['cpf']:
            raise RuntimeError('IDs locais não correspondem ao CSV')
        row['_local_id'] = str(mapping[key][0])
    return source, rows


def registrations(rows):
    ids = sorted({int(row['assinatura_id']) for row in rows})
    if not ids:
        return {}, 'Sem registros divergentes.'
    try:
        command = shlex.join(['python3', '-c', REMOTE_CODE])
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'peticao-root', command],
                                input=json.dumps(ids), text=True, capture_output=True, timeout=55)
        if result.returncode:
            raise RuntimeError()
        response = json.loads(result.stdout)
        if not isinstance(response, list):
            raise RuntimeError()
        values = {}
        for item in response:
            if type(item['id']) is not int or item['id'] not in ids or (item['seq'] is not None and type(item['seq']) is not int):
                raise RuntimeError()
            if item['id'] in values:
                raise RuntimeError()
            values[item['id']] = item['seq']
        return values, 'Números públicos de inscrição consultados na VPS, somente leitura, no momento da exibição.'
    except Exception:
        return {}, 'Sem acesso à VPS: Nº inscrição = N/D. O campo seq não consta no CSV; nenhum ID foi usado em seu lugar.'


def date_text(value):
    if not value:
        return '—'
    try:
        date = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if date.tzinfo is None:
            return safe(value)
        return date.astimezone(ZoneInfo('America/Sao_Paulo')).strftime('%d/%m/%Y\n%H:%M:%S')
    except ValueError:
        return safe(value)


def cells(row, numbers, municipalities):
    sid = int(row['assinatura_id'])
    number = numbers.get(sid, 'N/D')
    number = '—' if number is None else str(number)
    location = municipalities.get(str(row.get('campus_ibge') or row.get('municipio_ibge') or ''), ('', ''))
    city, uf = row.get('municipio') or location[0], row.get('uf') or location[1]
    checkbox = {'true': '☑ Sim', 'false': '☐ Não', '': '— N/A'}.get(row.get('regiao_declarada', ''), '?')
    category = {'servidor': 'Servidor', 'apoiador': 'Apoiador', 'estrangeiro': 'Exterior'}.get(row['categoria'], row['categoria'])
    group = {'confirmadas': 'Confirmada', 'pendentes': 'Pendente'}.get(row['grupo_assinatura'], row['grupo_assinatura'])
    return [row['_local_id'], number, date_text(row.get('criado_em', '')), category + '\n' + group,
            safe(row['nome']), safe(row.get('instituicao') or '—'), safe(row.get('campus') or '—'),
            safe(uf or '—'), safe(city or '—'), checkbox, safe(row.get('nome_retornado') or '—')]


def draw(rows, numbers, municipalities, width, color=False):
    widths = BASE_WIDTHS.copy()
    extra = max(0, min(width, 245) - (sum(widths) + len(widths)*3 + 1))
    for index in range(extra):
        widths[[4, 10, 6, 8, 5][index % 5]] += 1
    def tint(text, style):
        return '\x1b[' + style + 'm' + text + '\x1b[0m' if color else text
    def border(left, middle, right):
        return tint(left + middle.join('─'*(w+2) for w in widths) + right, '90')
    def row_lines(values, header=False, alternate=False):
        columns = [wrap(value, w) for value, w in zip(values, widths)]
        for line in range(max(map(len, columns))):
            parts = []
            for index, (column, w) in enumerate(zip(columns, widths)):
                text = column[line] if line < len(column) else ''
                text += ' '*(w-visible_width(text))
                if header:
                    text = tint(text, '1;36')
                elif index == 4:
                    text = tint(text, '33')
                elif index == 10:
                    text = tint(text, '32')
                elif alternate:
                    text = tint(text, '37')
                parts.append(' ' + text + ' ')
            yield '│' + '│'.join(parts) + '│'
    yield tint(f'NOMES DIVERGENTES — {len(rows)} registros', '1;36')
    relevant = sum(r['nome_classificacao'] == 'divergencia_relevante' for r in rows)
    strong = sum(r['nome_classificacao'] == 'divergencia_forte' for r in rows)
    yield f'Divergência relevante: {relevant}; divergência forte: {strong}. A classificação não comprova CPF de outra pessoa.'
    yield 'Nome informado em amarelo; nome da API em verde. Cores não significam aprovação.'
    yield 'Data/hora = criação do cadastro, horário de Brasília. Checkbox = declaração de lotação na região.'
    yield 'ID local = coluna linha do SQLite de comparação. Nº inscrição = seq público exibido no PDF.'
    yield 'UF/cidade: valor cadastrado ou município do código IBGE de campus/cidade; não se presume sede da instituição.'
    yield 'N/D = indisponível; — na inscrição = registro sem numeração pública; N/A = checkbox não aplicável.'
    yield border('┌', '┬', '┐')
    yield from row_lines(HEADERS, header=True)
    yield border('├', '┼', '┤')
    for index, row in enumerate(rows):
        yield from row_lines(cells(row, numbers, municipalities), alternate=bool(index % 2))
        yield border('└', '┴', '┘') if index == len(rows)-1 else border('├', '┼', '┤')
    if not rows:
        yield border('└', '┴', '┘')
    yield f'FIM — {len(rows)} registros. Todos os nomes foram preservados integralmente, com quebra de linha.'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sem-vps', action='store_true', help='Use only local files; public seq will be unavailable')
    parser.add_argument('--sem-paginacao', action='store_true')
    args = parser.parse_args()
    source, rows = load_rows()
    numbers, note = ({}, 'Consulta de inscrições na VPS desativada.') if args.sem_vps else registrations(rows)
    municipalities = {str(code): (name, uf) for code, name, uf in json.loads(MUNICIPALITIES.read_text())}
    width = max(175, shutil.get_terminal_size().columns)
    interactive = sys.stdout.isatty()
    color = interactive and 'NO_COLOR' not in os.environ
    lines = [safe(note), 'Fonte: ' + source.name]
    lines.extend(draw(rows, numbers, municipalities, width, color))
    pager = shutil.which('less') if interactive and not args.sem_paginacao else None
    if pager:
        print('Tabela completa: setas ↑↓ e ←→ para navegar; q para sair.', flush=True)
        process = subprocess.Popen([pager, '-R', '-S', '-F', '-X'], stdin=subprocess.PIPE, text=True)
        try:
            process.communicate('\n'.join(lines) + '\n')
        except BrokenPipeError:
            pass
    else:
        print('\n'.join(lines))


if __name__ == '__main__':
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    except Exception as exc:
        print(f'Falha na tabela ({type(exc).__name__}): {exc}', file=sys.stderr)
        sys.exit(1)
