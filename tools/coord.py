#!/usr/bin/python3
"""Ledger cooperativo e leases com fencing; nenhum editor, merge, deploy ou envio de email."""
from __future__ import annotations
import argparse, contextlib, datetime as dt, hashlib, json, os, pathlib, re, secrets, sqlite3, subprocess, sys, time, uuid
BASE=pathlib.Path('/mnt/apps/peticao-final/_ops/coordenacao-dupla')
DEFAULT_DB=BASE/'state/coord.sqlite'
APP_PATHS=['site/src','site/assets','site/public','site/package.json','site/package-lock.json','site/tsconfig.json','site/next.config.js','site/next.config.mjs','site/next.config.ts','site/tailwind.config.js','site/tailwind.config.ts','site/postcss.config.js','site/postcss.config.mjs','package.json','package-lock.json','tsconfig.json','.nvmrc','.node-version']
PRIVATE_EXTENSIONS={'.csv','.tsv','.xls','.xlsx','.sqlite','.sqlite3','.db','.dump','.sql','.log'}
def app_path(name):
 parts=pathlib.PurePosixPath(name).parts
 if any(x in ('secrets','preview-state','.git','node_modules','.next') or x.startswith('.env') for x in parts):return False
 if pathlib.PurePosixPath(name).suffix.lower() in PRIVATE_EXTENSIONS:return False
 return any(name==x or name.startswith(x+'/') for x in APP_PATHS)
