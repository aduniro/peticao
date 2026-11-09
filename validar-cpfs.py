#!/usr/bin/env python3
"""Consult all recovered CPFs through the existing CPF-Brasil account on the VPS.

Authorized account usage may be billed by the provider. Application unchanged.
Run ./validar-cpfs.py. Use the same command to resume after a disconnect.
"""
import argparse
import ast
import base64
import csv
import datetime
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import sys
import tarfile
import time
import zipfile

PAYLOAD = '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'
ROOT = Path('/mnt/dev/cpfs')
STATE = ROOT / '.validacao-cpf-brasil.json'
HOST = 'peticao-root'
REMOTE = '/root/peticao-recovery/validacoes'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, content):
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('wb') as stream:
        stream.write(content)
    temporary.chmod(0o600)
    os.replace(temporary, path)


def persist(state):
    save(STATE, json.dumps(state, indent=2).encode())


def run(command, capture=False):
    result = subprocess.run(command, text=True, capture_output=capture)
    if result.returncode:
        if capture and result.stderr:
            print(result.stderr.strip(), file=sys.stderr)
        raise RuntimeError('Comando falhou; nenhuma nova tentativa automática')
    return result.stdout if capture else ''


def ssh(*args, capture=False):
    return run(['ssh', '-o', 'ConnectTimeout=15', HOST, shlex.join(args)], capture)


def bundle():
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(PAYLOAD))) as archive:
        result = {name: archive.read(name).decode() for name in archive.namelist()}
    if set(result) != {'cpf_compare.py', 'cpf_validation_worker.py', 'cycle_worker.py'}:
        raise RuntimeError('Pacote interno inválido')
    for name, content in result.items():
        ast.parse(content, filename=name)
    return result


def choose_sources():
    state_file = ROOT / '.atualizacao-em-andamento.json'
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if state.get('phase') != 'complete':
            raise RuntimeError('A recuperação mais recente ainda não está completa')
        source_id = state['id']
    else:
        suffixes = []
        for path in ROOT.glob('dados-completos-confirmadas-*.csv'):
            suffix = path.name[len('dados-completos-confirmadas-'):-4]
            if (ROOT / ('dados-completos-pendentes-' + suffix + '.csv')).is_file():
                suffixes.append(suffix)
        if not suffixes:
            raise RuntimeError('Não há um par de CSVs completos dos recuperados')
        source_id = max(suffixes)
    if not re.fullmatch(r'[0-9TZabcdef-]+', source_id):
        raise RuntimeError('Identificador de origem inválido')
    result = []
    for group in ('confirmadas', 'pendentes'):
        path = ROOT / f'dados-completos-{group}-{source_id}.csv'
        if path.is_symlink():
            raise RuntimeError('Link simbólico recusado')
        with path.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            if not {'nome', 'cpf', 'assinatura_id', 'email'} <= set(reader.fieldnames or []):
                raise RuntimeError('CSV não contém os campos esperados')
            count = sum(1 for _ in reader)
        result.append({'group': group, 'source_name': path.name, 'source': str(path),
                       'file': 'entrada-' + group + '.csv', 'rows': count, 'sha256': sha(path)})
    return result


def unpack_verified(archive_path, destination):
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tarfile.open(archive_path, 'r:gz') as archive:
        members = archive.getmembers()
        names = [m.name for m in members]
        if len(names) != len(set(names)):
            raise RuntimeError('Nomes duplicados no pacote')
        if any(not m.isfile() or Path(m.name).is_absolute() or '..' in Path(m.name).parts for m in members):
            raise RuntimeError('Caminho inseguro no pacote')
        manifest = json.load(archive.extractfile('manifest.json'))
        if set(names) != {r['file'] for r in manifest} | {'manifest.json'} or len(manifest) != len(set(r['file'] for r in manifest)):
            raise RuntimeError('Manifesto divergente')
        for record in manifest:
            data = archive.extractfile(record['file']).read()
            if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
                raise RuntimeError('Checksum divergente')
        for name in names:
            target = destination / name
            if target.is_symlink() or any(parent.is_symlink() for parent in target.parents):
                raise RuntimeError('Link simbólico no destino')
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            data = archive.extractfile(name).read()
            if target.exists():
                if target.read_bytes() != data:
                    raise RuntimeError('Arquivo anterior diferente; preservado')
            else:
                with target.open('xb') as stream:
                    stream.write(data)
                target.chmod(0o600)
    return manifest


