#!/usr/bin/env python3
"""Isolated CPF-Brasil queries. Never imports or writes to the application."""
import collections
import csv
import datetime
import fcntl
import io
import json
import os
from pathlib import Path
import re
import resource
import shlex
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

from cpf_compare import COMPARISON_COLUMNS, compare, cpf_valid
from cycle_worker import backup_file, package, save

BASE = Path('/root/peticao-recovery')
CACHE = BASE / 'validacao-cpf-brasil-cache.sqlite'
ENDPOINT = 'https://api.cpf-brasil.org/cpf/'
EXTRA = [
    'grupo_assinatura', 'arquivo_origem', 'consulta_status', 'consulta_erro_codigo',
    'consulta_em', 'fonte_consulta', 'cpf_digitos_validos', 'cpf_retornado', 'cpf_confere', 'nome_retornado',
    'nome_sugerido_para_revisao', 'nascimento_retornado', 'nascimento_formato_valido',
    'nome_mae_retornado', 'sexo_retornado', 'sexo_normalizado', 'campos_nao_retornados', 'nascimento_confere',
    'nome_mae_confere', 'sexo_confere', *COMPARISON_COLUMNS, 'verificacao_governamental',
]
TERMINAL = {'ok', 'nao_encontrado', 'cpf_entrada_invalido'}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_key(path=Path('/etc/peticao/app.env')):
    values = []
    for line in path.read_text().splitlines():
        name, sep, raw = line.strip().partition('=')
        if sep and name == 'CPF_BRASIL_API_KEY':
            tokens = shlex.split(raw, comments=True)
            if len(tokens) != 1 or not tokens[0].strip():
                raise RuntimeError('Chave ausente ou configuração não suportada')
            values.append(tokens[0])
    if len(values) != 1:
        raise RuntimeError('Chave ausente ou duplicada em app.env')
    return values[0]


def load_inputs(job):
    info = json.loads((job / 'inputs.json').read_text())
    records, headers = [], None
    for entry in info:
        if entry['group'] not in ('confirmadas', 'pendentes') or entry['file'] != 'entrada-' + entry['group'] + '.csv':
            raise RuntimeError('Arquivo de entrada não permitido')
        path = job / entry['file']
        from cycle_worker import sha
        if sha(path) != entry['sha256']:
            raise RuntimeError('Checksum da entrada divergente')
        with path.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            current = reader.fieldnames
            if not current or len(set(current)) != len(current) or not {'assinatura_id', 'nome', 'cpf', 'email'} <= set(current) or set(current) & set(EXTRA):
                raise RuntimeError('Esquema de entrada inválido')
            if headers is None:
                headers = current
            if headers != current:
                raise RuntimeError('Esquemas diferentes nos grupos')
            count, seen = 0, set()
            for row in reader:
                if None in row or any(v is None for v in row.values()) or not row['assinatura_id'].isdigit():
                    raise RuntimeError('Linha CSV inválida')
                if row['assinatura_id'] in seen:
                    raise RuntimeError('ID duplicado no grupo')
                seen.add(row['assinatura_id'])
                records.append((entry['group'], entry['source_name'], row))
                count += 1
        if count != entry['rows']:
            raise RuntimeError('Contagem da entrada divergente')
    if len(info) != 2 or {r['group'] for r in info} != {'confirmadas', 'pendentes'}:
        raise RuntimeError('Dois grupos de entrada são obrigatórios')
    return headers, records


