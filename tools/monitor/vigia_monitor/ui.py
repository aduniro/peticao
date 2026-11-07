from __future__ import annotations
import datetime as dt, json, time
from pathlib import Path
from rich.text import Text
from textual import on, work
from textual.coordinate import Coordinate
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import Button, DataTable, Footer, Header, Input, Label, Markdown, RichLog, Select, Static, TabbedContent, TabPane, TextArea, Tree
from .store import Store, now
from .sources import ROOT, clean, file_diff, safe_file, git

LABELS={'running':'em execução','queued':'na fila','waiting':'aguardando','paused':'pausada','completed':'concluída','failed':'falhou','interrupted':'interrompida'}
def duration(seconds):
 seconds=max(0,int(seconds));return f'{seconds//3600:02d}:{seconds%3600//60:02d}:{seconds%60:02d}'
def age(value):
 try:return (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(value)).total_seconds()
 except (ValueError,TypeError):return 0

class NewTask(ModalScreen):
 CSS='NewTask {align:center middle} NewTask > Vertical {width:75; height:auto; padding:1 2; background:$panel; border:round $accent} NewTask Input {margin-bottom:1}'
 def compose(self):
  with Vertical():
   yield Label('Nova tarefa')
   yield Input(placeholder='Identificador: ex. admin-v2',id='new-id')
   yield Input(placeholder='Título da tarefa',id='new-title')
   yield Input(value=str(ROOT),placeholder='Diretório local de trabalho',id='new-cwd')
   yield Input(value='local',placeholder='Ambiente / escopo',id='new-env')
   with Horizontal():yield Button('Criar',id='new-save',variant='success');yield Button('Cancelar',id='new-cancel')
 @on(Button.Pressed)
 def clicked(self,event):
  if event.button.id=='new-cancel':self.dismiss(None);return
  tid=self.query_one('#new-id',Input).value.strip();title=self.query_one('#new-title',Input).value.strip();cwd=self.query_one('#new-cwd',Input).value.strip()
  if not tid or not title or not Path(cwd).is_dir():self.notify('Informe ID, título e diretório existente.',severity='error');return
  self.dismiss(dict(id=tid,title=title,cwd=cwd,environment=self.query_one('#new-env',Input).value.strip()))

