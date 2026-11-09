"""Durable, opt-in workflows. Never infer task completion from a finished AI turn."""
from __future__ import annotations
import datetime as dt
import json
import shlex
import time
from pathlib import Path
from .store import now, encode, uid


def initialize(db):
 db.executescript('''
 CREATE TABLE IF NOT EXISTS supervision(
  task_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER NOT NULL DEFAULT 300, incident TEXT, incident_at TEXT);
 CREATE TABLE IF NOT EXISTS workflow_steps(
  task_id TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, dependencies TEXT NOT NULL,
  checks TEXT NOT NULL, criteria TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
  work_request TEXT, check_request TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  max_repairs INTEGER NOT NULL DEFAULT 0, checkpoint TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL, PRIMARY KEY(task_id,id));
 ''')
 db.execute('BEGIN IMMEDIATE')
 if 'saved_context' not in {r[1] for r in db.execute('PRAGMA table_info(supervision)')}:db.execute('ALTER TABLE supervision ADD COLUMN saved_context TEXT')
 for name,definition in [('retry_after','TEXT'),('transient_retries','INTEGER NOT NULL DEFAULT 0'),('require_report','INTEGER NOT NULL DEFAULT 0'),('continuations','INTEGER NOT NULL DEFAULT 0')]:
  if name not in {r[1] for r in db.execute('PRAGMA table_info(workflow_steps)')}:db.execute(f'ALTER TABLE workflow_steps ADD COLUMN {name} {definition}')


def watch(store, task_id, timeout=300, enabled=True):
 if not store.rows('SELECT id FROM tasks WHERE id=?',(task_id,)):raise ValueError('Tarefa inexistente')
 if not 60<=timeout<=86400:raise ValueError('Intervalo inválido')
 store.execute('INSERT INTO supervision(task_id,enabled,timeout_seconds) VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET enabled=excluded.enabled,timeout_seconds=excluded.timeout_seconds',(task_id,int(enabled),timeout))


