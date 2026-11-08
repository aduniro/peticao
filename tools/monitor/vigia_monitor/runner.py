from __future__ import annotations
import json, os, pty, re, select, shlex, signal, subprocess, threading, time
from pathlib import Path
from .store import Store, now, uid
from .sources import clean

CODEX=str(Path.home()/'.local/bin/codex')
INSTRUCTIONS='''Você é o agente de uma tarefa do Vigia. Trabalhe somente no escopo e diretório da tarefa e siga AGENTS.md.
Não há acesso automático ao chat anterior: use o resumo da tarefa e os documentos do repositório.
Não leia nem revele .env, credenciais, secrets/, preview-state/, chaves SSH ou dados pessoais de assinantes.
Não altere avisos, privacidade, aparência ou regras fora da solicitação. Não publique nem altere a VPS sem autorização específica do usuário.
Preserve alterações existentes e faça commits por etapa. Use dados fictícios e entrega dev em testes.
Não envie mensagens a participantes ou autoridades. Notificações do monitor destinam-se exclusivamente a operator-1608598f41@example.invalid em HTML.
Descreva o resultado e os testes; não invente percentuais nem estimativas. Informe bloqueios. Não acesse outros threads em execução.'''

class Rpc:
 def __init__(self,command=None):
  self.proc=subprocess.Popen(command or [CODEX,'app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
  self.sequence=0;self.buffer=b'';self.pending=[]
 def send(self,message):
  self.proc.stdin.write((json.dumps(message)+'\n').encode());self.proc.stdin.flush()
 def request(self,method,params):
  self.sequence+=1;self.send({'id':self.sequence,'method':method,'params':params});return self.sequence
 def receive(self,timeout=.2):
  if self.pending:return self.pending.pop(0)
  if b'\n' not in self.buffer:
   ready,_,_=select.select([self.proc.stdout],[],[],timeout)
   if not ready:return None
   raw=os.read(self.proc.stdout.fileno(),65536)
   if not raw:raise RuntimeError('Conexão com o Codex encerrada')
   self.buffer+=raw
  if b'\n' not in self.buffer:return None
  line,self.buffer=self.buffer.split(b'\n',1)
  try:return json.loads(line)
  except ValueError:return None
 def call(self,method,params,timeout=30):
  expected=self.request(method,params);deadline=time.monotonic()+timeout;aside=[]
  try:
   while time.monotonic()<deadline:
    msg=self.receive()
    if not msg:continue
    if msg.get('id')==expected:
     if 'error' in msg:raise RuntimeError(clean(msg['error'].get('message','Erro de protocolo'),500))
     return msg.get('result',{})
    aside.append(msg)
   raise TimeoutError('Codex não respondeu à inicialização')
  finally:self.pending=aside+self.pending
 def initialize(self):
  self.call('initialize',{'clientInfo':{'name':'peticao_vigia','title':'Vigia','version':'0.1.0'}});self.send({'method':'initialized','params':{}})
 def close(self):
  if self.proc.poll() is None:
   self.proc.terminate()
   try:self.proc.wait(timeout=3)
   except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait()

def control(store,rid):
 with store.connect() as db:
  row=db.execute('SELECT control FROM requests WHERE id=?',(rid,)).fetchone()
  if not row or not row['control']:return None
  db.execute('UPDATE requests SET control=NULL WHERE id=?',(rid,));return json.loads(row['control'])

def command_run(store,request,task):
 rid=request['id'];command=request['body'];master,slave=pty.openpty()
 argv=['bash','-lc',command] if request['kind']=='shell' else ['ssh','-tt','-o','BatchMode=yes','-o','ConnectTimeout=8','peticao','bash -lc '+shlex.quote(command)]
 proc=subprocess.Popen(argv,cwd=task['cwd'],stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave)
 store.execute('UPDATE requests SET pid=? WHERE id=?',(proc.pid,rid));store.out(rid,'Execução explícita do usuário: '+clean(command,10000),'command');canceled=False;output_count=0
 try:
  while proc.poll() is None:
   action=control(store,rid)
   if action:
    if action['action']=='cancel':
     os.killpg(proc.pid,signal.SIGCONT);os.killpg(proc.pid,signal.SIGTERM);canceled=True
    elif action['action'] in ('pause','resume'):
     os.killpg(proc.pid,signal.SIGSTOP if action['action']=='pause' else signal.SIGCONT)
     store.execute('UPDATE requests SET state=? WHERE id=?',('paused' if action['action']=='pause' else 'running',rid))
     store.event('control',action['action'],request['task_id'],{'id':rid});store.queue_mail('control:'+rid+':'+action.get('id',uid()),'Vigia: '+('execução pausada' if action['action']=='pause' else 'execução retomada'),f"# Controle da execução\n\nTarefa: {task['title']}\n\nAção: {action['action']}\n\nAmbiente local.")
    elif action['action']=='stdin':os.write(master,action['text'].encode())
   ready,_,_=select.select([master],[],[],.2)
   if ready:
    try:raw=os.read(master,8192)
    except OSError:break
    if raw and output_count<2000000:store.out(rid,clean(raw.decode(errors='replace'),8192));output_count+=len(raw)
   if canceled:
    try:proc.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL)
  # Drain final output already queued by the child.
  drain_deadline=time.monotonic()+1
  while time.monotonic()<drain_deadline and select.select([master],[],[],0)[0]:
   try:raw=os.read(master,8192)
   except OSError:break
   if not raw:break
   if output_count<2000000:store.out(rid,clean(raw.decode(errors='replace'),8192));output_count+=len(raw)
  code=proc.wait();return ('interrupted' if canceled else 'completed' if code==0 else 'failed',code)
 finally:
  if proc.poll() is None:os.killpg(proc.pid,signal.SIGTERM)
  os.close(master)

def ai_run(store,request,task):
 remote=request['kind']=='ai-vps';host='vps' if remote else 'local';rpc=Rpc(['ssh','-o','BatchMode=yes','peticao','/home/adunir/.local/bin/codex','app-server'] if remote else None);rid=request['id'];saved=store.rows('SELECT id FROM threads WHERE task_id=? AND host=?',(task['id'],host));thread_id=saved[0]['id'] if saved else None;turn_id=None;approval_ids=[]
 report_text=''
 store.execute('UPDATE requests SET pid=? WHERE id=?',(rpc.proc.pid,rid))
 try:
  rpc.initialize()
  context_path=Path('/mnt/dev/peticao/tools/monitor/CONTEXTO.md')
  context=context_path.read_text() if context_path.is_file() and not context_path.is_symlink() and context_path.stat().st_size<20000 else ''
  params={'cwd':task['cwd'],'approvalPolicy':'on-request','sandbox':'workspace-write','developerInstructions':INSTRUCTIONS+'\n\nResumo preparado do projeto:\n'+context}
  if thread_id:
   params.update(threadId=thread_id,excludeTurns=True);result=rpc.call('thread/resume',params)
  else:result=rpc.call('thread/start',params)
  thread_id=result['thread']['id'];store.execute('INSERT OR REPLACE INTO threads VALUES(?,?,?)',(task['id'],host,thread_id))
  text=f"Tarefa: {task['title']}\nAmbiente: {task['environment']}\nEscopo: {task['scope']}\nEstado: {task['detail']}\nPedido do usuário: {request['body']}"
  result=rpc.call('turn/start',{'threadId':thread_id,'input':[{'type':'text','text':text,'text_elements':[]}]});turn_id=result['turn']['id']
  while True:
   action=control(store,rid)
   if action and action['action']=='cancel':rpc.request('turn/interrupt',{'threadId':thread_id,'turnId':turn_id})
   elif action and action['action']=='steer':
    try:
     rpc.call('turn/steer',{'threadId':thread_id,'expectedTurnId':turn_id,'input':[{'type':'text','text':action['text'],'text_elements':[]}]},timeout=10);store.out(rid,'Direcionamento entregue ao turno ativo.','control')
    except (RuntimeError,TimeoutError):store.out(rid,'Direcionamento não confirmado; confira o estado do turno antes de reenviar.','control_error')
   for approval in store.rows('SELECT * FROM approvals WHERE request_id=? AND answered=0',(rid,)):
    decision=approval['decision'] or ('decline' if time.time()>approval['expires'] else None)
    if decision:
     rpc.send({'id':json.loads(approval['rpc_id']),'result':{'decision':decision}});store.execute('UPDATE approvals SET answered=1,decision=? WHERE id=?',(decision,approval['id']))
   msg=rpc.receive()
   if not msg:continue
   method=msg.get('method','');p=msg.get('params',{})
   if 'id' in msg and method:
    if method in ('item/commandExecution/requestApproval','item/fileChange/requestApproval'):
     aid=uid();approval_ids.append(aid);store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?)',(aid,rid,json.dumps(msg['id']),method,json.dumps(p),now(),time.time()+1200,None,0))
     store.event('approval','Aprovação solicitada',task['id'],{'id':aid,'request_id':rid})
     store.queue_mail('approval:'+aid,'Vigia: aprovação solicitada — '+task['title'],f"# Aprovação pendente\n\nTarefa: {task['title']}\n\nAmbiente: {task['environment']}\n\nAbra a aba Aprovações do Vigia para conferir a ação e decidir. Pedido {aid}, válido por 20 minutos. Nenhuma aprovação permanente será concedida.")
    else:rpc.send({'id':msg['id'],'error':{'code':-32601,'message':'Interface não suporta esse pedido; peça esclarecimento ao usuário por mensagem.'}})
   elif method=='item/agentMessage/delta':
    report_text=(report_text+p.get('delta',''))[-40000:];store.out(rid,clean(p.get('delta',''),10000),'assistant')
   elif method=='item/commandExecution/outputDelta':store.out(rid,clean(p.get('delta',''),10000),'output')
   elif method in ('item/started','item/completed'):
    item=p.get('item',{});kind=item.get('type','')
    if kind in ('commandExecution','fileChange'):store.out(rid,clean(json.dumps(item,ensure_ascii=False),15000),kind)
    if method=='item/completed' and kind in ('commandExecution','fileChange'):store.execute('UPDATE requests SET activity_count=activity_count+1 WHERE id=?',(rid,))
    if method=='item/completed' and kind=='agentMessage':report_text=(report_text+'\n'+item.get('text',''))[-40000:]
   elif method=='turn/completed':
    status=p['turn']['status'];error=p['turn'].get('error')
    if error:store.out(rid,clean(json.dumps(error),2000),'error')
    reports=re.findall(r'<vigia-result>(.*?)</vigia-result>',report_text,re.S)
    if reports:
     try:
      report=json.loads(reports[-1])
      if report.get('status') in ('completed','continue','blocked') and isinstance(report.get('checkpoint'),str):store.execute('UPDATE requests SET run_report=? WHERE id=?',(json.dumps({'status':report['status'],'checkpoint':clean(report['checkpoint'],6000)}),rid))
     except (ValueError,AttributeError):pass
    return ('completed' if status=='completed' else 'interrupted' if status=='interrupted' else 'failed',None)
   elif method=='error':store.out(rid,clean(json.dumps(p),3000),'error')
 finally:
  store.execute("UPDATE approvals SET answered=1,decision=COALESCE(decision,'decline') WHERE request_id=? AND answered=0",(rid,));rpc.close()

