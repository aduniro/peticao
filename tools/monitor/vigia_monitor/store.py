from __future__ import annotations
import datetime as dt, hashlib, json, os, sqlite3, uuid
from contextlib import contextmanager
from pathlib import Path

STATE=Path(os.environ.get('VIGIA_STATE',str(Path.home()/'.local/state/peticao-monitor')))
STATES={'queued','running','waiting','paused','completed','failed','interrupted'}
def now():return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
def uid():return uuid.uuid4().hex
def encode(value):return json.dumps(value,ensure_ascii=False,sort_keys=True)
def checksum(value):return hashlib.sha256(encode(value).encode()).hexdigest()

class Store:
 def __init__(self,path=None):
  self.path=Path(path or STATE/'monitor.sqlite');self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with self.connect() as db:
   db.executescript('''
   PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,state TEXT NOT NULL,cwd TEXT NOT NULL,environment TEXT,scope TEXT,stage TEXT,detail TEXT,eta TEXT,created_at TEXT,updated_at TEXT,thread_id TEXT,import_hash TEXT);
   CREATE TABLE IF NOT EXISTS steps(task_id TEXT,id TEXT,parent TEXT,title TEXT,state TEXT,weight REAL,detail TEXT,PRIMARY KEY(task_id,id));
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,at TEXT,task_id TEXT,kind TEXT,title TEXT,data TEXT);
   CREATE INDEX IF NOT EXISTS events_task ON events(task_id,seq);
   CREATE TABLE IF NOT EXISTS snapshots(source TEXT PRIMARY KEY,at TEXT,status TEXT,payload TEXT);
   CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,task_id TEXT,kind TEXT,body TEXT,state TEXT,at TEXT,updated_at TEXT,pid INTEGER,exit_code INTEGER,control TEXT);
   CREATE TABLE IF NOT EXISTS output(seq INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT,at TEXT,kind TEXT,text TEXT);
   CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,request_id TEXT,rpc_id TEXT,method TEXT,payload TEXT,at TEXT,expires REAL,decision TEXT,answered INTEGER DEFAULT 0);
   CREATE TABLE IF NOT EXISTS mail(id TEXT PRIMARY KEY,at TEXT,subject TEXT,state TEXT,provider_id TEXT,detail TEXT);
   CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,at TEXT,subject TEXT,body TEXT,state TEXT,updated_at TEXT);
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
   ''')
   existing={r[1] for r in db.execute('PRAGMA table_info(steps)')}
   for column in ['started_at','finished_at','updated_at','eta']:
    if column not in existing:db.execute(f'ALTER TABLE steps ADD COLUMN {column} TEXT')
  self.path.chmod(0o600)
 @contextmanager
 def connect(self):
  db=sqlite3.connect(self.path,timeout=10);db.row_factory=sqlite3.Row;db.execute('PRAGMA busy_timeout=10000')
  try:yield db;db.commit()
  except Exception:db.rollback();raise
  finally:db.close()
 def rows(self,sql,args=()):
  with self.connect() as db:return [dict(r) for r in db.execute(sql,args).fetchall()]
 def execute(self,sql,args=()):
  with self.connect() as db:db.execute(sql,args)
 def event(self,kind,title,task_id=None,data=None,event_id=None):
  with self.connect() as db:
   result=db.execute('INSERT OR IGNORE INTO events(id,at,task_id,kind,title,data) VALUES(?,?,?,?,?,?)',(event_id or uid(),now(),task_id,kind,title,encode(data or {})))
   return bool(result.rowcount)
 def task(self,task_id,**values):
  if not task_id or len(task_id)>100:raise ValueError('Identificador inválido')
  if values.get('state','queued') not in STATES:raise ValueError('Estado inválido')
  old=self.rows('SELECT * FROM tasks WHERE id=?',(task_id,))
  row=old[0] if old else dict(id=task_id,title=task_id,state='queued',cwd='/mnt/dev/peticao',environment='local',scope='',stage='',detail='',eta='',created_at=now(),thread_id=None,import_hash=None)
  for k,v in values.items():
   if k not in row and k!='updated_at':raise ValueError('Campo de tarefa inválido')
   row[k]=v
  row['updated_at']=values.get('updated_at',now())
  with self.connect() as db:
   keys=','.join(row);db.execute(f"INSERT OR REPLACE INTO tasks({keys}) VALUES({','.join('?' for _ in row)})",tuple(row.values()))
  return row
 def step(self,task_id,step_id,title,state='queued',weight=1,parent=None,detail='',eta=None):
  if state not in STATES or not 0<weight<=100000:raise ValueError('Etapa inválida')
  with self.connect() as db:
   rows=[dict(r) for r in db.execute('SELECT * FROM steps WHERE task_id=?',(task_id,))];ancestors={r['id']:r['parent'] for r in rows};ancestors[step_id]=parent
   cur=parent;seen={step_id}
   while cur:
    if cur in seen:raise ValueError('Ciclo entre etapas')
    if cur not in ancestors:raise ValueError('Etapa pai inexistente')
    seen.add(cur);cur=ancestors[cur]
   previous=next((r for r in rows if r['id']==step_id),{})
   started=previous.get('started_at');finished=previous.get('finished_at')
   if state=='running' and previous.get('state')!='running' and (not started or previous.get('state') in {'completed','failed','interrupted'}):started=now();finished=None
   if state in {'completed','failed','interrupted'} and not finished:finished=now()
   db.execute('INSERT OR REPLACE INTO steps(task_id,id,parent,title,state,weight,detail,started_at,finished_at,updated_at,eta) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(task_id,step_id,parent,title,state,weight,detail,started,finished,now(),eta if eta is not None else previous.get('eta')))
 def progress(self,task_id):
  rows=self.rows('SELECT * FROM steps WHERE task_id=?',(task_id,));parents={r['parent'] for r in rows if r['parent']};leaves=[r for r in rows if r['id'] not in parents]
  if not leaves:return None
  return round(100*sum(r['weight'] for r in leaves if r['state']=='completed')/sum(r['weight'] for r in leaves),1)
 def snapshot(self,source,payload,status='online'):
  self.execute('INSERT OR REPLACE INTO snapshots VALUES(?,?,?,?)',(source,now(),status,encode(payload)))
 def request(self,task_id,kind,body):
  if kind not in ('ai','shell','vps'):raise ValueError('Tipo de execução inválido')
  if not body.strip() or len(body)>50000:raise ValueError('Pedido vazio ou grande demais')
  if not self.rows('SELECT id FROM tasks WHERE id=?',(task_id,)):raise ValueError('Selecione uma tarefa existente')
  rid=uid();self.execute('INSERT INTO requests(id,task_id,kind,body,state,at,updated_at) VALUES(?,?,?,?,?,?,?)',(rid,task_id,kind,body,'queued',now(),now()));self.event('request','Pedido na fila',task_id,{'id':rid,'kind':kind});return rid
 def claim(self):
  with self.connect() as db:
   db.execute('BEGIN IMMEDIATE');r=db.execute("SELECT * FROM requests q WHERE state='queued' AND NOT EXISTS (SELECT 1 FROM requests a WHERE a.task_id=q.task_id AND a.state IN ('running','paused')) ORDER BY at LIMIT 1").fetchone()
   if not r:return None
   db.execute("UPDATE requests SET state='running',updated_at=? WHERE id=?",(now(),r['id']));return dict(r)
 def out(self,request_id,text,kind='output'):
  self.execute('INSERT INTO output(request_id,at,kind,text) VALUES(?,?,?,?)',(request_id,now(),kind,text[-30000:]))
 def queue_mail(self,event_id,subject,body):
  self.execute('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,?)',(event_id,now(),subject,body,'queued',now()))
 def decide(self,approval_id,decision):
  import time
  if decision not in ('accept','decline'):raise ValueError('Decisão inválida')
  with self.connect() as db:
   result=db.execute('UPDATE approvals SET decision=? WHERE id=? AND decision IS NULL AND answered=0 AND expires>?',(decision,approval_id,time.time()))
   if result.rowcount!=1:raise ValueError('Pedido expirado ou já decidido')
 def recover(self):
  with self.connect() as db:
   # Never replay a possibly executed command or a possibly sent email automatically.
   db.execute("UPDATE requests SET state='interrupted',updated_at=? WHERE state IN ('running','paused')",(now(),))
   db.execute("UPDATE approvals SET decision='decline',answered=1 WHERE answered=0")
   db.execute("UPDATE outbox SET state='uncertain' WHERE state='sending'")
