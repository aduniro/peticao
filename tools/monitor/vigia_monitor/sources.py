from __future__ import annotations
import datetime as dt, importlib.util, json, os, subprocess, time
from pathlib import Path
import psutil
from .store import Store, now, checksum, STATE

ROOT=Path('/mnt/dev/peticao')
spec=importlib.util.spec_from_file_location('vigia_simple_source',ROOT/'tools/monitor/vigia_simples.py');simple=importlib.util.module_from_spec(spec);spec.loader.exec_module(simple)
clean=simple.clean
SIMPLE_REMOTE_SCRIPT=simple.REMOTE_SCRIPT
simple.REMOTE_SCRIPT="""from pathlib import Path
import sqlite3,json
path=Path('/home/adunir/.local/state/peticao-monitor/health.sqlite')
if path.is_file():
 try:
  with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,timeout=2) as db:
   db.execute('PRAGMA query_only=ON');r=db.execute('SELECT payload FROM latest WHERE id=1').fetchone()
  if not r:raise ValueError()
  data=json.loads(r[0]);print(json.dumps(data))
 except Exception:exec(FALLBACK)
else:exec(FALLBACK)
""".replace('FALLBACK',repr(SIMPLE_REMOTE_SCRIPT))

def git(path,*args,limit=100000):
 r=subprocess.run(['git','-C',str(path),*args],capture_output=True,timeout=12,env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0'})
 if r.returncode:raise RuntimeError('Git indisponível nesta origem')
 return clean(r.stdout.decode(errors='replace'),limit)

def git_snapshot(path=ROOT):
 files=git(path,'diff','--name-only','HEAD').splitlines();untracked=git(path,'ls-files','--others','--exclude-standard').splitlines()[:200];versions={}
 for name in set(files+untracked):
  if not safe_file(name):continue
  try:
   target=Path(path)/name
   if target.is_symlink():continue
   info=target.stat();versions[name]=[info.st_mtime_ns,info.st_size]
  except OSError:pass
 return {'cwd':str(path),'status':git(path,'status','--short'),
  'graph':git(path,'log','--graph','--decorate','--oneline','--all','-50'),
  'branches':git(path,'branch','-a','--no-color'),'worktrees':git(path,'worktree','list','--porcelain'),
  'commits':git(path,'log','--format=%H%x09%h%x09%s','-60').splitlines(),
  'files':files,'untracked':untracked,'versions':versions}

def safe_file(path):
 p=Path(path)
 return not p.is_absolute() and '..' not in p.parts and not any(x in {'secrets','preview-state','.git','node_modules','data'} or x.startswith('.env') for x in p.parts) and (p.parts[0] in {'site','tools','docs','deploy'} or str(p) in {'AGENTS.md','README.md'}) and p.suffix in {'.ts','.tsx','.js','.mjs','.py','.sh','.css','.md','.html','.json'}

def file_diff(repo,path,commit=None):
 if not safe_file(path):return 'Arquivo de runtime/dados ou caminho fora do escopo de visualização.'
 base=Path(repo).resolve();target=(base/path).resolve()
 if not target.is_relative_to(base):return 'Link fora do repositório recusado.'
 if commit:
  if not __import__('re').fullmatch('[a-f0-9]{7,40}',commit):raise ValueError('Commit inválido')
  return git(base,'show','--format=fuller',commit,'--',path)
 tracked=subprocess.run(['git','-C',str(base),'ls-files','--error-unmatch','--',path],capture_output=True).returncode==0
 if tracked:return git(base,'diff','--no-ext-diff','--no-color','HEAD','--',path)
 return clean(target.read_text(errors='replace')[:64000],64000) if target.is_file() and target.stat().st_size<100000 else 'Arquivo ausente ou grande demais.'

class Collector:
 def __init__(self,store,remote=True):
  self.store=store;self.remote=simple.Remote(remote);self.remote.start();self.ps={};self.first=True
 def activities(self):
  for raw in simple.activities():
   row={k:raw[k] for k in ['title','state','stage','detail','scope','environment','eta','created_at','updated_at'] if k in raw};task_id=raw['id'];digest=checksum(raw)
   old=self.store.rows('SELECT * FROM tasks WHERE id=?',(task_id,))
   if old and old[0]['import_hash']==digest:continue
   self.store.task(task_id,**row,import_hash=digest)
   self.store.event('activity',row.get('stage','Atualização'),task_id,row,event_id='simple:'+task_id+':'+digest)
   if raw.get('total'):
    self.store.execute("DELETE FROM steps WHERE task_id=? AND id LIKE 'reported-%'",(task_id,))
    if raw['done']:self.store.step(task_id,'reported-completed','Itens concluídos',state='completed',weight=raw['done'])
    if raw['total']>raw['done']:self.store.step(task_id,'reported-remaining','Itens restantes',state='running',weight=raw['total']-raw['done'])
   if not self.first and (not old or old[0]['state']!=raw['state']):
    self.store.queue_mail('state:'+task_id+':'+digest,'Vigia: '+row.get('title',task_id)+' — '+simple.STATES[raw['state']],f"# Atualização da tarefa\n\n{row.get('title',task_id)}\n\nEstado: {simple.STATES[raw['state']]}.\n\nEtapa: {row.get('stage','—')}\n\n{row.get('detail','')}\n\nAmbiente: {row.get('environment','—')}.\nEscopo: {row.get('scope','—')}.\nEstimativa: {row.get('eta','não informada')}.")
  self.first=False
 def processes(self):
  rows=[]
  for row in simple.processes():
   try:
    pid=row['pid'];p=self.ps.get(pid)
    if not p or not p.is_running():p=psutil.Process(pid);self.ps[pid]=p
    with p.oneshot():row.update(cpu=p.cpu_percent(),memory=round(p.memory_info().rss/1024**2,1),elapsed=int(time.time()-p.create_time()),status=p.status(),background=p.terminal() is None)
    rows.append(row)
   except (psutil.Error,OSError):continue
  self.ps={r['pid']:self.ps[r['pid']] for r in rows};return rows
 def collect(self,slow=False):
  self.activities();self.store.snapshot('local',{'processes':self.processes(),'services':simple.local_services(),'cpu':psutil.cpu_percent(),'memory':psutil.virtual_memory().percent})
  remote=self.remote.value.copy()
  if remote.get('collector_at'):
   try:
    if (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(remote['collector_at'])).total_seconds()>60:remote['state']='coletor remoto sem atualização'
   except ValueError:remote['state']='horário remoto inválido'
  self.store.snapshot('vps',remote,status=remote.get('state','unknown'))
  if slow:
   for path in self.store.rows("SELECT DISTINCT cwd FROM tasks UNION SELECT '/mnt/dev/peticao' AS cwd UNION SELECT substr(source,5) AS cwd FROM snapshots WHERE source LIKE 'git:%'"):
    repo=Path(path['cwd'])
    if not repo.is_dir():continue
    try:
     payload=git_snapshot(repo);key='git:'+str(repo);old=self.store.rows('SELECT payload FROM snapshots WHERE source=?',(key,))
     self.store.snapshot(key,payload)
     if old and (json.loads(old[0]['payload']).get('status')!=payload['status'] or json.loads(old[0]['payload']).get('versions')!=payload['versions']):self.store.event('git','Arquivos modificados',data={'cwd':str(repo),'status':payload['status']})
    except (RuntimeError,OSError,subprocess.TimeoutExpired):self.store.snapshot('git:'+str(repo),{'cwd':str(repo),'error':'Git indisponível'},status='unavailable')
   self.import_mail()
 def import_mail(self):
  path=STATE/'mail-history.jsonl'
  if not path.is_file():return
  # Bounded tail; IDs make replay harmless.
  with path.open('rb') as f:
   f.seek(max(0,path.stat().st_size-500000));lines=f.read().splitlines()
  for line in lines:
   try:
    r=json.loads(line)
    if r.get('recipient')!='operator-1608598f41@example.invalid':continue
    self.store.execute('INSERT OR IGNORE INTO mail VALUES(?,?,?,?,?,?)',(str(r['id']),r['at'],clean(r['subject']),str(r['state']),r.get('provider_id'),''))
   except (ValueError,KeyError):continue
 def stop(self):self.remote.stop.set()