class VigiaApp(App):
 TITLE='Vigia · Petição';SUB_TITLE='Monitor e controle por tarefa'
 CSS='''
 Screen {background:$background}
 #overview {height:6; border:round $accent; padding:0 1}
 TabbedContent {height:1fr}
 DataTable {height:1fr; min-height:6}
 #tasks {height:12}
 #plan {width:40%; border:round $primary}
 #task-detail {width:60%; border:round $primary; padding:1}
 #task-panels {height:1fr}
 #task-buttons {height:3}
 #git-layout {height:1fr}
 #git-tree {width:36%; border:round $primary}
 #git-right {width:64%}
 #git-graph {height:12; border:round $accent}
 #git-output {height:1fr; border:round $primary}
 #prompt-title {height:3; padding:0 1; border:round $accent}
 #transcript {height:1fr; border:round $primary}
 #prompt-mode {width:35}
 #prompt-compose {height:9}
 #prompt-text {height:6; width:1fr; border:round $primary}
 #prompt-actions {width:24; height:9}
 #prompt-actions Button {width:100%}
 #approvals {height:10}
 #approval-detail {height:1fr; border:round $accent; padding:1}
 .controls {height:3}
 .controls Button {margin-right:1}
 #event-detail {height:9; border:round $primary; padding:1}
 #mail-detail {height:5; padding:1}
 '''
 BINDINGS=[('q','quit','Fechar tela'),('ctrl+q','quit','Sair'),('r','refresh_view','Atualizar'),('ctrl+n','new_task','Nova tarefa'),('ctrl+enter','send_prompt','Enviar pedido'),('f2','show_prompt','Prompt da tarefa')]
 def __init__(self,store=None):
  super().__init__();self.store=store or Store();self.task_id=None;self.request_id=None;self.approval_id=None;self.git_signature=None;self.last_seq=0;self.snapshots={};self.table_signatures={};self.repo=str(ROOT);self.detail_signature=None
 def compose(self)->ComposeResult:
  yield Header(show_clock=True);yield Static('Carregando estado persistente…',id='overview')
  with TabbedContent(initial='tab-tasks'):
   with TabPane('Tarefas',id='tab-tasks'):
    with Horizontal(id='task-buttons'):yield Button('Nova tarefa',id='new-task');yield Button('Prompt da tarefa',id='task-prompt');yield Button('Atualizar',id='refresh')
    yield DataTable(id='tasks',cursor_type='row')
    with Horizontal(id='task-panels'):yield Tree('Etapas e subetapas',id='plan');yield Static('Selecione uma tarefa.',id='task-detail')
   with TabPane('Processos / VPS',id='tab-processes'):
    yield DataTable(id='processes',cursor_type='row')
    yield Static('Fontes e serviços aparecerão após a primeira coleta.',id='services')
   with TabPane('Git',id='tab-git'):
    yield Select([(str(ROOT),str(ROOT))],value=str(ROOT),id='git-repo',allow_blank=False)
    with Horizontal(id='git-layout'):
     yield Tree('Repositório',id='git-tree')
     with Vertical(id='git-right'):yield RichLog(id='git-graph',wrap=False,markup=False);yield RichLog(id='git-output',wrap=False,markup=False)
   with TabPane('Prompt / execução',id='tab-prompt'):
    yield Static('Selecione uma tarefa na primeira aba. IA e shell são canais separados.',id='prompt-title')
    yield Select([('Pedido à IA local','ai'),('Comando shell local','shell'),('Comando SSH adunir','vps'),('Direcionar IA ativa','steer'),('Entrada para shell ativo','stdin')],value='ai',allow_blank=False,id='prompt-mode')
    yield DataTable(id='runs',cursor_type='row')
    yield RichLog(id='transcript',wrap=True,markup=False)
    with Horizontal(id='prompt-compose'):
     yield TextArea(id='prompt-text',show_line_numbers=False)
     with Vertical(id='prompt-actions'):yield Button('Enviar',id='prompt-send',variant='success');yield Button('Interromper execução',id='run-cancel',variant='error');yield Button('Pausar / retomar shell',id='run-pause')
   with TabPane('Aprovações',id='tab-approvals'):
    yield DataTable(id='approvals',cursor_type='row');yield Static('Nenhum pedido selecionado.',id='approval-detail')
    with Horizontal(classes='controls'):yield Button('Aprovar este pedido',id='approval-accept',variant='success');yield Button('Recusar',id='approval-decline',variant='error')
   with TabPane('Eventos / testes',id='tab-events'):
    yield Input(placeholder='Filtrar por tarefa, tipo ou título; sem valores de formulário',id='event-filter');yield DataTable(id='events',cursor_type='row');yield Static('',id='event-detail')
   with TabPane('Assinaturas / diagnóstico',id='tab-diagnostics'):
    yield Static('Eventos e tentativas técnicas, sem valores pessoais. Contagens não equivalem a pessoas impedidas.',id='diagnostics-status')
    yield DataTable(id='diagnostics',cursor_type='row')
   with TabPane('E-mails',id='tab-mail'):
    yield DataTable(id='mail',cursor_type='row');yield Static('Somente notificações ao proprietário. Aceite do provedor não comprova entrega.',id='mail-detail')
   with TabPane('Planos / contexto',id='tab-context'):
    with VerticalScroll():yield Markdown('# Vigia\n\nSelecione uma tarefa para ver seu contexto e plano.',id='context')
  yield Footer()
 def on_mount(self):
  for name,cols in {'tasks':['Tarefa','Estado','Etapa','Progresso','Desde criação','Estimativa'], 'processes':['Origem','PID','Processo','CPU %','RAM MB','Tempo','Sem terminal','Diretório / porta'],'runs':['Execução','Canal','Estado','Início','Saída'],'approvals':['Pedido','Tarefa','Tipo','Situação','Expira em'],'events':['Hora UTC','Tarefa','Tipo','Descrição'],'mail':['Hora UTC','Assunto','Estado','ID do provedor'],'diagnostics':['Origem','Classificação','Categoria','Eventos (24 h)','Tentativas distintas no grupo']}.items():self.query_one('#'+name,DataTable).add_columns(*cols)
  self.set_interval(2,self.refresh_data);self.refresh_data()
 def table(self,name,rows):
  widget=self.query_one('#'+name,DataTable);signature=repr(rows)
  if self.table_signatures.get(name)==signature:return
  old_key=None
  if widget.row_count and widget.cursor_row<widget.row_count:old_key=widget.coordinate_to_cell_key(Coordinate(widget.cursor_row,0)).row_key.value
  widget.clear()
  for key,cells in rows:widget.add_row(*(Text(str(c)) for c in cells),key=key)
  if old_key:
   for index,key in enumerate(widget.rows):
    if key.value==old_key:widget.move_cursor(row=index);break
  self.table_signatures[name]=signature
 def refresh_data(self):
  snapshots=self.store.rows('SELECT * FROM snapshots');self.snapshots={r['source']:{**r,'payload':json.loads(r['payload'])} for r in snapshots}
  daemon=self.snapshots.get('daemon');fresh=bool(daemon and daemon['payload'].get('alive') and age(daemon['at'])<10)
  rows=self.store.rows("SELECT * FROM tasks ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'waiting' THEN 1 WHEN 'queued' THEN 2 WHEN 'completed' THEN 9 ELSE 3 END,updated_at DESC")
  active=sum(r['state']!='completed' for r in rows);local=self.snapshots.get('local',{}).get('payload',{});remote=self.snapshots.get('vps',{}).get('payload',{})
  self.query_one('#overview',Static).update(Text(f"Coletor: {'ativo' if fresh else 'sem atualização — tela não executa o coletor'} | Tarefas pendentes: {active} | Concluídas: {len(rows)-active}\nLocal: CPU {local.get('cpu','—')}% · memória {local.get('memory','—')}% | VPS: {remote.get('state','não consultada')}\nPercentuais: somente etapas declaradas concluídas. ETA é estimativa informada, não garantia.\nFechar a tela preserva o coletor e as execuções. WAHA: desativado."))
  self.table('tasks',[(r['id'],[r['title'],LABELS[r['state']]+(' · sem atualização recente' if r['state']=='running' and age(r['updated_at'])>180 else ''),r['stage'],f"{self.store.progress(r['id'])}%" if self.store.progress(r['id']) is not None else 'não medido',duration(age(r['created_at'])-(age(r['updated_at']) if r['state'] in ('completed','failed','interrupted') else 0)),r['eta'] or 'não informada']) for r in rows])
  if not self.task_id and rows:self.select_task(rows[0]['id'])
  processes=[]
  for r in local.get('processes',[]):processes.append(('local:'+str(r['pid']),['local',r['pid'],r['name'],r.get('cpu','—'),r.get('memory','—'),duration(r.get('elapsed',0)),'sim' if r.get('background') else 'não',r['cwd']+((' :'+r['port']) if r.get('port') else '')]))
  for r in remote.get('processes',[]):processes.append(('vps:'+str(r['pid']),['VPS',r['pid'],r['name'],r.get('cpu','—'),r.get('memory','—'),duration(r.get('elapsed',0)),'—',r.get('cwd','—')]))
  self.table('processes',processes)
  services='Local: '+', '.join(f"{r['name']}: {r['state']}" for r in local.get('services',[]))+'\nVPS: '+', '.join(f'{k}: {v}' for k,v in remote.get('services',{}).items())
  self.query_one('#services',Static).update(Text(services))
  runs=self.store.rows('SELECT * FROM requests WHERE task_id=? ORDER BY at DESC LIMIT 100',(self.task_id or '',));self.table('runs',[(r['id'],[r['id'][:10],r['kind'],LABELS.get(r['state'],r['state']),r['at'],r['exit_code'] if r['exit_code'] is not None else '—']) for r in runs])
  if runs and (not self.request_id or not any(r['id']==self.request_id for r in runs)):self.select_run(runs[0]['id'])
  if self.request_id:
   for r in self.store.rows('SELECT * FROM output WHERE request_id=? AND seq>? ORDER BY seq LIMIT 200',(self.request_id,self.last_seq)):
    self.query_one('#transcript',RichLog).write(Text(r['text']));self.last_seq=r['seq']
  approvals=self.store.rows('SELECT a.*,q.task_id FROM approvals a JOIN requests q ON q.id=a.request_id ORDER BY a.at DESC LIMIT 100')
  self.table('approvals',[(r['id'],[r['id'][:10],r['task_id'],r['method'].split('/')[-2],r['decision'] or ('expirado' if time.time()>r['expires'] else 'aguardando'),max(0,int(r['expires']-time.time()))]) for r in approvals])
  query=self.query_one('#event-filter',Input).value.lower();events=self.store.rows('SELECT * FROM events ORDER BY seq DESC LIMIT 300');self.table('events',[(str(r['seq']),[r['at'],r['task_id'] or '—',r['kind'],r['title']]) for r in events if query in (str(r['task_id'])+' '+r['kind']+' '+r['title']).lower()])
  mails=self.store.rows('SELECT * FROM mail ORDER BY at DESC LIMIT 200');self.table('mail',[(r['id'],[r['at'],r['subject'],r['state'],r['provider_id'] or '—']) for r in mails])
  diagnostic=self.snapshots.get('diagnostics',{});payload=diagnostic.get('payload',{})
  self.query_one('#diagnostics-status',Static).update(Text(f"Fonte: {'disponível' if payload.get('available') else 'indisponível / não coletada'} · coleta {diagnostic.get('at','—')}. Somente dados técnicos; cada grupo conta tentativas, não pessoas. Histórico detalhado na aba Eventos: filtro signup:."))
  self.table('diagnostics',[(str(i),[r['source'],r['classification'],r['category'] or '—',r['events'],r['attempts']]) for i,r in enumerate(payload.get('summary',[]))])
  self.refresh_git()
  if self.task_id:
   detail=self.store.rows('SELECT * FROM tasks WHERE id=?',(self.task_id,))+self.store.rows('SELECT * FROM steps WHERE task_id=?',(self.task_id,));signature=repr(detail)
   if signature!=self.detail_signature:self.detail_signature=signature;self.select_task(self.task_id)
 def select_task(self,tid):
  if self.task_id!=tid:self.request_id=None;self.last_seq=0;self.query_one('#transcript',RichLog).clear()
  self.task_id=tid;rows=self.store.rows('SELECT * FROM tasks WHERE id=?',(tid,))
  if not rows:return
  r=rows[0];self.query_one('#prompt-title',Static).update(Text(f"Tarefa: {r['title']} · {r['environment']}\nDiretório: {r['cwd']}"));self.query_one('#task-detail',Static).update(Text(f"{r['title']}\n{r['scope']}\n{r['detail']}\nAtualização: {r['updated_at']}\nEstimativa: {r['eta'] or 'não informada'}"))
  tree=self.query_one('#plan',Tree);tree.clear();tree.root.set_label(Text(r['title']));steps=self.store.rows('SELECT * FROM steps WHERE task_id=?',(tid,));nodes={None:tree.root};todo=list(steps)
  for _ in range(len(steps)+1):
   for step in todo[:]:
    if step['parent'] in nodes:nodes[step['id']]=nodes[step['parent']].add(Text(f"{LABELS[step['state']]} · {step['title']}"),data=step);todo.remove(step)
  tree.root.expand_all();self.query_one('#context',Markdown).update(f"# {r['title']}\n\nAmbiente: {r['environment']}\n\nEscopo: {r['scope']}\n\n{r['detail']}\n\n## Etapas\n\n"+'\n'.join(f"- {x['title']}: {LABELS[x['state']]} — {x['detail']}" for x in steps)+"\n\n## Contexto do projeto\n\nConsulte tools/monitor/CONTEXTO.md e AGENTS.md. O contexto não é uma cópia integral deste chat. WAHA permanece desativado.")
 def select_run(self,rid):self.request_id=rid;self.last_seq=0;self.query_one('#transcript',RichLog).clear()
 def refresh_git(self):
  repos=[k[4:] for k in self.snapshots if k.startswith('git:')];selector=self.query_one('#git-repo',Select)
  if repos and getattr(self,'repo_options',None)!=repos:selector.set_options([(p,p) for p in repos]);selector.value=self.repo if self.repo in repos else repos[0];self.repo_options=repos
  data=self.snapshots.get('git:'+self.repo,{}).get('payload',{});sig=repr(data)
  if sig==self.git_signature:return
  self.git_signature=sig;tree=self.query_one('#git-tree',Tree);tree.clear();tree.root.set_label(Text(self.repo));branches=tree.root.add('Branches / remotos')
  for line in data.get('branches','').splitlines():branches.add_leaf(Text(line))
  worktrees=tree.root.add('Worktrees')
  for line in data.get('worktrees','').splitlines():
   if line.startswith('worktree '):worktrees.add_leaf(Text(line[9:]))
  files=tree.root.add('Alterações locais')
  for path in sorted(set(data.get('files',[])+data.get('untracked',[]))):files.add_leaf(Text(path),data={'path':path})
  commits=tree.root.add('Commits (selecione para resumo)')
  for line in data.get('commits',[]):
   parts=line.split('\t',2)
   if len(parts)==3:commits.add_leaf(Text(parts[1]+' '+parts[2]),data={'commit':parts[0]})
  tree.root.expand();files.expand();branches.expand();log=self.query_one('#git-graph',RichLog);log.clear();log.write(Text(data.get('graph',data.get('error','Aguardando coleta Git'))))
 @on(DataTable.RowSelected)
 def highlighted(self,event):
  key=event.row_key.value;table=event.data_table.id
  if table=='tasks' and key!=self.task_id:self.select_task(key)
  elif table=='runs' and key!=self.request_id:self.select_run(key)
  elif table=='approvals':
   self.approval_id=key;r=self.store.rows('SELECT * FROM approvals WHERE id=?',(key,))[0];self.query_one('#approval-detail',Static).update(Text(clean(r['payload'],12000)))
  elif table=='events':
   r=self.store.rows('SELECT * FROM events WHERE seq=?',(key,))[0];self.query_one('#event-detail',Static).update(Text(r['title']+'\n'+clean(r['data'],6000)))
 @on(Select.Changed,'#git-repo')
 def repo_changed(self,event):
  if isinstance(event.value,str):self.repo=event.value;self.git_signature=None;self.refresh_git()
 @on(Tree.NodeSelected,'#plan')
 def plan_selected(self,event):
  r=event.node.data
  if r:self.query_one('#task-detail',Static).update(Text(f"{r['title']}\nEstado: {LABELS[r['state']]}\n{r['detail']}\nInício: {r.get('started_at') or 'não registrado'}\nFim: {r.get('finished_at') or '—'}\nEstimativa: {r.get('eta') or 'não informada'}"))
 @on(Tree.NodeSelected,'#git-tree')
 def node_selected(self,event):
  data=event.node.data
  if not data:return
  self.git_read(data)
 @work(thread=True,exclusive=True,group='git-read')
 def git_read(self,data):
  try:
   if 'path' in data:text=file_diff(self.repo,data['path'])
   else:text=git(self.repo,'show','--no-ext-diff','--stat','--format=fuller',data['commit'])
  except Exception as error:text=type(error).__name__+': não foi possível obter o diff'
  def show():log=self.query_one('#git-output',RichLog);log.clear();log.write(Text(text))
  self.call_from_thread(show)
 @on(Button.Pressed)
 def clicked(self,event):
  bid=event.button.id
  if bid in ('new-task',):self.action_new_task()
  elif bid in ('task-prompt',):self.action_show_prompt()
  elif bid=='refresh':self.refresh_data()
  elif bid=='prompt-send':self.action_send_prompt()
  elif bid in ('run-cancel','run-pause'):
   if not self.request_id:return
   rows=self.store.rows('SELECT * FROM requests WHERE id=?',(self.request_id,));r=rows[0]
   if r['state'] not in ('running','paused'):self.notify('Esta execução não está ativa.');return
   if bid=='run-pause' and r['kind']=='ai':self.notify('IA: use Interromper ou Direcionar.');return
   self.set_control('cancel' if bid=='run-cancel' else 'resume' if r['state']=='paused' else 'pause')
  elif bid in ('approval-accept','approval-decline'):
   if self.approval_id:
    try:self.store.decide(self.approval_id,'accept' if bid=='approval-accept' else 'decline');self.notify('Decisão registrada para este pedido.');self.refresh_data()
    except ValueError as error:self.notify(str(error),severity='error')
 def set_control(self,action,text=None):
  if not self.request_id:raise ValueError('Selecione uma execução')
  payload={'action':action}
  if text is not None:payload['text']=text
  with self.store.connect() as db:
   result=db.execute("UPDATE requests SET control=? WHERE id=? AND state IN ('running','paused') AND control IS NULL",(json.dumps(payload),self.request_id))
   if not result.rowcount:raise ValueError('Execução indisponível ou controle anterior ainda pendente')
 def action_send_prompt(self):
  text=self.query_one('#prompt-text',TextArea).text;mode=self.query_one('#prompt-mode',Select).value
  try:
   if not self.task_id:raise ValueError('Selecione ou crie uma tarefa')
   if mode in ('steer','stdin'):self.set_control(mode,text+'\n' if mode=='stdin' else text)
   else:self.select_run(self.store.request(self.task_id,mode,text))
   self.query_one('#prompt-text',TextArea).clear();self.notify('Pedido registrado. O coletor executa a fila.');self.refresh_data()
  except ValueError as error:self.notify(str(error),severity='error')
 def action_show_prompt(self):self.query_one(TabbedContent).active='tab-prompt';self.query_one('#prompt-text',TextArea).focus()
 def action_refresh_view(self):self.refresh_data()
 def action_new_task(self):
  def created(values):
   if values:
    tid=values.pop('id');self.store.task(tid,**values);self.store.event('task','Tarefa criada',tid);self.select_task(tid);self.refresh_data()
  self.push_screen(NewTask(),created)
