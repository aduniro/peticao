#!/usr/bin/env python3
"""Read-only inspection of CPF-Brasil validation; never starts queries or jobs."""
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys

REMOTE_CODE = r'''
import collections,csv,json,sqlite3,subprocess,sys
from pathlib import Path
from urllib.parse import quote
run_id=sys.argv[1]
base=Path('/root/peticao-recovery')
job=base/'validacoes'/run_id
cache=base/'validacao-cpf-brasil-cache.sqlite'
service='cpf-validation-'+run_id
status=subprocess.run(['systemctl','show',service,'--property=ActiveState,SubState,Result','--no-pager'],capture_output=True,text=True)
print('SERVICO:',service)
print(status.stdout.strip() or 'Nenhum estado disponível para o serviço.')
print('CACHE:',cache)
print('RESULTADOS:',job/'resultados')
print('PACOTE_FINAL_EXISTE:',(job/'resultados-validacao.tar.gz').is_file())
state_path=job/'status.json'
if state_path.exists():
 d=json.loads(state_path.read_text())
 print('ESTADO_GRAVADO:',json.dumps({k:d[k] for k in ('phase','error_type','novas_consultas','total_cpfs','registros','cpfs_distintos') if k in d},ensure_ascii=False))
cpfs=set()
for group in ('confirmadas','pendentes'):
 p=job/('entrada-'+group+'.csv')
 if p.exists():
  with p.open(encoding='utf-8-sig',newline='') as f:
   cpfs.update(r['cpf'] for r in csv.DictReader(f))
if cpfs and cache.is_file():
 conn=sqlite3.connect('file:'+quote(str(cache),safe='/')+'?mode=ro',uri=True,timeout=10)
 counts=collections.Counter()
 latest=None
 try:
  conn.execute('PRAGMA query_only=ON')
  conn.execute('BEGIN')
  for cpf in cpfs:
   row=conn.execute('SELECT status,queried_at FROM lookups WHERE cpf=?',(cpf,)).fetchone()
   counts[row[0] if row else 'nao_consultado']+=1
   if row and row[1] and (latest is None or row[1]>latest): latest=row[1]
 finally: conn.close()
 print('CPFS_DISTINTOS_DO_GRUPO:',len(cpfs))
 print('PROGRESSO_REAL_NO_CACHE:',json.dumps(dict(counts),ensure_ascii=False))
 print('ULTIMA_TENTATIVA_UTC:',latest)
else:
 print('Ainda não há cache consultável para este grupo.')
print('INSPECAO_CONCLUIDA: somente leitura; nenhuma consulta à API ou alteração de serviço.')
'''


def main():
    state_file = Path('/mnt/dev/cpfs/.validacao-cpf-brasil.json')
    state = json.loads(state_file.read_text())
    identifier = state['id']
    if not re.fullmatch(r'[0-9TZabcdef-]+', identifier):
        raise RuntimeError('Identificador inválido')
    print('Execução local:', identifier, flush=True)
    command = shlex.join(['python3', '-', identifier])
    result = subprocess.run(['ssh', '-o', 'ConnectTimeout=15', 'peticao-root', command], input=REMOTE_CODE, text=True)
    if result.returncode:
        raise RuntimeError('A inspeção SSH não foi concluída')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Falha na inspeção ({type(exc).__name__}); nenhum dado foi alterado.', file=sys.stderr)
        sys.exit(1)
