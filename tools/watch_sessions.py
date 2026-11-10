#!/usr/bin/python3
"""Bounded metadata observer for two authorized Codex conversations. No raw content."""
from __future__ import annotations
import argparse,collections,datetime as dt,fcntl,hashlib,json,os,pathlib,re,subprocess,tempfile,time
ROOT=pathlib.Path('/mnt/apps/peticao-final/_ops/coordenacao-dupla')
SESSION_ROOT=pathlib.Path('/home/barre/.codex/sessions')
ACTORS={'apoio':'01a1c0b3-f069-75a0-a2e9-e691094c9bab','admin':'01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7'}
REPOS={
 'consolidacao':('/mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109','admin'),
 'workspace-antigo':('/mnt/dev/peticao','admin'),
 'candidato-admin':('/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109','admin')}
PATHS=['site/src','site/assets','site/public','site/package.json','site/package-lock.json','site/next.config.js','site/next.config.mjs','site/next.config.ts','site/tsconfig.json']
EXCLUDES=[':(exclude)**/*.'+extension for extension in ['csv','tsv','xls','xlsx','sqlite','db','sql','dump','log']]+[':(exclude)**/.env*']
MAX_LINE=128*1024
FILE_BUDGET=256*1024
STALE_SECONDS=180
SAFE_NAME=re.compile(r'[A-Za-z0-9_./:-]{1,160}\Z')
CLOSED={'task_complete','turn_aborted','task_failed','task_cancelled'}
ACTIVITY={'task_started','task_complete','turn_aborted','task_failed','task_cancelled','agent_message','agent_reasoning','user_message','function_call','custom_tool_call','function_call_output','custom_tool_call_output','message'}

def now():return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def atomic(path,value):
 path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd,tmp=tempfile.mkstemp(prefix='.watch-',dir=path.parent)
 try:
  with os.fdopen(fd,'w') as stream:json.dump(value,stream,ensure_ascii=False,sort_keys=True);stream.write('\n');stream.flush();os.fsync(stream.fileno())
  os.chmod(tmp,0o600);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def timestamp(value):
 if not isinstance(value,str) or len(value)>40:return None
 try:
  parsed=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
  if parsed.tzinfo is None:return None
  return parsed.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds')
 except ValueError:return None

def metadata(record):
 """Only allowlisted scalars are retained; never touch content/arguments/output."""
 if not isinstance(record,dict):return None
 payload=record.get('payload')
 if not isinstance(payload,dict):return None
 envelope=record.get('type');kind=payload.get('type')
 if envelope not in {'event_msg','response_item'} or kind not in ACTIVITY:return None
 at=timestamp(record.get('timestamp'))
 if not at:return None
 event={'at':at,'event_type':kind}
 if kind in {'function_call','custom_tool_call'}:
  name=payload.get('name')
  if isinstance(name,str) and SAFE_NAME.fullmatch(name):event['tool_name']=name
 return event

def consume(path,previous,budget=FILE_BUDGET):
 """No raw incomplete line is ever stored. Reread short partials next cycle."""
 path=pathlib.Path(path);info=path.stat();identity=[info.st_dev,info.st_ino]
 state=dict(previous or {})
 reset=state.get('identity')!=identity or info.st_size<int(state.get('offset',0))
 if reset:
  start=max(0,info.st_size-budget)
  state={'identity':identity,'offset':start,'discarding_line':bool(start),'initial_history_skipped_bytes':start,'records_observed':0,'events':{},'last_activity':None,'last_task_signal':None}
 events=[];used=0
 with path.open('rb') as stream:
  stream.seek(state['offset'])
  while used<budget:
   start=stream.tell();raw=stream.readline(min(MAX_LINE+1,budget-used))
   if not raw:break
   used+=len(raw)
   if state.get('discarding_line'):
    state['offset']=stream.tell();state['discarding_line']=not raw.endswith(b'\n');continue
   if not raw.endswith(b'\n'):
    if len(raw)>MAX_LINE:
     state['offset']=stream.tell();state['discarding_line']=True
    # Otherwise leave offset at line start: tolerates an in-progress JSON append.
    break
   state['offset']=stream.tell()
   if len(raw)>MAX_LINE:continue
   try:event=metadata(json.loads(raw))
   except (ValueError,UnicodeError):continue
   if not event:continue
   state['records_observed']+=1
   counts=state.setdefault('events',{});counts[event['event_type']]=counts.get(event['event_type'],0)+1
   current=state.get('last_activity')
   if not current or event['at']>=current['at']:state['last_activity']=event
   if event.get('tool_name'):
    current=state.get('last_tool')
    if not current or event['at']>=current['at']:state['last_tool']=event
   if event['event_type'] in CLOSED|{'task_started'}:
    current=state.get('last_task_signal')
    if not current or event['at']>=current['at']:state['last_task_signal']=event
   events.append(event)
 return state,events[-32:],used

