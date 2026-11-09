from __future__ import annotations
import argparse, json, os, subprocess, sys
from pathlib import Path
from .store import Store, STATE, now, uid
from .sources import Collector, ROOT

def main(argv=None):
 p=argparse.ArgumentParser(description='Vigia — tarefas, processos, Git, prompt e aprovações')
 sub=p.add_subparsers(dest='command')
 d=sub.add_parser('coletor');d.add_argument('--sem-vps',action='store_true');d.add_argument('--sem-email',action='store_true')
 sub.add_parser('estado');diag=sub.add_parser('diagnostico');diag.add_argument('--vps',action='store_true')
 x=sub.add_parser('execucao');x.add_argument('id');x.add_argument('--limite',type=int,default=12000)
 quota=sub.add_parser('retomada-quota');quota.add_argument('task');quota.add_argument('--desativar',action='store_true')
 q=sub.add_parser('retomar');q.add_argument('task');q.add_argument('step');q.add_argument('--contexto',required=True)
 w=sub.add_parser('supervisionar');w.add_argument('task',nargs='?');w.add_argument('--intervalo',type=int,default=300);w.add_argument('--desativar',action='store_true');w.add_argument('--plano',type=Path)
 t=sub.add_parser('tarefa');t.add_argument('id');t.add_argument('--titulo');t.add_argument('--estado');t.add_argument('--etapa');t.add_argument('--escopo');t.add_argument('--ambiente');t.add_argument('--diretorio');t.add_argument('--detalhe');t.add_argument('--estimativa')
 s=sub.add_parser('etapa');s.add_argument('task');s.add_argument('id');s.add_argument('titulo');s.add_argument('--estado',default='queued');s.add_argument('--peso',type=float,default=1);s.add_argument('--pai');s.add_argument('--detalhe',default='');s.add_argument('--estimativa')
 r=sub.add_parser('pedir');r.add_argument('task');r.add_argument('--tipo',choices=['ai','shell','vps','ai-vps'],default='ai');r.add_argument('texto');r.add_argument('--diretorio')
 e=sub.add_parser('evento');e.add_argument('task');e.add_argument('--tipo',default='progress');e.add_argument('titulo');e.add_argument('--dados',default='{}');e.add_argument('--id')
 a=sub.add_parser('aprovar');a.add_argument('id');a.add_argument('--recusar',action='store_true')
 c=sub.add_parser('controlar');c.add_argument('id');c.add_argument('acao',choices=['cancel','pause','resume','stdin','steer']);c.add_argument('--texto')
 args=p.parse_args(argv);store=Store()
 if args.command=='retomada-quota':
  from .quota import configure
  configure(store,args.task,not args.desativar);print('Política registrada somente para futuros pedidos');return
 if args.command=='retomar':
  with store.connect() as db:
   db.execute('BEGIN IMMEDIATE')
   changed=db.execute("UPDATE workflow_steps SET state='queued',checkpoint=?,updated_at=? WHERE task_id=? AND id=? AND state='waiting'",(args.contexto,now(),args.task,args.step))
   if changed.rowcount!=1:raise ValueError('Etapa não está aguardando retomada')
   db.execute("UPDATE tasks SET state='running',updated_at=? WHERE id=?",(now(),args.task))
  store.event('workflow_resumed','Etapa retomada explicitamente',args.task,{'step':args.step,'context':args.contexto});print('Retomada registrada');return
 if args.command=='execucao':
  if not 1<=args.limite<=50000:p.error('Limite entre 1 e 50000')
  rows=store.rows('SELECT id,task_id,kind,state,at,updated_at,exit_code,failure_class,run_report FROM requests WHERE id=?',(args.id,))
  if not rows:p.error('Execução inexistente')
  output=store.rows('SELECT kind,text FROM output WHERE request_id=? ORDER BY seq DESC LIMIT 200',(args.id,))
  print(json.dumps({'execution':rows[0],'output':'\n'.join(r['text'] for r in reversed(output))[-args.limite:]},ensure_ascii=False));return
 if args.command=='supervisionar':
  from .supervision import Supervisor,watch,install_plan
  if args.task:
   if args.plano:install_plan(store,args.task,json.loads(args.plano.read_text()))
   watch(store,args.task,args.intervalo,not args.desativar)
  else:
   if args.plano:p.error('--plano exige tarefa')
   Supervisor(store).scan()
   from .known_qa import approve_known
   approve_known(store)
   from .notifications import deliver_one
   deliver_one(store)
  print(json.dumps({'supervision':store.rows('SELECT * FROM supervision'),'workflow':store.rows('SELECT task_id,id,title,state,checkpoint,attempts FROM workflow_steps ORDER BY task_id,position')},ensure_ascii=False));return
 if args.command=='coletor':
  from .daemon import Daemon
  return Daemon(store,not args.sem_vps,not args.sem_email).run()
 if args.command=='estado':print(json.dumps({'tasks':store.rows('SELECT * FROM tasks'),'snapshots':store.rows('SELECT source,at,status FROM snapshots'),'runs':store.rows('SELECT id,task_id,kind,state,at FROM requests ORDER BY at DESC LIMIT 20')},ensure_ascii=False,indent=2));return
 if args.command=='tarefa':
  mapping={'titulo':'title','estado':'state','etapa':'stage','escopo':'scope','ambiente':'environment','diretorio':'cwd','detalhe':'detail','estimativa':'eta'};old=store.rows('SELECT * FROM tasks WHERE id=?',(args.id,));values={field:getattr(args,arg) for arg,field in mapping.items() if getattr(args,arg) is not None}
  row=store.task(args.id,**values);store.event('task',row['stage'] or row['title'],args.id,values)
  if not old or old[0]['state']!=row['state']:store.queue_mail('task:'+args.id+':'+now(),'Vigia: '+row['title']+' — '+row['state'],f"# Atualização da tarefa\n\n{row['title']}\n\nEstado: {row['state']}\n\n{row['detail']}\n\nEtapa: {row['stage']}\n\nAmbiente: {row['environment']}. Estimativa: {row['eta'] or 'não informada'}.")
  print(json.dumps(row,ensure_ascii=False));return
 if args.command=='etapa':store.step(args.task,args.id,args.titulo,args.estado,args.peso,args.pai,args.detalhe,args.estimativa);print(json.dumps({'task':args.task,'progress':store.progress(args.task)}));return
 if args.command=='pedir':print(store.request(args.task,args.tipo,args.texto,args.diretorio));return
 if args.command=='evento':store.event(args.tipo,args.titulo,args.task,json.loads(args.dados),args.id);print('Registrado');return
 if args.command=='aprovar':store.decide(args.id,'decline' if args.recusar else 'accept');print('Decisão registrada');return
 if args.command=='controlar':
  with store.connect() as db:
   res=db.execute("UPDATE requests SET control=? WHERE id=? AND state IN ('running','paused','waiting') AND control IS NULL",(json.dumps({'id':uid(),'action':args.acao,'text':args.texto or ''}),args.id))
   if not res.rowcount:raise ValueError('Execução indisponível ou controle pendente')
  return
 if args.command=='diagnostico':
  from .runner import Rpc
  rpc=None;result={'database':str(store.path),'WAHA':'disabled'}
  try:
   rpc=Rpc(['ssh','-o','BatchMode=yes','peticao','/home/adunir/.local/bin/codex','app-server'] if args.vps else None);rpc.initialize();account=rpc.call('account/read',{'refreshToken':False});result['codex_authenticated']=bool(account.get('account'));result['provider_requires_auth']=account.get('requiresOpenaiAuth')
  except Exception as error:result['codex_error']=type(error).__name__
  finally:
   if rpc:rpc.close()
  print(json.dumps(result,ensure_ascii=False));return
 from .ui import VigiaApp
 VigiaApp(store).run()
if __name__=='__main__':main()
