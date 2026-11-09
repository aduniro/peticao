from __future__ import annotations
import concurrent.futures, fcntl, json, os, signal, subprocess, threading, time
from pathlib import Path
from .store import Store, STATE, now
from .sources import Collector, ROOT, clean
from .runner import execute_request
from .supervision import Supervisor

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
  from .notifications import deliver_one
  deliver_one(self.store)
 def run(self):
  STATE.mkdir(parents=True,exist_ok=True,mode=0o700);lock=(STATE/'daemon.lock').open('a')
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeError('Coletor já está em execução')
  self.store.recover();self.store.event('daemon','Coletor iniciado');self.store.queue_mail('daemon:start:'+str(time.time_ns()),'Vigia: coletor iniciado ou reiniciado',f"# Monitor ativo\n\nColetor local iniciado às {now()}.\n\nA tela pode ser fechada sem parar a coleta. O site e seus serviços não foram reiniciados.")
  for s in (signal.SIGTERM,signal.SIGINT):signal.signal(s,lambda *_:self.stop.set())
  tick=0
  try:
   while not self.stop.is_set():
    started=time.monotonic()
    try:self.collector.collect(slow=tick%5==0)
    except Exception as e:self.store.event('collector_error','Falha de coleta',data={'type':type(e).__name__})
    self.store.snapshot('daemon',{'pid':os.getpid(),'alive':True})
    try:
     from .quota import advance as advance_quota
     advance_quota(self.store)
     Supervisor(self.store).advance()
    except Exception as error:self.store.event('supervisor_error','Falha na supervisão; não declarar conclusão',data={'type':type(error).__name__})
    self.work={key:f for key,f in self.work.items() if not f.done()}
    if len(self.work)<2:
     request=self.store.claim()
     if request:self.work[request['id']]=self.pool.submit(execute_request,self.store,request,self.stop)
    if tick%30==0 and self.collector.remote.enabled:
     try:
      from .diagnostics import pull
      pull(self.store)
     except Exception:
      previous=self.store.rows("SELECT payload FROM snapshots WHERE source='diagnostics'");payload=json.loads(previous[0]['payload']) if previous else {};payload.update(available=False,checked_at=now());self.store.snapshot('diagnostics',payload,'unavailable')
    if not self.mail_busy:
     self.mail_busy=True
     def send():
      try:self.notifications()
      finally:self.mail_busy=False
     threading.Thread(target=send,daemon=True).start()
    tick+=1;self.stop.wait(max(.2,2-(time.monotonic()-started)))
  finally:
   for rid in self.work:
    row=self.store.rows('SELECT kind FROM requests WHERE id=?',(rid,))[0]
    if row['kind']!='vps':self.store.execute('UPDATE requests SET control=? WHERE id=?',(json.dumps({'action':'cancel'}),rid))
   self.collector.stop();self.pool.shutdown(wait=True,cancel_futures=True);self.store.snapshot('daemon',{'pid':os.getpid(),'alive':False},'stopped');self.store.event('daemon','Coletor encerrado');self.store.queue_mail('daemon:stop:'+str(time.time_ns()),'Vigia: coletor encerrado',f"# Monitor interrompido\n\nColetor encerrado às {now()}.\n\nEsta notificação pode ser enviada na retomada. Jobs persistentes da VPS permanecem no servidor.");lock.close()