def activity_state(actor_state,clock=None):
 clock=clock or dt.datetime.now(dt.timezone.utc)
 activity=actor_state.get('last_activity');signal=actor_state.get('last_task_signal')
 if not activity:return 'unknown'
 if signal and signal['event_type'] in CLOSED and signal['at']>=activity['at']:return 'task_closed'
 age=(clock-dt.datetime.fromisoformat(activity['at'])).total_seconds()
 if age< -60:return 'unknown'
 return 'recent_activity' if age<=STALE_SECONDS else 'stale'

def discover(root):
 found={actor:[] for actor in ACTORS};count=0
 for directory,dirs,files in os.walk(root):
  count+=1
  if count>50000:return found
  dirs.sort();files.sort()
  for name in files:
   count+=1
   if count>50000:return found
   if not name.endswith('.jsonl'):continue
   for actor,sid in ACTORS.items():
    if sid in name:found[actor].append(str(pathlib.Path(directory)/name))
 return found

def collect_sessions(root,checkpoint,clock=None):
 found=discover(root);actors={}
 for actor,sid in ACTORS.items():
  files=found[actor][-4:];last=None;signal=None;tool=None;counts=collections.Counter();skipped=0;events=[];read_bytes=0
  budget=FILE_BUDGET
  for path in files:
   if budget<=0:break
   state,new,used=consume(path,checkpoint.setdefault('files',{}).get(path),budget)
   checkpoint['files'][path]=state;budget-=used;read_bytes+=used;events.extend(new)
   counts.update(state.get('events',{}));skipped+=state.get('initial_history_skipped_bytes',0)
   for key in ['last_activity','last_task_signal','last_tool']:
    value=state.get(key)
    if value and (key=='last_activity' and (not last or value['at']>last['at'])):last=value
    if value and (key=='last_task_signal' and (not signal or value['at']>signal['at'])):signal=value
    if value and key=='last_tool' and (not tool or value['at']>tool['at']):tool=value
  previous=checkpoint.setdefault('actors',{}).get(actor,{})
  # Rotation can remove a previous path; preserve metadata scalars until newer evidence exists.
  for key in ['last_activity','last_task_signal','last_tool']:
   value=previous.get(key)
   if value and key=='last_activity' and (not last or value['at']>last['at']):last=value
   if value and key=='last_task_signal' and (not signal or value['at']>signal['at']):signal=value
   if value and key=='last_tool' and (not tool or value['at']>tool['at']):tool=value
  value={'session_id':sid,'last_activity':last,'last_task_signal':signal,'last_tool':tool,'event_counts':dict(counts),'initial_history_skipped_bytes':skipped}
  value['state']=activity_state(value,clock) if files else 'unknown'
  value['meaning']={'task_closed':'Há evento explícito de encerramento da tarefa; não implica conclusão do projeto.','recent_activity':'Metadados recentes observados; não prova processo ativo nem percentual de progresso.','stale':'Sem atividade recente confirmada; estado atual do agente não conhecido.','unknown':'Sem evidência suficiente para afirmar atividade atual.'}[value['state']]
  checkpoint['actors'][actor]=value;actors[actor]=value
 return actors

def git(repo,*args):
 env=dict(os.environ,GIT_OPTIONAL_LOCKS='0')
 result=subprocess.run(['/usr/bin/git','-C',str(repo),*args],capture_output=True,timeout=10,env=env)
 if result.returncode:raise RuntimeError('git_metadata_unavailable')
 if len(result.stdout)>1024*1024:raise ValueError('git_metadata_limit')
 return result.stdout