def install_plan(store, task_id, plan):
 """Validate the whole DAG before writing; an installed plan is immutable."""
 if not store.rows('SELECT id FROM tasks WHERE id=?',(task_id,)):raise ValueError('Tarefa inexistente')
 if not isinstance(plan,list) or not plan or len(plan)>100:raise ValueError('Plano inválido')
 ids=[s.get('id') for s in plan]
 if any(not isinstance(i,str) or not i or len(i)>80 for i in ids) or len(set(ids))!=len(ids):raise ValueError('IDs inválidos')
 visited=set()
 for s in plan:
  if set(s)-{'id','title','body','dependencies','checks','criteria','max_repairs','require_report'}:raise ValueError('Campo desconhecido')
  if type(s.get('require_report',True)) is not bool:raise ValueError('require_report inválido')
  for key in ('title','body','criteria'):
   if not isinstance(s.get(key),str) or not s[key].strip() or len(s[key])>50000:raise ValueError('Etapa sem instrução ou critério')
  deps=s.get('dependencies',[])
  if not isinstance(deps,list) or any(d not in visited for d in deps):raise ValueError('Dependência deve preceder a etapa; ciclos proibidos')
  visited.add(s['id'])
  checks=s.get('checks')
  if not isinstance(checks,list) or not checks or len(checks)>20:raise ValueError('Verificações obrigatórias')
  for argv in checks:
   if not isinstance(argv,list) or not argv or not all(isinstance(a,str) and a and '\x00' not in a for a in argv):raise ValueError('Use verificações argv explícitas')
  if type(s.get('max_repairs',0)) is not int or not 0<=s.get('max_repairs',0)<=2:raise ValueError('Limite de investigação inválido')
 with store.connect() as db:
  db.execute('BEGIN IMMEDIATE')
  if db.execute('SELECT 1 FROM workflow_steps WHERE task_id=?',(task_id,)).fetchone():raise ValueError('Plano já instalado; preserve o histórico')
  for index,s in enumerate(plan):
   db.execute('INSERT INTO workflow_steps(task_id,id,position,title,body,dependencies,checks,criteria,max_repairs,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(task_id,s['id'],index,s['title'],s['body'],encode(s.get('dependencies',[])),encode(s['checks']),s['criteria'],s.get('max_repairs',0),now()))
   db.execute('UPDATE workflow_steps SET require_report=? WHERE task_id=? AND id=?',(int(s.get('require_report',True)),task_id,s['id']))
   db.execute('INSERT INTO steps(task_id,id,title,state,weight,detail,updated_at) VALUES(?,?,?,?,?,?,?)',(task_id,'workflow-'+s['id'],s['title'],'queued',1,s['criteria'],now()))
 store.event('workflow_installed','Plano persistente instalado',task_id,{'steps':len(plan)})


def elapsed(value, timestamp):
 try:
  parsed=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
  if parsed.tzinfo is None:return float('inf')
  return max(0,timestamp-parsed.timestamp())
 except (ValueError,TypeError,AttributeError):return float('inf')


class Supervisor:
 def __init__(self,store):self.store=store

 def transition(self,db,task_id,state,stage,detail):
  db.execute('UPDATE tasks SET state=?,stage=?,detail=?,updated_at=? WHERE id=?',(state,stage,detail,now(),task_id))

 def scan(self,timestamp=None):
  timestamp=time.time() if timestamp is None else timestamp
  # No fresh heartbeat is manufactured here. Only agent updates or output count.
  for task in self.store.rows("SELECT t.*,s.timeout_seconds,s.incident FROM tasks t JOIN supervision s ON s.task_id=t.id WHERE s.enabled=1 AND t.state='running'"):
   rows=self.store.rows("SELECT updated_at FROM requests WHERE task_id=? AND state IN ('running','waiting','paused') ORDER BY updated_at DESC LIMIT 1",(task['id'],))
   seen=max([task['updated_at']]+[r['updated_at'] for r in rows])
   if elapsed(seen,timestamp)<task['timeout_seconds']:continue
   with self.store.connect() as db:
    db.execute('BEGIN IMMEDIATE')
    current=db.execute('SELECT state,updated_at FROM tasks WHERE id=?',(task['id'],)).fetchone()
    if not current or current['state']!='running' or current['updated_at']!=task['updated_at']:continue
    live=db.execute("SELECT updated_at FROM requests WHERE task_id=? AND state IN ('running','waiting','paused') ORDER BY updated_at DESC LIMIT 1",(task['id'],)).fetchone()
    if live and elapsed(live['updated_at'],timestamp)<task['timeout_seconds']:continue
    incident=uid()
    db.execute('UPDATE supervision SET incident=?,incident_at=?,saved_context=? WHERE task_id=?',(incident,now(),encode({'stage':task['stage'],'detail':task['detail']}),task['id']))
    self.transition(db,task['id'],'interrupted','Sem atividade verificável','Nenhuma atualização de trabalho por cinco minutos (ou intervalo configurado). Execuções existentes não foram duplicadas nem encerradas. Confira o checkpoint e os processos.')
   self.store.event('stalled','Paralisação ou ausência de atividade detectada',task['id'],{'incident':incident,'last_activity':seen})
   self.store.queue_mail('stalled:'+incident,'Vigia: tarefa interrompida — '+task['title'],f"# Ausência de atividade verificável\n\nTarefa: {task['title']}\n\nÚltima atividade: {seen}.\n\nO estado foi alterado para interrompido. Isso não prova que um processo silencioso terminou. Nenhum comando foi repetido ou encerrado.\n\nCheckpoint: {task['detail']}\n\nEtapa: {task['stage']}. Abra o Vigia para conferir.")

 def advance(self):
  # All scheduling/association is one SQLite transaction; parallel scans cannot duplicate jobs.
  with self.store.connect() as db:
   db.execute('BEGIN IMMEDIATE')
   tasks=db.execute("SELECT t.* FROM tasks t JOIN supervision s ON s.task_id=t.id WHERE s.enabled=1 AND t.state IN ('running','queued') AND EXISTS(SELECT 1 FROM workflow_steps w WHERE w.task_id=t.id) ORDER BY t.created_at").fetchall()
   for task in tasks:
    steps=[dict(s) for s in db.execute('SELECT * FROM workflow_steps WHERE task_id=? ORDER BY position',(task['id'],))]
    for step in steps:
     if step['state'] not in ('working','checking'):continue
     rid=step['work_request'] if step['state']=='working' else step['check_request']
     request=db.execute('SELECT * FROM requests WHERE id=?',(rid,)).fetchone()
     if not request or request['state'] in ('queued','running','waiting','paused'):continue
     if request['state']!='completed':
      if db.execute("SELECT 1 FROM quota_waits WHERE request_id=? AND state='pending'",(rid,)).fetchone():continue
      if step['state']=='working' and request['state'] in ('failed','interrupted') and request['failure_class'] in ('transport','executor_restart') and step['transient_retries']<2:
       delay=30*(2**step['transient_retries'])
       retry=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=delay)).isoformat(timespec='seconds')
       db.execute("UPDATE workflow_steps SET state='queued',transient_retries=transient_retries+1,retry_after=?,checkpoint=?,updated_at=? WHERE task_id=? AND id=?",(retry,'Falha de transporte em '+rid+'. Retomar thread e conferir efeitos anteriores; nunca repetir comandos cegamente.',now(),task['id'],step['id']))
       self.transition(db,task['id'],'queued','Aguardar retomada de transporte',f'Tentativa limitada em {delay}s; checkpoint preservado.')
       self._mail(db,'workflow-transport:'+rid,task,f'Falha de transporte. Retomada limitada agendada em {delay}s. Execução anterior: {rid}.')
       continue
      if step['state']=='checking' and request['state']=='failed' and step['attempts']<=step['max_repairs']:
       db.execute("UPDATE workflow_steps SET state='queued',checkpoint=?,updated_at=? WHERE task_id=? AND id=?",('Verificação falhou: '+rid+'; investigar antes de repetir.',now(),task['id'],step['id']))
       continue
      db.execute("UPDATE workflow_steps SET state='waiting',checkpoint=?,updated_at=? WHERE task_id=? AND id=?",('Execução '+rid+' terminou '+request['state']+'. Requer diagnóstico; não repetida automaticamente.',now(),task['id'],step['id']))
      self._mail(db,'workflow-failed:'+rid,task,'Etapa requer diagnóstico; consulte a execução '+rid+'.')
     elif step['state']=='working':
      if step['require_report']:
       report=json.loads(request['run_report'] or '{}')
       if report.get('status')=='continue' and request['activity_count']>0 and step['continuations']<20:
        db.execute("UPDATE workflow_steps SET state='queued',continuations=continuations+1,checkpoint=?,updated_at=? WHERE task_id=? AND id=?",(report.get('checkpoint',''),now(),task['id'],step['id']))
        continue
       if report.get('status')!='completed':
        db.execute("UPDATE workflow_steps SET state='waiting',checkpoint=?,updated_at=? WHERE task_id=? AND id=?",(report.get('checkpoint') or 'Sem relatório estruturado ou continuidade sem ferramentas; revisão necessária.',now(),task['id'],step['id']))
        self._mail(db,'workflow-report:'+rid,task,'Execução '+rid+' requer revisão do checkpoint. O encerramento de um turno não concluiu a etapa.\n\n'+(report.get('checkpoint') or 'Relatório estruturado ausente.'))
        continue
      # Independent checks run as an explicit shell request with each argv shell-quoted.
      commands=[' '.join(shlex.quote(a) for a in argv) for argv in json.loads(step['checks'])]
      rid=self._request(db,task,'shell','set -e\n'+'\n'.join(commands))
      db.execute("UPDATE workflow_steps SET state='checking',check_request=?,checkpoint=?,updated_at=? WHERE task_id=? AND id=?",(rid,'Trabalho terminou; verificações independentes pendentes.',now(),task['id'],step['id']))
      self.transition(db,task['id'],'running','Validar: '+step['title'],'Verificações independentes na execução '+rid)
     else:
      db.execute("UPDATE workflow_steps SET state='completed',checkpoint=?,updated_at=? WHERE task_id=? AND id=?",('Verificações aprovadas: '+rid,now(),task['id'],step['id']))
      db.execute("UPDATE steps SET state='completed',detail=?,finished_at=?,updated_at=? WHERE task_id=? AND id=?",('Evidência: '+rid,now(),now(),task['id'],'workflow-'+step['id']))
      self._mail(db,'workflow-step:'+rid,task,'Etapa validada: '+step['title']+'. Evidência: '+rid)
    # Refresh after transitions. Waiting/paused/interrupted is never bypassed.
    if db.execute('SELECT state FROM tasks WHERE id=?',(task['id'],)).fetchone()['state'] not in ('running','queued'):continue
    steps=[dict(s) for s in db.execute('SELECT * FROM workflow_steps WHERE task_id=? ORDER BY position',(task['id'],))]
    if all(s['state']=='completed' for s in steps):
     self.transition(db,task['id'],'completed','Plano registrado validado','Todas as etapas e verificações deste plano foram concluídas. Isso não inclui escopos externos ao plano nem deploy.')
     self._mail(db,'workflow-complete:'+task['id'],task,'Plano registrado concluído com verificações. Nenhum deploy foi autorizado por essa conclusão.')
     continue
    if db.execute("SELECT 1 FROM requests WHERE task_id=? AND state IN ('queued','running','paused','waiting')",(task['id'],)).fetchone():continue
    done={s['id'] for s in steps if s['state']=='completed'}
    ready=next((s for s in steps if s['state']=='queued' and (not s['retry_after'] or s['retry_after']<=now()) and set(json.loads(s['dependencies']))<=done),None)
    if ready:
     body=ready['body']+'\n\nCritérios obrigatórios: '+ready['criteria']+'\n\nCheckpoint persistente: '+ready['checkpoint']+'\nNão declare a tarefa completa apenas por terminar um turno. Não faça deploy, merge com VPS ou envio a terceiros.'
     if ready['require_report']:body+='\nFinalize com <vigia-result>{"status":"completed|continue|blocked","checkpoint":"resultado, evidências, pendências e próxima ação"}</vigia-result>. Use continue para trabalho parcial, completed apenas se todos os critérios desta etapa foram cumpridos e blocked para impedimento real. Continuidade sem executar ferramentas não será repetida.'
     rid=self._request(db,task,'ai',body)
     db.execute("UPDATE workflow_steps SET state='working',work_request=?,attempts=attempts+1,updated_at=? WHERE task_id=? AND id=?",(rid,now(),task['id'],ready['id']))
     db.execute("UPDATE steps SET state='running',started_at=COALESCE(started_at,?),updated_at=? WHERE task_id=? AND id=?",(now(),now(),task['id'],'workflow-'+ready['id']))
     self.transition(db,task['id'],'running',ready['title'],'Execução supervisionada '+rid+'; critérios: '+ready['criteria'])
    elif any(s['state']=='waiting' for s in steps):
     blocked=[s['title'] for s in steps if s['state']=='waiting']
     self.transition(db,task['id'],'waiting','Resolver impedimentos registrados','Não há etapa independente pronta. Pendências: '+', '.join(blocked))

 def _request(self,db,task,kind,body):
  rid=uid();context={k:task[k] for k in ('cwd','environment','scope','title','detail')}
  db.execute('INSERT INTO requests(id,task_id,kind,body,state,at,updated_at,context) VALUES(?,?,?,?,?,?,?,?)',(rid,task['id'],kind,body,'queued',now(),now(),encode(context)))
  return rid

 def _mail(self,db,event_id,task,body):
  db.execute('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,?)',(event_id,now(),'Vigia: '+task['title'],body,'queued',now()))
