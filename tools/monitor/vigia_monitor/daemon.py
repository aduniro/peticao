from __future__ import annotations
import concurrent.futures, fcntl, json, os, signal, subprocess, threading, time
from pathlib import Path
from .store import Store, STATE, now
from .sources import Collector, ROOT, clean
from .runner import execute_request

class Daemon:
 def __init__(self,store=None,remote=True,mail=True):
  self.store=store or Store();self.collector=Collector(self.store,remote);self.stop=threading.Event();self.mail=mail;self.pool=concurrent.futures.ThreadPoolExecutor(max_workers=2);self.work={};self.last_progress=time.monotonic();self.mail_busy=False
 def notifications(self):
  if not self.mail:return
  if time.monotonic()-self.last_progress>=1800:
   tasks=self.store.rows("SELECT * FROM tasks WHERE state IN ('running','waiting','paused')")
   if tasks:
    body='# Andamento das tarefas\n\n'+'\n\n'.join(f"## {r['title']}\n\nEstado: {r['state']}. Etapa: {r['stage']}.\n\n{r['detail']}\n\nAmbiente: {r['environment']}. Estimativa informada: {r['eta'] or 'não informada'}." for r in tasks)
    self.store.queue_mail('progress:'+str(int(time.time()//1800)),'Vigia: atualização de andamento',body)
   self.last_progress=time.monotonic()
  for row in self.store.rows("SELECT * FROM outbox WHERE state='queued' ORDER BY at LIMIT 1"):
   self.store.execute("UPDATE outbox SET state='sending',updated_at=? WHERE id=?",(now(),row['id']))
   try:
    result=subprocess.run(['/usr/bin/node',str(ROOT/'tools/monitor/mail.mjs')],input=json.dumps({'subject':row['subject'],'body':row['body']}),capture_output=True,text=True,timeout=40)
    data=json.loads(result.stdout);status=int(data.get('status',0));state='accepted' if 200<=status<300 else 'failed';provider=data.get('id')
   except (OSError,ValueError,subprocess.TimeoutExpired):state='uncertain';provider=None
   self.store.execute('UPDATE outbox SET state=?,updated_at=? WHERE id=?',(state,now(),row['id']))
   self.store.execute('INSERT OR REPLACE INTO mail VALUES(?,?,?,?,?,?)',(provider or row['id'],now(),row['subject'],state,provider,'Aceite do provedor não comprova entrega.'))
 def run(self):
  STATE.mkdir(parents=True,exist_ok=True,mode=0o700);lock=(STATE/'daemon.lock').open('a')
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeError('Coletor já está em execução')
  self.store.recover();self.store.event('daemon','Coletor iniciado')
  for s in (signal.SIGTERM,signal.SIGINT):signal.signal(s,lambda *_:self.stop.set())
  tick=0
  try:
   while not self.stop.is_set():
    started=time.monotonic()
    try:self.collector.collect(slow=tick%5==0)
    except Exception as e:self.store.event('collector_error','Falha de coleta',data={'type':type(e).__name__})
    self.store.snapshot('daemon',{'pid':os.getpid(),'alive':True})
    self.work={key:f for key,f in self.work.items() if not f.done()}
    if len(self.work)<2:
     request=self.store.claim()
     if request:self.work[request['id']]=self.pool.submit(execute_request,self.store,request)
    if tick%30==0 and self.collector.remote.enabled:
     try:
      from .diagnostics import pull
      pull(self.store)
     except Exception:self.store.snapshot('diagnostics',{'available':False},'unavailable')
    if not self.mail_busy:
     self.mail_busy=True
     def send():
      try:self.notifications()
      finally:self.mail_busy=False
     threading.Thread(target=send,daemon=True).start()
    tick+=1;self.stop.wait(max(.2,2-(time.monotonic()-started)))
  finally:
   for rid in self.work:self.store.execute('UPDATE requests SET control=? WHERE id=?',(json.dumps({'action':'cancel'}),rid))
   self.collector.stop();self.pool.shutdown(wait=True,cancel_futures=True);self.store.snapshot('daemon',{'pid':os.getpid(),'alive':False},'stopped');self.store.event('daemon','Coletor encerrado');lock.close()
