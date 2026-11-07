from __future__ import annotations
import json, subprocess, time
from .sources import clean
from .store import now
class RemoteRejected(RuntimeError):pass
REMOTE_EXEC='/home/adunir/.local/share/peticao-monitor/remote_executor.py'
def call(payload):
 r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=5','peticao','/usr/bin/python3',REMOTE_EXEC],input=json.dumps(payload),capture_output=True,text=True,timeout=12)
 try:data=json.loads(r.stdout)
 except ValueError:raise RuntimeError('Executor remoto indisponível')
 if data.get('error'):raise RemoteRejected('Executor remoto: '+data['error'])
 if r.returncode:raise RuntimeError('Executor remoto indisponível')
 return data

def run(store,request,task,stop=None):
 rid=request['id'];saved=store.rows('SELECT value FROM meta WHERE key=?',('remote-offset:'+request['id'],));offset=int(saved[0]['value']) if saved else 0;started=False;offline=False
 def persist_output(data):
  with store.connect() as db:
   if data.get('output'):db.execute('INSERT INTO output(request_id,at,kind,text) VALUES(?,?,?,?)',(rid,now(),'output',clean(data['output'],32768)))
   db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)',('remote-offset:'+rid,str(data['offset'])))
 while True:
  if stop and stop.is_set():return 'waiting',None
  try:
   if not started:call({'action':'start','id':rid,'command':request['body'],'cwd':task['cwd']});started=True;store.out(rid,'Job persistente na VPS: '+rid,'remote')
   # Acknowledged controls are idempotent on the VPS, even after SSH loss.
   row=store.rows('SELECT control FROM requests WHERE id=?',(rid,))[0]
   if row['control']:
    control=json.loads(row['control']);call({'action':'control','id':rid,'control':control});store.execute('UPDATE requests SET control=NULL WHERE id=? AND control=?',(rid,row['control']))
    if control['action'] in ('pause','resume'):
     store.event('control',control['action'],request['task_id'],{'id':rid,'environment':'VPS'});store.queue_mail('control:'+rid+':'+control['id'],'Vigia: controle da execução na VPS',f"# Controle confirmado\n\nTarefa: {task['title']}\n\nAção: {control['action']}\n\nVPS; sem alteração do site pelo monitor.")
   data=call({'action':'read','id':rid,'offset':offset})
   persist_output(data)
   offset=data['offset'];remote=data['state'];state=remote.get('state','running')
   if state in ('completed','failed','interrupted'):
    # One final poll may contain remaining buffered output larger than one chunk.
    while True:
     tail=call({'action':'read','id':rid,'offset':offset})
     if tail['offset']==offset:break
     persist_output(tail);offset=tail['offset']
    return state,remote.get('exit_code')
   store.execute('UPDATE requests SET state=?,updated_at=? WHERE id=?',('paused' if state=='paused' else 'running',now(),rid))
   offline=False
  except RemoteRejected as error:store.out(rid,str(error),'error');return 'failed',None
  except (OSError,ValueError,RuntimeError,subprocess.TimeoutExpired):
   if not offline:store.out(rid,'Sem conexão: o job remoto não será reenviado. Retomando a observação por seu ID.','remote');offline=True
   store.execute("UPDATE requests SET state='waiting',updated_at=? WHERE id=?",(now(),rid));stop.wait(5) if stop else time.sleep(5)
  stop.wait(1) if stop else time.sleep(1)