def execute(scripts):
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    if not state or state.get('phase') == 'complete':
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        state = {'id': stamp + '-' + secrets.token_hex(3), 'phase': 'preparing', 'inputs': choose_sources()}
        persist(state)
    identifier = state['id']
    if not re.fullmatch(r'[0-9TZabcdef-]+', identifier):
        raise RuntimeError('Identificador inválido')
    staging = ROOT / '.validacoes' / identifier
    backup = ROOT / 'backups' / ('validacao-' + identifier)
    staging.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not state.get('backup_local'):
        for entry in state['inputs']:
            original = Path(entry['source'])
            if sha(original) != entry['sha256']:
                raise RuntimeError('A origem mudou desde a preparação')
            target = staging / entry['file']
            if not target.exists():
                save(target, original.read_bytes())
            if sha(target) != entry['sha256']:
                raise RuntimeError('Cópia local divergente')
            saved = backup / entry['source_name']
            if saved.exists() and sha(saved) != entry['sha256']:
                raise RuntimeError('Backup anterior diferente')
            if not saved.exists():
                save(saved, target.read_bytes())
        save(backup / 'inputs.json', json.dumps(state['inputs'], indent=2).encode())
        state['backup_local'] = True
        persist(state)
    print('Consulta de TODOS os CPFs pelo plano existente, inclusive eventual excedente autorizado.', flush=True)
    print('A chave ficará na VPS. Nenhum registro ou horário da aplicação será alterado.', flush=True)
    if ssh('id', '-u', capture=True).strip() != '0':
        raise RuntimeError('SSH sem acesso root')
    job = REMOTE + '/' + identifier
    worker = job + '/cpf_validation_worker.py'
    if not state.get('uploaded'):
        ssh('install', '-d', '-m', '700', job)
        paths = []
        for name, content in scripts.items():
            path = staging / name
            save(path, content.encode())
            paths.append(str(path))
        descriptor = staging / 'inputs.json'
        save(descriptor, json.dumps(state['inputs']).encode())
        paths += [str(descriptor)] + [str(staging / entry['file']) for entry in state['inputs']]
        run(['scp', *paths, HOST + ':' + job + '/'])
        state['uploaded'] = True
        persist(state)
    if not state.get('prepared'):
        info = json.loads(ssh('python3', worker, 'prepare', identifier, capture=True))
        print(f"Registros: {info['registros']}; CPFs distintos: {info['cpfs_distintos']}. Respostas em cache serão reutilizadas.", flush=True)
        archive = backup / 'backup-validacao-vps.tar.gz'
        run(['scp', HOST + ':' + job + '/backup-validacao.tar.gz', str(archive)])
        unpack_verified(archive, backup / 'vps')
        state['prepared'] = True
        persist(state)
    status = json.loads(ssh('python3', worker, 'status', identifier, capture=True))
    # After a partial batch, a deliberate rerun continues only unseen CPFs.
    # Previously attempted errors are preserved and never silently billed again.
    if not status.get('active') and status['phase'] != 'complete':
        ssh('python3', worker, 'launch', identifier)
    while True:
        status = json.loads(ssh('python3', worker, 'status', identifier, capture=True))
        print('Progresso: ' + json.dumps({k: v for k, v in status.items() if k != 'classificacao_por_registro'}, ensure_ascii=False), flush=True)
        if status['phase'] in ('complete', 'partial') and not status.get('active'):
            break
        if status['phase'] == 'failed' or not status.get('active'):
            raise RuntimeError('Serviço interrompido. Execute novamente para retomar sem repetir consultas já registradas')
        time.sleep(15)
    # A new folder allows a partial result to be downloaded again after continuation,
    # without overwriting the earlier partial exports or breaking their manifest.
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(2)
    downloaded = staging / ('download-' + stamp)
    downloaded.mkdir(mode=0o700)
    archive = downloaded / 'resultados-validacao.tar.gz'
    run(['scp', HOST + ':' + job + '/resultados-validacao.tar.gz', str(archive)])
    manifest = unpack_verified(archive, downloaded / 'arquivos')
    expected = {'comparacao-cpf-brasil-todas.csv', 'comparacao-cpf-brasil-confirmadas.csv',
                'comparacao-cpf-brasil-pendentes.csv', 'comparacao-cpf-brasil.sqlite', 'resumo.json'}
    if {r['file'] for r in manifest} != expected:
        raise RuntimeError('Pacote de resultados incompleto')
    saved_manifest = []
    for record in manifest:
        source = downloaded / 'arquivos' / record['file']
        target = ROOT / (source.stem + '-' + identifier + '-' + stamp + source.suffix)
        with target.open('xb') as out, source.open('rb') as stream:
            for block in iter(lambda: stream.read(1024*1024), b''):
                out.write(block)
        target.chmod(0o600)
        if sha(target) != record['sha256']:
            raise RuntimeError('Resultado local divergente')
        saved_manifest.append(dict(record, file=target.name))
        print('Salvo: ' + str(target), flush=True)
    save(ROOT / ('manifest-validacao-' + identifier + '-' + stamp + '.json'), json.dumps(saved_manifest, indent=2).encode())
    state['phase'] = status['phase']
    state['last_status'] = status
    persist(state)
    print('CONCLUÍDO: consultas e tabelas baixadas.' if status['phase'] == 'complete'
          else 'PARCIAL: tabelas baixadas com pendências/erros explicitamente identificados.', flush=True)
    print('Nomes da fonte privada são sugestões para revisão; não houve validação governamental nem alteração de assinaturas.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    scripts = bundle()
    if args.check:
        print('OK: arquivo único válido; nenhuma consulta, leitura de segredo ou alteração de dados.')
        return
    os.umask(0o077)
    if not ROOT.is_dir() or ROOT.is_symlink():
        raise RuntimeError('Pasta /mnt/dev/cpfs ausente ou inválida')
    lock = os.open(ROOT / '.validacao-cpf-brasil.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        execute(scripts)
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nAcompanhamento fechado; o serviço já iniciado continua na VPS. Execute o mesmo comando para retomar.')
        sys.exit(130)
    except Exception as exc:
        print(f'Execução interrompida ({type(exc).__name__}): {exc}', file=sys.stderr)
        print('Dados originais preservados. Nenhum segredo precisa ser enviado à conversa.', file=sys.stderr)
        sys.exit(1)
