"""Opt-in recovery of managed, terminal usage failures. Never infer entitlement."""
from __future__ import annotations
import json
import math
import os
import time
from .store import now, uid

POLL_SECONDS=900
WAIT_STAGE='Aguardar quota Codex'


def task_eligible(row):
 return row['task_state'] in ('running','queued') or (row['task_state']=='waiting' and row['task_stage']==WAIT_STAGE)


def initialize(db):
 db.executescript('''
 CREATE TABLE IF NOT EXISTS quota_policy(task_id TEXT PRIMARY KEY,enabled_since TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS quota_waits(
 request_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, thread_id TEXT NOT NULL,
 next_check REAL NOT NULL, state TEXT NOT NULL, successor TEXT,
 probes INTEGER NOT NULL DEFAULT 0, checkpoint TEXT NOT NULL);
 ''')


def configure(store,task_id,enabled):
 with store.connect() as db:
  db.execute('BEGIN IMMEDIATE')
  if not db.execute('SELECT 1 FROM supervision WHERE task_id=? AND enabled=1',(task_id,)).fetchone():raise ValueError('Exige tarefa supervisionada')
  if enabled:db.execute('INSERT OR REPLACE INTO quota_policy VALUES(?,?)',(task_id,now()))
  else:
   db.execute('DELETE FROM quota_policy WHERE task_id=?',(task_id,))
   db.execute("UPDATE quota_waits SET state='canceled' WHERE task_id=? AND state='pending'",(task_id,))
 store.event('quota_policy','Retomada de quota ativada para futuros pedidos' if enabled else 'Retomada de quota desativada',task_id)


def next_check(snapshot,timestamp):
 """A reset is a lower bound for a metadata probe, never permission to execute."""
 bucket=snapshot.get('rateLimits',{}) if isinstance(snapshot,dict) else {}
 resets=[]
 if isinstance(bucket,dict):
  for key in ('primary','secondary'):
   window=bucket.get(key)
   if not isinstance(window,dict):continue
   used,reset=window.get('usedPercent'),window.get('resetsAt')
   if type(used) in (int,float) and used>=100 and type(reset) in (int,float) and math.isfinite(reset) and reset>timestamp:resets.append(reset+15)
 # Credit replenishment can happen before a quota-window reset. Metadata only.
 return min(resets+[timestamp+POLL_SECONDS])


def allowed(snapshot):
 # CLI 0.167 schema explicitly says null must not be inferred from percentages.
 if not isinstance(snapshot,dict) or snapshot.get('ordinaryUsageAllowed') is not True:return False
 bucket=snapshot.get('rateLimits')
 if not isinstance(bucket,dict) or bucket.get('limitId') not in (None,'codex'):return False
 if bucket.get('spendControlReached') is True or bucket.get('rateLimitReachedType') is not None:return False
 return True


def record(store,request,thread_id,error,snapshot):
 # No regex/message guessing, no generic HTTP429, no security or session budget.
 if not isinstance(error,dict) or error.get('codexErrorInfo')!='usageLimitExceeded' or error.get('misalignment') is not None:return False
 with store.connect() as db:
  db.execute('BEGIN IMMEDIATE')
  policy=db.execute('SELECT enabled_since FROM quota_policy WHERE task_id=?',(request['task_id'],)).fetchone()
  step=db.execute("SELECT checkpoint FROM workflow_steps w JOIN supervision s ON s.task_id=w.task_id WHERE w.work_request=? AND w.state='working' AND s.enabled=1",(request['id'],)).fetchone()
  current=db.execute('SELECT state,control,at FROM requests WHERE id=?',(request['id'],)).fetchone()
  task=db.execute('SELECT state,cwd,environment,scope FROM tasks WHERE id=?',(request['task_id'],)).fetchone()
  if not policy or not step or not current or not task or current['at']<=policy['enabled_since'] or request['kind']!='ai' or task['state'] not in ('running','queued') or current['control']:return False
  try:context=json.loads(request.get('context') or '{}')
  except ValueError:return False
  if not isinstance(context,dict) or any(context.get(k)!=task[k] for k in ('cwd','environment','scope')):return False
  if db.execute("SELECT 1 FROM approvals WHERE request_id=? AND (answered=0 OR decision!='accept' OR decision IS NULL)",(request['id'],)).fetchone():return False
  if db.execute("SELECT count(*) FROM quota_waits WHERE task_id=? AND state='resumed'",(request['task_id'],)).fetchone()[0]>=2:return False
  checkpoint=step['checkpoint'] or 'Retomar a thread registrada e conferir os efeitos anteriores antes de qualquer ação.'
  db.execute("INSERT OR IGNORE INTO quota_waits VALUES(?,?,?,?,'pending',NULL,0,?)",(request['id'],request['task_id'],thread_id,next_check(snapshot,time.time()),checkpoint))
  db.execute("UPDATE requests SET failure_class='usage_limit' WHERE id=?",(request['id'],))
  db.execute("UPDATE tasks SET state='waiting',stage=?,detail=?,updated_at=? WHERE id=?",(WAIT_STAGE,'Limite de uso confirmado. Apenas sondagem de metadados; nenhum agente trabalhando. Checkpoint: '+checkpoint,now(),request['task_id']))
 return True