def execute_request(store,request,stop=None):
 task=store.rows('SELECT * FROM tasks WHERE id=?',(request['task_id'],))[0]
 if request.get('context'):task.update(json.loads(request['context']))
 store.event('run_started','Execução iniciada',task['id'],{'id':request['id'],'kind':request['kind']})
 store.queue_mail('start:'+request['id'],'Vigia: execução iniciada — '+task['title'],f"# Execução iniciada\n\nTarefa: {task['title']}\n\nCanal: {request['kind']}\n\nAmbiente: {task['environment']}.\n\nAcompanhe no prompt da tarefa. Estimativa de término ainda não informada.")
 failure_class=None
 try:
  if request['kind'] in ('ai','ai-vps'):state,code=ai_run(store,request,task)
  elif request['kind']=='vps':
   from .remote import run
   state,code=run(store,request,task,stop)
  else:state,code=command_run(store,request,task)
 except Exception as error:
  state,code='failed',None;failure_class='transport' if isinstance(error,(TimeoutError,ConnectionError)) else 'unknown';store.out(request['id'],clean(str(error),1500),'error')
 store.execute('UPDATE requests SET state=?,exit_code=?,updated_at=?,failure_class=? WHERE id=?',(state,code,now(),failure_class,request['id']))
 store.event('observation_paused' if state=='waiting' else 'run_finished','Observação suspensa; job remoto preservado' if state=='waiting' else 'Execução '+state,task['id'],{'id':request['id'],'exit_code':code})
 store.queue_mail('run:'+request['id'],'Vigia: execução '+state+' — '+task['title'],f"# Execução {state}\n\nTarefa: {task['title']}\n\nAmbiente: {task['environment']}\n\nTipo: {request['kind']}\n\nCódigo de saída: {code if code is not None else 'não aplicável'}.\n\nConsulte o prompt da tarefa no Vigia para saída e próximos passos.")
