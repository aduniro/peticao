#!/usr/bin/env python3
"""Receive verified read-only VPS snapshots. Never sends decisions or calls a CPF API."""
import datetime,fcntl,hashlib,json,os,shutil,sqlite3,subprocess,tarfile
from pathlib import Path
from data import BASE,ingest,stats
REMOTE_EXPORT='/root/peticao-recovery/cache-deploys/cache-20261106T113425Z/export-review.py'
SSH=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','peticao-root']
FILES={'signatures.json','cache.json','recuperacao.sqlite','consultas.sqlite'}
class SyncBusy(RuntimeError):pass
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def read_state():
 try:return json.loads((BASE/'sync-state.json').read_text())
 except (OSError,ValueError):return {}
def write_state(state):
 temp=BASE/'sync-state.tmp';temp.write_text(json.dumps(state,ensure_ascii=False,indent=2));temp.replace(BASE/'sync-state.json')
def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def validate_archive(path,target,expected):
 if sha(path)!=expected:raise RuntimeError('Integridade do pacote de atualização divergente.')
 with tarfile.open(path) as archive:
  members=archive.getmembers()
  if len(members)>5 or any(not m.isfile() or m.name not in FILES|{'manifest.json'} or m.size>100_000_000 for m in members):raise RuntimeError('Conteúdo inesperado na atualização.')
  archive.extractall(target,filter='data')
 manifest=json.loads((target/'manifest.json').read_text())
 if not isinstance(manifest,list) or not 2<=len(manifest)<=4:raise RuntimeError('Manifesto de atualização inválido.')
 names=[item['file'] for item in manifest]
 if len(names)!=len(set(names)) or not {'signatures.json','cache.json'}.issubset(names):raise RuntimeError('Arquivos obrigatórios ausentes.')
 for item in manifest:
  if item['file'] not in FILES:raise RuntimeError('Caminho de atualização recusado.')
  member=target/item['file']
  if member.stat().st_size!=item['bytes'] or sha(member)!=item['sha256']:raise RuntimeError('Integridade dos dados divergente.')
  member.chmod(0o600)
 return set(names)
def sync():
 os.umask(0o077);BASE.mkdir(parents=True,exist_ok=True,mode=0o700);(BASE/'fontes').mkdir(mode=0o700,exist_ok=True)
 lock=(BASE/'.sync.lock').open('a')
 try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:lock.close();raise SyncBusy('Já existe uma atualização em andamento.')
 state=read_state();name=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 remote='/root/peticao-recovery/revisao-exports/'+name;local=BASE/'fontes'/name
 try:
  state.update(state='checking',last_attempt_at=now(),interval_seconds=int(os.environ.get('CPF_REVIEW_SYNC_INTERVAL','30')));write_state(state)
  previous=state.get('fingerprint','');static=state.get('static_id','')
  if len(previous)!=64 or any(c not in '0123456789abcdef' for c in previous):previous='-'
  if len(static)!=64 or any(c not in '0123456789abcdef' for c in static):static='-'
  p=subprocess.run(SSH+['python3 '+REMOTE_EXPORT+' '+remote+' '+previous+' '+static],capture_output=True,text=True,timeout=90)
  if p.returncode:raise RuntimeError('A VPS não respondeu à atualização somente leitura.')
  report=json.loads(p.stdout)
  if report.get('read_only') is not True:raise RuntimeError('A fonte não confirmou a transação somente leitura.')
  if not report['changed']:
   state.update(state='online',last_checked_at=now(),last_success_at=now(),last_source_at=report['source_at'],validation_version=report['validation_version'],build_id=report.get('build_id'),last_changed_records=0,error=None)
   write_state(state);return dict(stats(),sync=state)
  local.mkdir(mode=0o700)
  p=subprocess.run(['scp','-q','-o','BatchMode=yes','-o','ConnectTimeout=10','peticao-root:'+remote+'/fontes.tar.gz',str(local/'fontes.tar.gz')],capture_output=True,timeout=120)
  if p.returncode:raise RuntimeError('Não foi possível baixar a atualização da VPS.')
  names=validate_archive(local/'fontes.tar.gz',local,report['archive_sha256'])
  previous_source=None
  if (BASE/'fonte-atual.json').exists():previous_source=Path(json.loads((BASE/'fonte-atual.json').read_text())['directory'])
  for name in ('recuperacao.sqlite','consultas.sqlite'):
   if name not in names:
    if not previous_source or not (previous_source/name).is_file() or report.get('static_id')!=state.get('static_id'):raise RuntimeError('Base histórica estática indisponível.')
    os.link(previous_source/name,local/name)
   with sqlite3.connect((local/name).as_uri()+'?mode=ro',uri=True) as c:
    if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Base histórica com integridade divergente.')
  signatures=json.loads((local/'signatures.json').read_text())
  if signatures.get('read_only') is not True or signatures.get('at')!=report['source_at']:raise RuntimeError('Snapshot inconsistente.')
  result=ingest(local)
  temp=BASE/'fonte-atual.tmp';temp.write_text(json.dumps({'directory':str(local),'remote':remote,'fingerprint':report['fingerprint']},indent=2));temp.replace(BASE/'fonte-atual.json')
  state.update(state='online',fingerprint=report['fingerprint'],static_id=report['static_id'],last_checked_at=now(),last_success_at=now(),last_transfer_at=now(),last_source_at=report['source_at'],validation_version=report['validation_version'],build_id=report.get('build_id'),last_changed_records=result['last_changed_records'],error=None,managed_sources=state.get('managed_sources',[])+[str(local)])
  write_state(state)
  # Remove only this verified, already imported temporary server export.
  subprocess.run(SSH+['python3 '+REMOTE_EXPORT+' --cleanup '+remote],capture_output=True,timeout=20)
  # Keep ten private source snapshots; record_versions keeps changed evidence.
  managed=state.get('managed_sources',[])
  for value in managed[:-10]:
   old=Path(value)
   if old.parent==BASE/'fontes' and old.is_dir() and not old.is_symlink() and old!=local:shutil.rmtree(old)
  state['managed_sources']=managed[-10:];write_state(state)
  return dict(result,sync=state)
 except Exception as error:
  state.update(state='offline',last_checked_at=now(),error=type(error).__name__);write_state(state)
  raise
 finally:lock.close()
if __name__=='__main__':
 result=sync();print(json.dumps({'state':result['sync']['state'],'source_at':result['source_at'],'decisions':result['decisions'],'changed_records':result.get('last_changed_records',0)},ensure_ascii=False))