def probe():
 from .runner import Rpc
 rpc=Rpc()
 try:
  rpc.initialize()
  return rpc.call('account/rateLimits/read',{},timeout=15)
 finally:rpc.close()


def advance(store,read_limits=probe,timestamp=None):
 timestamp=time.time() if timestamp is None else timestamp
 # Only the owning daemon invokes this. Transactional lease prevents parallel probes.
 for wait in store.rows("SELECT * FROM quota_waits WHERE state='pending' AND next_check<=?",(timestamp,)):
  with store.connect() as db:
   db.execute('BEGIN IMMEDIATE')
   row=db.execute("SELECT q.*,r.state request_state,r.kind,r.pid,r.control,r.body,r.context,r.failure_class,t.state task_state,t.stage task_stage FROM quota_waits q JOIN requests r ON r.id=q.request_id JOIN tasks t ON t.id=q.task_id WHERE q.request_id=? AND q.state='pending' AND q.next_check<=?",(wait['request_id'],timestamp)).fetchone()
   if not row:continue
   enabled=db.execute('SELECT 1 FROM quota_policy p JOIN supervision s ON s.task_id=p.task_id WHERE p.task_id=? AND s.enabled=1',(row['task_id'],)).fetchone()
   if not enabled or not task_eligible(row) or row['request_state']!='failed' or row['failure_class']!='usage_limit' or row['control']:
    db.execute("UPDATE quota_waits SET state='canceled' WHERE request_id=?",(row['request_id'],));continue
   db.execute('UPDATE quota_waits SET next_check=?,probes=probes+1 WHERE request_id=?',(timestamp+POLL_SECONDS,row['request_id']))
  try:snapshot=read_limits()
  except Exception:
   store.event('quota_probe','Consulta de quota indisponível; nenhuma execução iniciada',wait['task_id']);continue
  with store.connect() as db:
   db.execute('BEGIN IMMEDIATE')
   current=db.execute("SELECT q.*,r.state request_state,r.failure_class,r.pid,r.control,t.state task_state,t.stage task_stage FROM quota_waits q JOIN requests r ON r.id=q.request_id JOIN tasks t ON t.id=q.task_id WHERE q.request_id=?",(wait['request_id'],)).fetchone()
   enabled=db.execute('SELECT 1 FROM quota_policy p JOIN supervision s ON s.task_id=p.task_id WHERE p.task_id=? AND s.enabled=1',(wait['task_id'],)).fetchone()
   if not current or current['state']!='pending':continue
   if not enabled or not task_eligible(current) or current['request_state']!='failed' or current['failure_class']!='usage_limit' or current['control']:
    db.execute("UPDATE quota_waits SET state='canceled' WHERE request_id=?",(wait['request_id'],));continue
   if not allowed(snapshot):
    db.execute('UPDATE quota_waits SET next_check=? WHERE request_id=?',(next_check(snapshot,timestamp),wait['request_id']));continue
   if current['pid']:
    try:os.kill(current['pid'],0);continue
    except ProcessLookupError:pass
    except PermissionError:continue
   if db.execute("SELECT 1 FROM requests WHERE task_id=? AND state IN ('running','queued','paused','waiting')",(wait['task_id'],)).fetchone():continue
   step=db.execute("SELECT id FROM workflow_steps WHERE task_id=? AND work_request=? AND state='working'",(wait['task_id'],wait['request_id'])).fetchone()
   thread=db.execute("SELECT id FROM threads WHERE task_id=? AND host='local'",(wait['task_id'],)).fetchone()
   if not step or not thread or thread['id']!=wait['thread_id']:continue
   successor=uid()
   body=row['body']+'\n\nRetomada após limite de uso, execução anterior '+wait['request_id']+'. Confira histórico e efeitos antes de agir; não repita comandos cegamente. Checkpoint: '+wait['checkpoint']
   db.execute("INSERT INTO requests(id,task_id,kind,body,state,at,updated_at,context) VALUES(?,?,'ai',?,'queued',?,?,?)",(successor,wait['task_id'],body,now(),now(),row['context']))
   db.execute('UPDATE workflow_steps SET work_request=?,updated_at=? WHERE task_id=? AND id=?',(successor,now(),wait['task_id'],step['id']))
   db.execute("UPDATE quota_waits SET state='resumed',successor=? WHERE request_id=?",(successor,wait['request_id']))
   db.execute("UPDATE tasks SET state='queued',stage='Retomar após quota',detail=?,updated_at=? WHERE id=?",('Permissão confirmada; continuação '+successor+' aguardando executor. Checkpoint: '+wait['checkpoint'],now(),wait['task_id']))
  store.event('quota_resumed','Permissão de uso confirmada; continuação enfileirada na mesma thread',wait['task_id'],{'previous':wait['request_id'],'successor':successor})