def open_cache():
    if CACHE.is_symlink():
        raise RuntimeError('Link simbólico recusado')
    fd = os.open(CACHE, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    os.close(fd)
    conn = sqlite3.connect(CACHE)
    conn.execute('''CREATE TABLE IF NOT EXISTS lookups (
      cpf TEXT PRIMARY KEY, status TEXT NOT NULL, name TEXT, birth TEXT,
      mother TEXT, sex TEXT, returned_cpf TEXT, http_status INTEGER,
      error_code TEXT, queried_at TEXT NOT NULL)''')
    conn.commit()
    return conn


def get_record(conn, cpf):
    conn.row_factory = sqlite3.Row
    row = conn.execute('SELECT * FROM lookups WHERE cpf=?', (cpf,)).fetchone()
    return dict(row) if row else None


def store(conn, record):
    fields = ['cpf', 'status', 'name', 'birth', 'mother', 'sex', 'returned_cpf', 'http_status', 'error_code', 'queried_at']
    conn.execute('INSERT OR REPLACE INTO lookups VALUES (' + ','.join('?' for _ in fields) + ')', [record.get(k) for k in fields])
    conn.commit()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        # Do not forward the API key to any redirect target.
        return None


def fetch(cpf, key, opener=None):
    record = dict(cpf=cpf, status='erro_consulta', queried_at=now())
    request = urllib.request.Request(ENDPOINT + cpf, headers={'X-API-Key': key, 'Accept': 'application/json'})
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    code, body = None, {}
    try:
        with opener.open(request, timeout=20) as response:
            code = response.status
            raw = response.read(1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        code = exc.code
        try:
            raw = exc.read(1024 * 1024 + 1)
        finally:
            exc.close()
    except Exception:
        return dict(record, status='erro_indeterminado', error_code='NETWORK_OR_TIMEOUT'), True
    record['http_status'] = code
    if len(raw) <= 1024 * 1024:
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError):
            pass
    if not isinstance(body, dict):
        body = {}
    error_code = body.get('code')
    error_code = error_code if isinstance(error_code, str) and re.fullmatch(r'[A-Z0-9_]{1,80}', error_code) else f'HTTP_{code}'
    if code == 404 or error_code == 'CPF_NOT_FOUND':
        return dict(record, status='nao_encontrado', error_code='CPF_NOT_FOUND'), False
    if code != 200 or body.get('success') is False:
        return dict(record, error_code=error_code), True
    data = body.get('data', body)
    if not isinstance(data, dict):
        return dict(record, error_code='INVALID_RESPONSE'), True
    def text(field, limit=500):
        value = data.get(field, data.get(field.lower()))
        return value.strip()[:limit] if isinstance(value, str) and value.strip() else None
    echo = text('CPF', 32)
    if echo is not None:
        echo = re.sub(r'[^0-9]', '', echo)
        if echo != cpf:
            return dict(record, status='resposta_cpf_divergente', returned_cpf=echo, error_code='CPF_RESPONSE_MISMATCH'), True
    name = text('NOME')
    if not name:
        return dict(record, error_code='EMPTY_NAME'), True
    return dict(record, status='ok', name=name, birth=text('NASC', 32), mother=text('NOME_MAE'),
                sex=text('SEXO', 100), returned_cpf=echo, error_code=None), False


def build_row(group, filename, original, lookup):
    result = dict(original)
    result.update(dict.fromkeys(EXTRA, ''))
    result.update(grupo_assinatura=group, arquivo_origem=filename,
                  fonte_consulta='CPF-Brasil (fornecedor privado)', verificacao_governamental='nao_realizada',
                  cpf_digitos_validos='sim' if cpf_valid(original['cpf']) else 'nao',
                  nascimento_confere='nao_comparavel_nao_coletado', nome_mae_confere='nao_comparavel_nao_coletado',
                  sexo_confere='nao_comparavel_nao_coletado', nome_classificacao='nao_consultado',
                  nome_confere='inconclusivo', indicacao_titularidade='nao_determinado', revisao_necessaria='sim')
    if not lookup:
        result['consulta_status'] = 'nao_consultado'
        return result
    result.update(consulta_status=lookup['status'], consulta_erro_codigo=lookup.get('error_code') or '',
                  consulta_em=lookup['queried_at'], cpf_retornado=lookup.get('returned_cpf') or '')
    if lookup['status'] != 'ok':
        result['nome_classificacao'] = 'inconclusivo_consulta_sem_resultado'
        if lookup['status'] == 'resposta_cpf_divergente':
            result['cpf_confere'] = 'nao'
        return result
    result.update(nome_retornado=lookup.get('name') or '', nascimento_retornado=lookup.get('birth') or '',
                  nome_mae_retornado=lookup.get('mother') or '', sexo_retornado=lookup.get('sex') or '',
                  cpf_confere='sim' if lookup.get('returned_cpf') else 'nao_retornado_pelo_provedor')
    result['campos_nao_retornados'] = ', '.join(label for field, label in [('returned_cpf', 'CPF'), ('name', 'NOME'),
                                                                              ('birth', 'NASC'), ('mother', 'NOME_MAE'), ('sex', 'SEXO')]
                                               if not lookup.get(field))
    sex = (lookup.get('sex') or '').casefold()
    result['sexo_normalizado'] = {'m': 'Masculino', 'masculino': 'Masculino', 'male': 'Masculino',
                                 'f': 'Feminino', 'feminino': 'Feminino', 'female': 'Feminino'}.get(sex, 'nao_informado_ou_nao_reconhecido')
    if lookup.get('birth'):
        try:
            birth = datetime.datetime.strptime(lookup['birth'], '%d/%m/%Y').date()
            result['nascimento_formato_valido'] = 'sim' if birth <= datetime.date.today() else 'nao'
        except ValueError:
            result['nascimento_formato_valido'] = 'nao'
    result.update(compare(original['nome'], lookup['name']))
    if result['nome_confere'] != 'sim':
        result['nome_sugerido_para_revisao'] = lookup['name']
    return result


def export_results(job, headers, records, conn):
    directory = job / 'resultados'
    directory.mkdir(exist_ok=True, mode=0o700)
    columns = headers + EXTRA
    results = [build_row(group, filename, original, get_record(conn, original['cpf'])) for group, filename, original in records]
    files = []
    for group in ('todas', 'confirmadas', 'pendentes'):
        selected = results if group == 'todas' else [r for r in results if r['grupo_assinatura'] == group]
        out = io.StringIO(newline='')
        writer = csv.DictWriter(out, fieldnames=columns)
        writer.writeheader()
        writer.writerows(selected)
        parsed = list(csv.DictReader(io.StringIO(out.getvalue())))
        if len(parsed) != len(selected) or any(a['cpf'] != b['cpf'] or a['nome'] != b['nome'] or any(a[h] != b[h] for h in headers) for a, b in zip(parsed, selected)):
            raise RuntimeError('Verificação da exportação falhou')
        target = directory / f'comparacao-cpf-brasil-{group}.csv'
        save(target, out.getvalue().encode('utf-8-sig'))
        files.append(target)
    # Results database is restricted to this input cohort, not the global cache.
    target = directory / 'comparacao-cpf-brasil.sqlite'
    temporary = target.with_suffix('.tmp')
    temporary.unlink(missing_ok=True)
    with sqlite3.connect(temporary) as output:
        output.execute('CREATE TABLE resultados (linha INTEGER PRIMARY KEY,grupo TEXT,assinatura_id TEXT,cpf TEXT,dados_json TEXT NOT NULL)')
        output.executemany('INSERT INTO resultados VALUES (?,?,?,?,?)',
                          [(i, r['grupo_assinatura'], r['assinatura_id'], r['cpf'], json.dumps(r, ensure_ascii=False)) for i, r in enumerate(results, 1)])
        if output.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('SQLite de resultados inválido')
    temporary.chmod(0o600)
    os.replace(temporary, target)
    files.append(target)
    unique = {original['cpf'] for _, _, original in records}
    statuses = collections.Counter((get_record(conn, cpf) or {}).get('status', 'nao_consultado') for cpf in unique)
    summary = {'registros': len(results), 'cpfs_distintos': len(unique), 'status_por_cpf': dict(statuses),
               'classificacao_por_registro': dict(collections.Counter(r['nome_classificacao'] for r in results)),
               'verificacao_governamental': 'nao_realizada'}
    summary['phase'] = 'complete' if sum(statuses[s] for s in TERMINAL) == len(unique) else 'partial'
    save(directory / 'resumo.json', json.dumps(summary, ensure_ascii=False, indent=2).encode())
    files.append(directory / 'resumo.json')
    package(directory, files, job / 'resultados-validacao.tar.gz')
    return summary


def state(job, info):
    save(job / 'status.json', json.dumps(info).encode())


def work(job):
    headers, records = load_inputs(job)
    lock = os.open(str(CACHE) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    cache = None
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        cache = open_cache()
        process(job, headers, records, cache)
    finally:
        if cache is not None:
            cache.close()
        os.close(lock)


def process(job, headers, records, cache):
    key = None
    stop = False
    def request_stop(*_):
        nonlocal stop
        stop = True
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    unique = list(dict.fromkeys(original['cpf'] for _, _, original in records))
    made = 0
    for index, cpf in enumerate(unique):
        if stop:
            break
        prior = get_record(cache, cpf)
        if prior:
            # Never automatically repeat paid or interrupted calls. Errors remain
            # visible for explicit subsequent review, rather than guessed results.
            continue
        if not cpf_valid(cpf):
            store(cache, dict(cpf=cpf, status='cpf_entrada_invalido', queried_at=now(), error_code='INVALID_CPF_DIGITS'))
            continue
        if key is None:
            key = read_key()
        # Durable intent before sending: hard termination must not cause a duplicate charge.
        store(cache, dict(cpf=cpf, status='consulta_interrompida_ou_indeterminada', queried_at=now(), error_code='REQUEST_OUTCOME_UNKNOWN'))
        result, halt = fetch(cpf, key)
        store(cache, result)
        made += 1
        progress = {'phase': 'running', 'percorridos': index+1, 'total_cpfs': len(unique), 'novas_consultas': made}
        state(job, progress)
        print(f'CPFs percorridos: {index+1}/{len(unique)}; novas consultas nesta execução: {made}; resposta: {result["status"]}.', flush=True)
        if halt:
            print('Consulta interrompida após erro do provedor/rede. Código: ' + str(result.get('error_code', 'UNKNOWN')), flush=True)
            break
        time.sleep(1)
    summary = export_results(job, headers, records, cache)
    summary['novas_consultas_nesta_execucao'] = made
    summary['interrompido_pelo_operador'] = stop
    state(job, summary)


def main():
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if os.geteuid() != 0:
        raise RuntimeError('Execute na VPS como root')
    phase, run_id = sys.argv[1:]
    if not re.fullmatch(r'[0-9TZabcdef-]+', run_id):
        raise RuntimeError('Identificador inválido')
    job = Path(__file__).resolve().parent
    unit = 'cpf-validation-' + run_id
    if phase == 'prepare':
        headers, records = load_inputs(job)
        directory = job / 'backup-anterior'
        directory.mkdir(exist_ok=True, mode=0o700)
        files = []
        if CACHE.exists():
            target = directory / CACHE.name
            backup_file(CACHE, target)
            files.append(target)
        package(directory, files, job / 'backup-validacao.tar.gz')
        # Merely verify that a key is configured; no request and no printed value.
        read_key()
        print(json.dumps({'registros': len(records), 'cpfs_distintos': len({r[2]['cpf'] for r in records}), 'colunas_originais': len(headers)}))
    elif phase == 'launch':
        if subprocess.run(['systemctl', 'is-active', '--quiet', unit], capture_output=True).returncode:
            state(job, {'phase': 'starting'})
            subprocess.run(['systemd-run', '--unit=' + unit, '--collect', '--property=CPUQuota=25%',
                            '--property=MemoryMax=512M', '--property=UMask=0077', '--property=TimeoutStopSec=45',
                            '/usr/bin/python3', str(Path(__file__).resolve()), 'work', run_id], check=True)
    elif phase == 'work':
        try:
            work(job)
        except Exception as exc:
            state(job, {'phase': 'failed', 'error_type': type(exc).__name__})
            raise
    elif phase == 'status':
        info = json.loads((job / 'status.json').read_text()) if (job / 'status.json').exists() else {'phase': 'waiting'}
        info['active'] = subprocess.run(['systemctl', 'is-active', '--quiet', unit], capture_output=True).returncode == 0
        print(json.dumps(info))
    else:
        raise RuntimeError('Ação inválida')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Falha na validação ({type(exc).__name__}); dados pessoais e credenciais omitidos.', file=sys.stderr)
        sys.exit(1)