def app_status(repo):
 repo=pathlib.Path(repo)
 if not repo.is_dir():return {'state':'unavailable'}
 try:
  branch=git(repo,'rev-parse','--abbrev-ref','HEAD').decode().strip()
  commit=git(repo,'log','-1','--format=%H','--',*PATHS,*EXCLUDES).decode().strip()
  raw=git(repo,'status','--porcelain=v1','-z','--untracked-files=no','--',*PATHS,*EXCLUDES).split(b'\x00')
  changes=[];index=0
  while index<len(raw):
   item=raw[index];index+=1
   if not item:continue
   code=item[:2].decode('ascii',errors='replace');name=item[3:].decode('utf-8',errors='replace')
   if 'R' in code or 'C' in code:index+=1
   if any(ord(char)<32 for char in name):continue
   if pathlib.PurePosixPath(name).suffix.lower() in {'.csv','.tsv','.xls','.xlsx','.sqlite','.db','.sql','.dump','.log'}:continue
   if any(part.startswith('.env') for part in pathlib.PurePosixPath(name).parts):continue
   st=None
   try:
    stat=(repo/name).lstat();st={'mtime_ns':stat.st_mtime_ns,'bytes':stat.st_size}
   except OSError:pass
   changes.append({'status':code,'path':name,'stat':st})
  return {'state':'observed','branch':branch[:160],'app_commit':commit,'tracked_app_changes':changes[:200],'changes_truncated':len(changes)>200}
 except (OSError,ValueError,subprocess.SubprocessError,RuntimeError):return {'state':'unavailable'}

def cli(args):
 result=subprocess.run(['/usr/bin/python3',str(ROOT/'tools'/'coord.py'),*args],capture_output=True,text=True,timeout=30)
 if result.returncode:raise RuntimeError('ledger_cli_failed')

def publish(actors,repositories,checkpoint,call=cli):
 done=checkpoint.setdefault('published',{})
 for actor,value in actors.items():
  key='session:'+actor;fingerprint=digest(value)
  if done.get(key)==fingerprint:continue
  call(['announce','--actor',actor,'--summary','Observação de metadados da sessão: '+value['state'],'--resource','coord:sessions','--data-json',json.dumps(value,ensure_ascii=False),'--no-require-ack'])
  done[key]=fingerprint
 for name,value in repositories.items():
  key='repo:'+name;fingerprint=digest(value)
  if done.get(key)==fingerprint:continue
  path,actor=REPOS[name]
  if value['state']=='observed':
   call(['observe','--actor',actor,'--repo',path,'--app-code-only','--no-require-ack'])
  done[key]=fingerprint

def main(argv=None):
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--session-root',type=pathlib.Path,default=SESSION_ROOT);parser.add_argument('--state-root',type=pathlib.Path,default=ROOT/'state');parser.add_argument('--no-ledger',action='store_true');args=parser.parse_args(argv)
 os.umask(0o077);args.state_root.mkdir(parents=True,exist_ok=True,mode=0o700)
 with (args.state_root/'watcher.lock').open('a') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return 0
  path=args.state_root/'watcher-checkpoint.json'
  checkpoint=json.loads(path.read_text()) if path.exists() else {}
  actors=collect_sessions(args.session_root,checkpoint)
  repositories={name:app_status(repo) for name,(repo,_) in REPOS.items()}
  sessions=[]
  for actor,value in actors.items():
   activity=value.get('last_activity') or {};signal=value.get('last_task_signal') or {}
   turn_state='closed' if signal.get('event_type') in CLOSED and signal.get('at','')>=activity.get('at','') else 'open' if signal.get('event_type')=='task_started' else 'unknown'
   sessions.append({'actor':actor,'thread_id':value['session_id'],'last_activity_at':activity.get('at'),'turn_state':turn_state,'observation_state':value['state'],'last_event_type':activity.get('event_type'),'last_tool_name':(value.get('last_tool') or {}).get('tool_name'),'stale':value['state'] in {'stale','unknown'}})
  snapshot={'observed_at':now(),'sessions':sessions,'actors':actors,'repositories':repositories,'semantics':'Observation timestamps do not imply an active agent or project progress.'}
  atomic(args.state_root/'sessions.json',snapshot)
  try:
   if not args.no_ledger:publish(actors,repositories,checkpoint)
  except Exception as error:
   snapshot['ledger_delivery']='failed';snapshot['ledger_error_type']=type(error).__name__;atomic(args.state_root/'sessions.json',snapshot);atomic(path,checkpoint);return 1
  atomic(path,checkpoint);return 0

if __name__=='__main__':raise SystemExit(main())