ROOTS=[pathlib.Path(x) for x in ['/mnt/dev/peticao','/mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109','/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109','/mnt/apps/peticao-final/peticao-integrado','/mnt/apps/peticao-final/peticao-release']]
def stamp():return dt.datetime.now(dt.timezone.utc).isoformat()
def encode(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def resource(value):
 p=pathlib.Path(value)
 if p.is_absolute():
  p=p.resolve()
  for root in sorted(ROOTS,key=lambda x:len(str(x)),reverse=True):
   try:
    rel=p.relative_to(root.resolve()).as_posix();return 'code:'+('' if rel=='.' else rel)
   except ValueError:pass
  return 'path:'+str(p)
 if ':' not in value:raise ValueError('Use caminho absoluto ou recurso code:/deploy:/db:/coord:')
 kind,name=value.split(':',1)
 if kind not in ('code','deploy','db','coord','path') or '..' in name.split('/'):raise ValueError('Recurso invalido')
 if kind=='path':
  if not pathlib.Path(name).is_absolute():raise ValueError('path: exige caminho absoluto')
  return resource(name)
 return kind+':'+('/'.join(x for x in name.split('/') if x not in ('','.')))
def legacy_resource(value):
 if value.startswith('path:') and not pathlib.Path(value.split(':',1)[1]).is_absolute():value='path:/'+value.split(':',1)[1]
 return resource(value)
def overlaps(a,b):
 a=legacy_resource(a);b=legacy_resource(b)
 ka,pa=a.split(':',1);kb,pb=b.split(':',1)
 if ka!=kb:return False
 return pa==pb or not pa or not pb or pa.startswith(pb.rstrip('/')+'/') or pb.startswith(pa.rstrip('/')+'/')
class Ledger:
 def __init__(self,path=DEFAULT_DB):
  self.path=pathlib.Path(path)
  if not self.path.is_absolute():raise ValueError('Banco deve ter caminho absoluto')
  self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with self.db() as d:
   d.executescript('''
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS actors(id TEXT PRIMARY KEY,session TEXT NOT NULL,repos TEXT NOT NULL,registered_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS actor_handoffs(prior TEXT PRIMARY KEY,replacement TEXT NOT NULL,notice_seq INTEGER NOT NULL,owner_reference TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT,kind TEXT NOT NULL,summary TEXT NOT NULL,data TEXT NOT NULL,resources TEXT NOT NULL,requires_ack INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events_are_append_only'); END;
CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events_are_append_only'); END;
CREATE TABLE IF NOT EXISTS acks(actor TEXT NOT NULL,seq INTEGER NOT NULL,at TEXT NOT NULL,PRIMARY KEY(actor,seq));
CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,actor TEXT NOT NULL,token TEXT NOT NULL,fence INTEGER NOT NULL UNIQUE,state TEXT NOT NULL,expires REAL NOT NULL,operation TEXT NOT NULL,resources TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations(actor TEXT NOT NULL,repo TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(actor,repo));
CREATE TABLE IF NOT EXISTS resolutions(id TEXT PRIMARY KEY,lease_id TEXT NOT NULL,result TEXT NOT NULL,evidence TEXT NOT NULL,created_at TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resolution_acks(resolution_id TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(resolution_id,actor));
''')
  self.path.chmod(0o600)
 @contextlib.contextmanager
 def db(self,write=False):
  d=sqlite3.connect(self.path,timeout=15,isolation_level=None);d.row_factory=sqlite3.Row;d.execute('PRAGMA busy_timeout=15000')
  try:
   if write:d.execute('BEGIN IMMEDIATE')
   yield d
   if write:d.commit()
  except BaseException:
   if write:d.rollback()
   raise
  finally:d.close()
 def actor(self,d,a):
  if not d.execute('SELECT 1 FROM actors WHERE id=?',(a,)).fetchone():raise ValueError('Participante nao registrado: '+a)
  if d.execute('SELECT 1 FROM actor_handoffs WHERE prior=?',(a,)).fetchone():raise PermissionError('Participante sucedido; usar identidade atual: '+a)
 def active_actors(self,d):
  return [r['id'] for r in d.execute('SELECT id FROM actors WHERE id NOT IN (SELECT prior FROM actor_handoffs)')]
 def required_reviewers(self,d):
  """Registered actors stay visible; owner-designated optional channels do not veto."""
  optional=set()
  for row in d.execute("SELECT data FROM events WHERE kind='reviewer_policy_changed' ORDER BY seq"):
   policy=json.loads(row['data'])
   if (policy.get('version')!=1 or policy.get('optional_actors')!=['executor61'] or
       not isinstance(policy.get('owner_reference'),str) or not policy['owner_reference'].strip() or
       not re.fullmatch('[a-f0-9]{64}',str(policy.get('owner_evidence_sha256','')))):
    raise RuntimeError('invalid_owner_reviewer_policy')
   optional=set(policy['optional_actors'])
  return [actor for actor in self.active_actors(d) if actor not in optional]
 def handoff(self,actor,prior,notice_seq):
  """Successao com autorizacao explicita e ACK externo; nao transfere leases."""
  with self.db(True) as d:
   self.actor(d,actor);self.actor(d,prior)
   if actor==prior:raise ValueError('Successao exige identidades distintas')
   e=d.execute('SELECT * FROM events WHERE seq=?',(notice_seq,)).fetchone()
   if not e or e['actor']!=actor or e['kind']!='notice' or not e['requires_ack']:raise ValueError('Aviso explicito do sucessor exigido')
   payload=json.loads(e['data']).get('actor_handoff',{})
   session=d.execute('SELECT session FROM actors WHERE id=?',(actor,)).fetchone()[0]
   if payload.get('prior')!=prior or payload.get('replacement')!=actor or payload.get('session')!=session or not isinstance(payload.get('owner_reference'),str) or not payload['owner_reference'].strip():raise ValueError('Manifesto de sucessao incompleto')
   peers=set(self.required_reviewers(d))-{actor,prior}
   if not peers:raise RuntimeError('ACK de coordenador independente exigido')
   ack={r['actor'] for r in d.execute('SELECT actor FROM acks WHERE seq=?',(notice_seq,))}
   if not peers.issubset(ack):raise RuntimeError('handoff_pending_peer_ack:'+encode(sorted(peers-ack)))
   d.execute('INSERT INTO actor_handoffs VALUES(?,?,?,?,?)',(prior,actor,notice_seq,payload['owner_reference'],stamp()))
   seq=self.event(d,actor,'actor_succeeded','Responsavel sucedido; leases e historico preservados',payload,['coord:actors'])
   return {'prior':prior,'replacement':actor,'seq':seq,'leases_transferred':False}
 def event(self,d,actor,kind,summary,data=None,resources=(),requires_ack=False):
  if len(summary)>2000 or len(encode(data or {}))>32768:raise ValueError('Evento excede limite')
  cur=d.execute('INSERT INTO events(at,actor,kind,summary,data,resources,requires_ack) VALUES(?,?,?,?,?,?,?)',(stamp(),actor,kind,summary,encode(data or {}),encode(list(resources)),int(requires_ack)));return cur.lastrowid
 def register(self,actor,session,repos):
  if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',actor) or not session:raise ValueError('Identidade invalida')
  repos=[str(pathlib.Path(p).resolve()) for p in repos]
  if any(not pathlib.Path(p).is_dir() for p in repos):raise ValueError('Repositorio inexistente')
  with self.db(True) as d:
   old=d.execute('SELECT * FROM actors WHERE id=?',(actor,)).fetchone()
   if d.execute('SELECT 1 FROM actor_handoffs WHERE prior=?',(actor,)).fetchone():raise PermissionError('Identidade sucedida nao pode ser reativada por registro')
   if old and old['session']!=session:raise ValueError('Identidade ja pertence a outra sessao')
   d.execute('INSERT OR REPLACE INTO actors VALUES(?,?,?,?)',(actor,session,encode(repos),old['registered_at'] if old else stamp()))
   seq=self.event(d,actor,'registered','Participante registrado',{'session':session,'repos':repos})
   return {'actor':actor,'seq':seq}
 def announce(self,actor,summary,resources,data=None,requires_ack=True):
  with self.db(True) as d:
   self.actor(d,actor);seq=self.event(d,actor,'notice',summary,data,[resource(r) for r in resources],requires_ack)
   return {'seq':seq,'requires_ack':requires_ack}
 def ack(self,actor,seq):
  with self.db(True) as d:
   self.actor(d,actor)
   if not d.execute('SELECT 1 FROM events WHERE seq=?',(seq,)).fetchone():raise ValueError('Evento inexistente')
   d.execute('INSERT OR IGNORE INTO acks VALUES(?,?,?)',(actor,seq,stamp()));n=self.event(d,actor,'ack','Evento reconhecido',{'event_seq':seq})
   return {'acknowledged':seq,'seq':n}
 def _notice_fingerprint(self,d,seq):
  row=d.execute('SELECT * FROM events WHERE seq=?',(seq,)).fetchone()
  if not row or row['kind']!='notice' or not row['requires_ack']:raise ValueError('ack_notice_required')
  return row,hashlib.sha256(encode(dict(row)).encode()).hexdigest()
 def notice_fingerprint(self,seq):
  with self.db() as d:
   row,digest=self._notice_fingerprint(d,seq)
   return {'event':seq,'sha256':digest,'actor':row['actor'],'summary':row['summary']}
 def _notice_dispositions(self,d):
  """Projection from immutable events; never rewrite original notices or ACKs."""
  proposals={};votes={};disposed={}
  for event in d.execute("SELECT * FROM events WHERE kind IN ('notice_disposition_proposed','notice_disposition_confirmed') ORDER BY seq").fetchall():
   data=json.loads(event['data'])
   if event['kind']=='notice_disposition_proposed':
    row,digest=self._notice_fingerprint(d,data['target_event'])
    if digest!=data['target_sha256']:raise RuntimeError('notice_disposition_stale_digest')
    proposals[event['seq']]=(event,data);votes[event['seq']]={event['actor']}
   else:
    proposal=data.get('proposal_event')
    if proposal not in proposals:raise RuntimeError('notice_disposition_unknown_proposal')
    original,body=proposals[proposal];required=data.get('required_actors',[])
    if event['actor']==original['actor'] or data.get('target_sha256')!=body['target_sha256'] or not isinstance(required,list) or len(set(required))<2 or original['actor'] not in required or event['actor'] not in required:raise RuntimeError('notice_disposition_invalid_confirmation')
    votes[proposal].add(event['actor'])
    complete=set(required).issubset(votes[proposal])
    if data.get('confirmed') is not complete:raise RuntimeError('notice_disposition_invalid_quorum')
    if complete:
     target=body['target_event']
     if target in disposed:raise RuntimeError('notice_disposition_duplicate_finalization')
     disposed[target]={**body,'proposal_event':proposal,'confirmation_event':event['seq'],'confirmed_by':sorted(votes[proposal])}
  return disposed
 def _notice_without_live_lease(self,d,seq):
  for event in d.execute("SELECT data FROM events WHERE kind='lease_acquired'").fetchall():
   data=json.loads(event['data'])
   if data.get('manifest_event')==seq:
    lease=d.execute('SELECT state FROM leases WHERE id=?',(data['lease'],)).fetchone()
    if lease and lease['state'] in ('active','uncertain'):raise RuntimeError('notice_has_live_or_uncertain_lease')
 def propose_notice_disposition(self,actor,seq,digest,disposition,reason,evidence,replacement=None):
  if disposition not in ('superseded','withdrawn','rejected','archived-completed'):raise ValueError('invalid_notice_disposition')
  if not isinstance(reason,str) or not 10<=len(reason)<=1000 or not isinstance(evidence,str) or not 10<=len(evidence)<=4000:raise ValueError('notice_disposition_reason_and_evidence_required')
  with self.db(True) as d:self.expire(d)
  with self.db(True) as d:
   self.actor(d,actor)
   if len(self.required_reviewers(d))<2:raise RuntimeError('independent_coordinator_required')
   row,actual=self._notice_fingerprint(d,seq)
   if actual!=digest:raise ValueError('notice_digest_mismatch')
   disposed=self._notice_dispositions(d)
   if seq in disposed:raise RuntimeError('notice_already_disposed')
   self._notice_without_live_lease(d,seq)
   if disposition=='superseded':
    if not isinstance(replacement,int) or replacement<=seq:raise ValueError('newer_replacement_notice_required')
    self._notice_fingerprint(d,replacement)
    if replacement in disposed:raise ValueError('replacement_notice_inactive')
   elif replacement is not None:raise ValueError('replacement_only_for_superseded')
   data={'target_event':seq,'target_sha256':digest,'disposition':disposition,'reason':reason,'evidence':evidence,'replacement_event':replacement,'execution_authorized':False}
   proposal=self.event(d,actor,'notice_disposition_proposed','Disposicao proposta; falta confirmacao independente',data,json.loads(row['resources']))
   return {'proposal_event':proposal,'target_event':seq,'target_sha256':digest,'confirmed':False}
 def confirm_notice_disposition(self,actor,proposal,digest):
  with self.db(True) as d:self.expire(d)
  with self.db(True) as d:
   self.actor(d,actor);event=d.execute('SELECT * FROM events WHERE seq=?',(proposal,)).fetchone()
   if not event or event['kind']!='notice_disposition_proposed':raise ValueError('disposition_proposal_required')
   if actor==event['actor']:raise PermissionError('independent_confirmation_required')
   body=json.loads(event['data']);target=body['target_event'];row,actual=self._notice_fingerprint(d,target)
   if actual!=digest or body['target_sha256']!=digest:raise ValueError('notice_digest_mismatch')
   active=set(self.required_reviewers(d))
   if event['actor'] not in active:raise RuntimeError('proposal_actor_retired_requires_new_proposal')
   disposed=self._notice_dispositions(d)
   if target in disposed:raise RuntimeError('notice_already_disposed')
   self._notice_without_live_lease(d,target)
   replacement=body.get('replacement_event')
   if replacement is not None:
    self._notice_fingerprint(d,replacement)
    if replacement in disposed:raise RuntimeError('replacement_notice_inactive')
   votes={event['actor']}
   for vote in d.execute("SELECT actor,data FROM events WHERE kind='notice_disposition_confirmed'"):
    if json.loads(vote['data']).get('proposal_event')==proposal:votes.add(vote['actor'])
   already=actor in votes;votes.add(actor);complete=len(active)>=2 and active.issubset(votes)
   if already and not complete:return {'proposal_event':proposal,'confirmed':False,'already_recorded':True}
   confirmation=self.event(d,actor,'notice_disposition_confirmed','Disposicao confirmada; nao autoriza executar manifesto' if complete else 'Confirmacao parcial de disposicao',{'proposal_event':proposal,'target_sha256':digest,'required_actors':sorted(active),'confirmed':complete},json.loads(row['resources']))
   return {'proposal_event':proposal,'target_event':target,'confirmation_event':confirmation,'confirmed':complete,'execution_authorized':False}
 def expire(self,d):
  rows=list(d.execute("SELECT * FROM leases WHERE state='active' AND expires<=?",(time.time(),)))
  for r in rows:
   d.execute("UPDATE leases SET state='uncertain' WHERE id=?",(r['id'],));self.event(d,r['actor'],'lease_uncertain','Lease expirou; exige reconciliacao',{'lease':r['id'],'fence':r['fence']},json.loads(r['resources']))
 def acquire(self,actor,resources,operation='edit',ttl=600,manifest_event=None):
  if not resources or not 30<=ttl<=3600 or operation not in ('edit','deploy','merge','migration','test','inspect'):raise ValueError('Lease invalido')
  resources=sorted(set(resource(x) for x in resources))
  if operation in ('deploy','migration','merge'):resources=sorted(set(resources+['code:']))
  # Expiry is committed independently: a rejected acquisition must still persist uncertainty.
  with self.db(True) as d:self.expire(d)
  with self.db(True) as d:
   self.actor(d,actor)
   disposed=self._notice_dispositions(d)
   if operation in ('deploy','migration') and not any(r.startswith(('deploy:','db:')) for r in resources):raise ValueError('Deploy/migration exige recurso global deploy: ou db:')
   for r in d.execute("SELECT * FROM leases WHERE state IN ('active','uncertain')"):
    old=json.loads(r['resources'])
    if any(overlaps(a,b) for a in resources for b in old):raise RuntimeError('resource_busy:'+encode({'owner':r['actor'],'lease':r['id'],'state':r['state'],'fence':r['fence']}))
   if operation in ('deploy','migration','merge'):
    if manifest_event in disposed:raise RuntimeError('critical_manifest_notice_inactive')
    event=d.execute('SELECT * FROM events WHERE seq=?',(manifest_event,)).fetchone() if manifest_event else None
    if not event or event['kind']!='notice' or not event['requires_ack']:raise RuntimeError('explicit_manifest_notice_required')
    manifest=json.loads(event['data']).get('manifest')
    if not isinstance(manifest,dict):raise ValueError('manifest_object_required')
    if not re.fullmatch('[a-f0-9]{40}',str(manifest.get('commit',''))):raise ValueError('manifest_commit_sha40_required')
    for key in ('api_contracts','database','destination'):
     if not isinstance(manifest.get(key),str) or not manifest[key].strip():raise ValueError('manifest_'+key+'_required')
    for key in ('files','tests'):
     if not isinstance(manifest.get(key),list) or not manifest[key] or any(not isinstance(x,str) or not x.strip() for x in manifest[key]):raise ValueError('manifest_'+key+'_required')
   actors=self.required_reviewers(d)
   if operation in ('deploy','migration','merge') and len(actors)<2:raise RuntimeError('two_coordinators_required')
   pending=[]
   for e in d.execute('SELECT * FROM events WHERE requires_ack=1'):
    if e['seq'] in disposed:continue
    relevant=operation in ('deploy','migration','merge') or any(overlaps(a,b) for a in resources for b in json.loads(e['resources']))
    if not relevant:continue
    needed=[a for a in actors if a!=e['actor']] if operation in ('deploy','migration','merge') else ([actor] if actor!=e['actor'] else [])
    for a in needed:
     if not d.execute('SELECT 1 FROM acks WHERE actor=? AND seq=?',(a,e['seq'])).fetchone():pending.append({'actor':a,'event':e['seq']})
   if pending:raise RuntimeError('pending_ack:'+encode(pending))
   ident=uuid.uuid4().hex;token=secrets.token_hex(24);fence=d.execute('SELECT COALESCE(MAX(fence),0)+1 FROM leases').fetchone()[0];expires=time.time()+ttl
   d.execute('INSERT INTO leases VALUES(?,?,?,?,?,?,?,?,?)',(ident,actor,token,fence,'active',expires,operation,encode(resources),stamp()))
   seq=self.event(d,actor,'lease_acquired','Recurso reservado',{'lease':ident,'fence':fence,'expires':expires,'operation':operation,'manifest_event':manifest_event},resources)
   return {'lease':ident,'token':token,'fence':fence,'expires':expires,'resources':resources,'seq':seq}
 def verify(self,d,actor,ident,token,fence):
  self.actor(d,actor);r=d.execute('SELECT * FROM leases WHERE id=?',(ident,)).fetchone()
  if not r or r['actor']!=actor or not secrets.compare_digest(r['token'],token) or r['fence']!=fence:raise PermissionError('lease_identity_or_fence_mismatch')
  if r['state']!='active' or r['expires']<=time.time():raise RuntimeError('lease_not_active_requires_reconciliation')
  return r
 def renew(self,actor,ident,token,fence,ttl=600):
  if not 30<=ttl<=3600:raise ValueError('TTL invalido')
  with self.db(True) as d:self.expire(d)
  with self.db(True) as d:
   r=self.verify(d,actor,ident,token,fence);expires=time.time()+ttl;d.execute('UPDATE leases SET expires=? WHERE id=?',(expires,ident));seq=self.event(d,actor,'lease_renewed','Lease renovado',{'lease':ident,'fence':fence,'expires':expires},json.loads(r['resources']));return {'lease':ident,'expires':expires,'seq':seq}
 def check(self,actor,ident,token,fence):
  with self.db(True) as d:self.expire(d)
  with self.db() as d:r=self.verify(d,actor,ident,token,fence);return {'valid':True,'lease':ident,'fence':fence,'expires':r['expires']}
 def release(self,actor,ident,token,fence,outcome='completed',summary='Operacao encerrada'):
  if outcome not in ('completed','aborted'):raise ValueError('Resultado invalido')
  with self.db(True) as d:self.expire(d)
  with self.db(True) as d:
   r=self.verify(d,actor,ident,token,fence);d.execute("UPDATE leases SET state='released' WHERE id=?",(ident,));seq=self.event(d,actor,'lease_released',summary,{'lease':ident,'fence':fence,'declared_outcome':outcome},json.loads(r['resources']));return {'released':ident,'seq':seq}
 def propose_resolution(self,actor,ident,result,evidence):
  if result not in ('completed','aborted') or not evidence or len(evidence)>4000:raise ValueError('Evidencia e resultado exigidos')
  with self.db(True) as d:self.expire(d)
  with self.db(True) as d:
   self.actor(d,actor);r=d.execute('SELECT * FROM leases WHERE id=?',(ident,)).fetchone()
   if not r or r['state']!='uncertain':raise ValueError('Somente operacao incerta pode ser reconciliada')
   ident2=uuid.uuid4().hex;d.execute('INSERT INTO resolutions VALUES(?,?,?,?,?,?)',(ident2,ident,result,evidence,stamp(),'pending'));d.execute('INSERT INTO resolution_acks VALUES(?,?,?)',(ident2,actor,stamp()));seq=self.event(d,actor,'reconciliation_proposed','Reconciliacao proposta; falta outro coordenador',{'resolution':ident2,'lease':ident,'declared_result':result,'evidence':evidence},json.loads(r['resources']));return {'resolution':ident2,'seq':seq,'state':'pending'}
 def confirm_resolution(self,actor,ident):
  with self.db(True) as d:
   self.actor(d,actor);r=d.execute('SELECT * FROM resolutions WHERE id=?',(ident,)).fetchone()
   if not r or r['state']!='pending':raise ValueError('Reconciliacao nao pendente')
   lease=d.execute('SELECT * FROM leases WHERE id=?',(r['lease_id'],)).fetchone()
   if lease['state']!='uncertain':raise ValueError('Lease ja reconciliado')
   d.execute('INSERT OR IGNORE INTO resolution_acks VALUES(?,?,?)',(ident,actor,stamp()))
   actors=self.required_reviewers(d);ack={x['actor'] for x in d.execute('SELECT actor FROM resolution_acks WHERE resolution_id=?',(ident,))}
   complete=len(actors)>=2 and set(actors).issubset(ack)
   if complete:d.execute("UPDATE resolutions SET state='confirmed' WHERE id=?",(ident,));d.execute("UPDATE leases SET state='reconciled' WHERE id=?",(r['lease_id'],))
   seq=self.event(d,actor,'reconciliation_confirmed' if complete else 'reconciliation_ack','Reconciliacao conferida pelo participante',{'resolution':ident,'lease':r['lease_id'],'confirmed':complete},json.loads(lease['resources']));return {'resolution':ident,'confirmed':complete,'seq':seq}
 def observe(self,actor,repo,requires_ack=True):
  root=pathlib.Path(repo).resolve()
  if root not in [r.resolve() for r in ROOTS]:raise ValueError('Repositorio fora do inventario autorizado')
  def git(*args):return subprocess.check_output(['/usr/bin/git','-C',str(root),*args],stderr=subprocess.DEVNULL).decode('utf8','replace').strip()
  head=git('rev-parse','HEAD');branch=git('branch','--show-current')
  raw=subprocess.check_output(['/usr/bin/git','-C',str(root),'status','--porcelain=v1','-z','--untracked-files=no','--',*APP_PATHS]);entries=raw.decode('utf8','replace').split('\0');files=[];i=0
  while i<len(entries):
   line=entries[i];i+=1
   if not line:continue
   state=line[:2];name=line[3:]
   if 'R' in state or 'C' in state:i+=1
   if not app_path(name):continue
   p=root/name
   try:s=p.lstat();meta={'size':s.st_size,'mtime_ns':s.st_mtime_ns,'ctime_ns':s.st_ctime_ns,'inode':s.st_ino,'mode':s.st_mode}
   except FileNotFoundError:meta={'missing':True}
   files.append({'path':name,'state':state,'stat':meta})
  data={'repo':str(root),'head':head,'branch':branch,'tracked_changes':files,'untracked':'excluded_without_reading','scope':'app_code_only','observed_at':stamp()};stable={k:v for k,v in data.items() if k!='observed_at'};fingerprint=hashlib.sha256(encode(stable).encode()).hexdigest()
  with self.db(True) as d:
   self.actor(d,actor);old=d.execute('SELECT * FROM observations WHERE actor=? AND repo=?',(actor,str(root))).fetchone()
   if old and old['fingerprint']==fingerprint:return {'changed':False,'fingerprint':fingerprint,'observed_at':data['observed_at']}
   changed_paths={x['path'] for x in files}
   if old:
    before=json.loads(old['data']);changed_paths.update(x['path'] for x in before.get('tracked_changes',[]))
    if before['head']!=head:
     changed_paths.update(x for x in git('diff','--name-only',before['head'],head,'--',*APP_PATHS).splitlines() if app_path(x))
   affected=['code:'+x for x in sorted(changed_paths)] or ['code:']
   d.execute('INSERT OR REPLACE INTO observations VALUES(?,?,?,?)',(actor,str(root),fingerprint,encode(data)))
   seq=self.event(d,actor,'repository_observed','Checkpoint Git observado; sem copiar conteudos',data,affected,bool(old) and requires_ack)
   return {'changed':True,'fingerprint':fingerprint,'seq':seq,'observation':data}
 def history(self,after=0,limit=200):
  with self.db() as d:
   result=[]
   for row in d.execute('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?',(after,min(max(limit,1),1000))):
    r=dict(row);r['data']=json.loads(r['data']);r['resources']=json.loads(r['resources']);result.append(r)
   return result
 def status(self):
  with self.db(True) as d:self.expire(d)
  with self.db() as d:
   actors=[dict(r) for r in d.execute('SELECT * FROM actors')]
   active=set(self.active_actors(d))
   required=set(self.required_reviewers(d))
   for a in actors:a['repos']=json.loads(a['repos']);a['active']=a['id'] in active;a['review_required']=a['id'] in required
   leases=[{k:r[k] for k in r.keys() if k!='token'} for r in d.execute("SELECT * FROM leases WHERE state IN ('active','uncertain')")]
   for r in leases:r['resources']=json.loads(r['resources'])
   pending=[]
   disposed=self._notice_dispositions(d)
   for e in d.execute('SELECT seq,actor,summary,resources FROM events WHERE requires_ack=1'):
    if e['seq'] in disposed:continue
    missing=[a['id'] for a in actors if a['id'] in required and a['id']!=e['actor'] and not d.execute('SELECT 1 FROM acks WHERE actor=? AND seq=?',(a['id'],e['seq'])).fetchone()]
    if missing:pending.append({'event':e['seq'],'author':e['actor'],'summary':e['summary'],'resources':json.loads(e['resources']),'missing_ack':missing})
   return {'at':stamp(),'actors':actors,'leases':leases,'pending_ack':pending,'notice_dispositions':list(disposed.values()),'last_seq':d.execute('SELECT COALESCE(MAX(seq),0) FROM events').fetchone()[0]}
def parser():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--db',type=pathlib.Path,default=DEFAULT_DB);sp=p.add_subparsers(dest='command',required=True)
 def cmd(name,actor=True):
  c=sp.add_parser(name)
  if actor:c.add_argument('--actor',required=True)
  return c
 c=cmd('register');c.add_argument('--session',required=True);c.add_argument('--repo',action='append',required=True)
 c=cmd('announce');c.add_argument('--summary',required=True);c.add_argument('--resource',action='append',required=True);c.add_argument('--data-json',default='{}');c.add_argument('--no-require-ack',action='store_true')
 c=cmd('ack');c.add_argument('--event',type=int,required=True)
 c=cmd('notice-digest',False);c.add_argument('--event',type=int,required=True)
 c=cmd('propose-notice-disposition');c.add_argument('--event',type=int,required=True);c.add_argument('--digest',required=True);c.add_argument('--disposition',choices=['superseded','withdrawn','rejected','archived-completed'],required=True);c.add_argument('--reason',required=True);c.add_argument('--evidence',required=True);c.add_argument('--replacement-event',type=int)
 c=cmd('confirm-notice-disposition');c.add_argument('--proposal-event',type=int,required=True);c.add_argument('--digest',required=True)
 c=cmd('handoff');c.add_argument('--prior',required=True);c.add_argument('--notice-event',type=int,required=True)
 c=cmd('acquire');c.add_argument('--resource',action='append',required=True);c.add_argument('--operation',choices=['edit','deploy','merge','migration','test','inspect'],default='edit');c.add_argument('--ttl',type=int,default=600);c.add_argument('--manifest-event',type=int)
 for name in ('check','renew','release'):
  c=cmd(name);c.add_argument('--lease',required=True);c.add_argument('--token',required=True);c.add_argument('--fence',type=int,required=True)
  if name=='renew':c.add_argument('--ttl',type=int,default=600)
  if name=='release':c.add_argument('--outcome',choices=['completed','aborted'],default='completed');c.add_argument('--summary',default='Operacao encerrada')
 c=cmd('propose-resolution');c.add_argument('--lease',required=True);c.add_argument('--result',choices=['completed','aborted'],required=True);c.add_argument('--evidence',required=True)
 c=cmd('confirm-resolution');c.add_argument('--resolution',required=True)
 c=cmd('observe');c.add_argument('--repo',required=True);c.add_argument('--app-code-only',action='store_true',help='Escopo ja aplicado por padrao');c.add_argument('--no-require-ack',action='store_true')
 c=cmd('history',False);c.add_argument('--after-seq',type=int,default=0);c.add_argument('--limit',type=int,default=200)
 cmd('status',False);return p

def main():
 os.umask(0o077);a=parser().parse_args();l=Ledger(a.db);c=a.command
 if c=='register':r=l.register(a.actor,a.session,a.repo)
 elif c=='announce':r=l.announce(a.actor,a.summary,a.resource,json.loads(a.data_json),not a.no_require_ack)
 elif c=='ack':r=l.ack(a.actor,a.event)
 elif c=='notice-digest':r=l.notice_fingerprint(a.event)
 elif c=='propose-notice-disposition':r=l.propose_notice_disposition(a.actor,a.event,a.digest,a.disposition,a.reason,a.evidence,a.replacement_event)
 elif c=='confirm-notice-disposition':r=l.confirm_notice_disposition(a.actor,a.proposal_event,a.digest)
 elif c=='handoff':r=l.handoff(a.actor,a.prior,a.notice_event)
 elif c=='acquire':r=l.acquire(a.actor,a.resource,a.operation,a.ttl,a.manifest_event)
 elif c in ('check','renew','release'):
  extra=([a.ttl] if c=='renew' else [a.outcome,a.summary] if c=='release' else [])
  r=getattr(l,c)(a.actor,a.lease,a.token,a.fence,*extra)
 elif c=='propose-resolution':r=l.propose_resolution(a.actor,a.lease,a.result,a.evidence)
 elif c=='confirm-resolution':r=l.confirm_resolution(a.actor,a.resolution)
 elif c=='observe':r=l.observe(a.actor,a.repo,not a.no_require_ack)
 elif c=='history':r=l.history(a.after_seq,a.limit)
 else:r=l.status()
 print(encode({'ok':True,'result':r}))
if __name__=='__main__':
 try:main()
 except Exception as e:print(encode({'ok':False,'error':type(e).__name__,'detail':str(e)}));sys.exit(1)
