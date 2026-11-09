import json, os, sys, tempfile, threading, time
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vigia_monitor.store import Store
from vigia_monitor.sources import safe_file,file_diff
from vigia_monitor.runner import execute_request

@pytest.fixture
def store(tmp_path):return Store(tmp_path/'state/monitor.sqlite')
def task(store):return store.task('qa',title='Tarefa fictícia',cwd='/mnt/dev/peticao')
def test_store_private_atomic_history_and_dedup(store):
 a=task(store);b=store.task('qa',state='running');assert a['created_at']==b['created_at'];assert store.path.stat().st_mode&0o777==0o600
 assert store.event('test','Primeiro',event_id='same');assert not store.event('test','Segundo',event_id='same');assert len(store.rows('SELECT * FROM events'))==1

def test_progress_is_declared_leaves_not_elapsed_time(store):
 task(store);assert store.progress('qa') is None
 store.step('qa','parent','Grupo',weight=99);store.step('qa','a','Feito',state='completed',weight=1,parent='parent');store.step('qa','b','Pendente',weight=3,parent='parent');assert store.progress('qa')==25
 with pytest.raises(ValueError):store.step('qa','parent','Ciclo',parent='a')
 with pytest.raises(ValueError):store.step('qa','x','Pai inexistente',parent='missing')

def test_request_claim_serializes_task_and_recovers_without_replay(store):
 task(store);one=store.request('qa','shell','printf ok');two=store.request('qa','shell','printf second');assert store.claim()['id']==one;assert store.claim() is None
 store.recover();assert store.rows('SELECT state FROM requests WHERE id=?',(one,))[0]['state']=='interrupted';assert store.claim()['id']==two

def test_approval_is_bound_single_use_and_expires(store):
 task(store);rid=store.request('qa','ai','fictício');store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?)',('approval',rid,'1','command','{}','now',time.time()+1,None,0));store.decide('approval','accept')
 with pytest.raises(ValueError):store.decide('approval','decline')
 store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?)',('expired',rid,'2','command','{}','now',time.time()-1,None,0))
 with pytest.raises(ValueError):store.decide('expired','accept')

def test_no_implicit_sensitive_file_preview(tmp_path):
 for path in ['.env','site/.env.local','secrets/key.json','site/data/people.json','../AGENTS.md','/etc/passwd','signers.csv','site/src/../../secrets/key.json']:assert not safe_file(path)
 assert safe_file('site/src/components/SignForm.tsx')
 repo=tmp_path/'repo';repo.mkdir();(repo/'site/src').mkdir(parents=True);(repo/'site/src/file.py').symlink_to('/etc/passwd');assert 'recusado' in file_diff(repo,'site/src/file.py')

def test_shell_output_and_failure_do_not_change_task_state(store):
 task(store);rid=store.request('qa','shell','printf "QA_OK\\n"; exit 7');r=store.claim();execute_request(store,r)
 row=store.rows('SELECT * FROM requests WHERE id=?',(rid,))[0];assert row['state']=='failed' and row['exit_code']==7;assert any('QA_OK' in x['text'] for x in store.rows('SELECT * FROM output'));assert store.rows('SELECT state FROM tasks')[0]['state']=='queued'

def test_owned_shell_can_receive_input(store):
 task(store);rid=store.request('qa','shell','read -r answer; printf "received:%s\\n" "$answer"');r=store.claim();worker=threading.Thread(target=execute_request,args=(store,r));worker.start()
 deadline=time.time()+5
 while time.time()<deadline and not store.rows('SELECT pid FROM requests WHERE id=?',(rid,))[0]['pid']:time.sleep(.02)
 store.execute('UPDATE requests SET control=? WHERE id=?',(json.dumps({'action':'stdin','text':'fictitious\n'}),rid));worker.join(5);assert not worker.is_alive();assert any('received:fictitious' in x['text'] for x in store.rows('SELECT text FROM output'))

@pytest.mark.asyncio
async def test_tui_tabs_task_selection_and_prompt_queue(store,tmp_path):
 from vigia_monitor.ui import VigiaApp
 from textual.widgets import TabbedContent,TextArea
 task(store);store.snapshot('daemon',{'alive':True});store.snapshot('local',{'processes':[],'services':[]});store.snapshot('git:/mnt/dev/peticao',{'cwd':'/mnt/dev/peticao','branches':'* test','worktrees':'worktree /mnt/dev/peticao','graph':'* abc commit','commits':['a'*40+'\tabc\tCommit'],'files':['site/src/components/SignForm.tsx']})
 app=VigiaApp(store)
 async with app.run_test(size=(120,40)) as pilot:
  await pilot.pause();assert app.task_id=='qa';app.refresh_data();await pilot.pause()
  app.action_show_prompt();await pilot.pause();assert app.query_one(TabbedContent).active=='tab-prompt'
  app.query_one('#prompt-text',TextArea).load_text('Pedido fictício sem executar');app.action_send_prompt();await pilot.pause();assert store.rows('SELECT body FROM requests')[0]['body']=='Pedido fictício sem executar'
  for tab in ['tab-tasks','tab-processes','tab-git','tab-approvals','tab-events','tab-mail','tab-context']:
   app.query_one(TabbedContent).active=tab;await pilot.pause()
  app.save_screenshot(str(tmp_path/'vigia.svg'))

def test_request_keeps_approved_context_if_task_is_edited(store):
 task(store);rid=store.request('qa','shell','printf ok');store.task('qa',cwd='/tmp',scope='Changed later');request=store.claim();assert json.loads(request['context'])['cwd']=='/mnt/dev/peticao'

def test_remote_job_creation_is_idempotent_and_worker_is_private(tmp_path,monkeypatch):
 import importlib.util
 path=Path(__file__).resolve().parents[1]/'remote_executor.py';spec=importlib.util.spec_from_file_location('remote_executor_fixture',path);remote=importlib.util.module_from_spec(spec);spec.loader.exec_module(remote);remote.ROOT=tmp_path/'jobs';remote.ROOT.mkdir();job='a'*32;calls=[]
 def fake_run(*a,**kw):calls.append(a);return type('Result',(),{'returncode':0})()
 monkeypatch.setattr(remote.subprocess,'run',fake_run)
 request={'action':'start','id':job,'command':'printf REMOTE_QA','cwd':str(tmp_path)};assert remote.request(request)['started'];assert remote.request(request)['existing'];assert len(calls)==1
 with pytest.raises(ValueError):remote.request({**request,'command':'printf changed'})
 remote.worker(job);result=remote.request({'action':'read','id':job});assert result['state']['state']=='completed';assert 'REMOTE_QA' in result['output'];assert (remote.ROOT/job/'config.json').stat().st_mode&0o777==0o600
 with pytest.raises(ValueError):remote.request({'action':'read','id':'../escape'})

def test_remote_reconnect_continues_output_without_duplicate_replay(store,monkeypatch):
 from vigia_monitor import remote
 task(store);rid=store.request('qa','vps','printf remote');r=store.claim();calls=[]
 def call(payload):
  calls.append(payload)
  if payload['action']=='start':return {'existing':True}
  offset=payload.get('offset',0);return {'state':{'state':'completed','exit_code':0},'offset':6,'output':'REMOTE' if offset<6 else ''}
 monkeypatch.setattr(remote,'call',call);assert remote.run(store,r,task(store))==('completed',0);before=len(store.rows("SELECT * FROM output WHERE kind='output'"));assert remote.run(store,r,task(store))==('completed',0);assert len(store.rows("SELECT * FROM output WHERE kind='output'"))==before

def test_recovery_preserves_remote_jobs_and_never_replays_local_commands(store):
 task(store);local=store.request('qa','shell','printf local');store.claim();store.task('remote',cwd='/home/adunir');remote=store.request('remote','vps','printf remote');store.claim();store.recover();states={r['id']:r['state'] for r in store.rows('SELECT id,state FROM requests')};assert states[local]=='interrupted';assert states[remote]=='queued'

def test_app_server_stream_and_approval_response_stay_bound_to_request(store,tmp_path,monkeypatch):
 from vigia_monitor import runner
 fake=tmp_path/'rpc.py';fake.write_text('''import sys,json
for line in sys.stdin:
 m=json.loads(line);method=m.get('method');rid=m.get('id')
 if method=='initialize':print(json.dumps({'id':rid,'result':{}}),flush=True)
 elif method=='thread/start':print(json.dumps({'id':rid,'result':{'thread':{'id':'fixture-thread','status':{'type':'idle'}}}}),flush=True)
 elif method=='turn/start':
  print(json.dumps({'id':rid,'result':{'turn':{'id':'fixture-turn'}}}),flush=True)
  print(json.dumps({'id':'approval-1','method':'item/commandExecution/requestApproval','params':{'command':'fictional-command-never-executed'}}),flush=True)
 elif rid=='approval-1':
  assert m['result']['decision']=='accept'
  print(json.dumps({'method':'item/agentMessage/delta','params':{'delta':'VIGIA_FAKE_OK'}}),flush=True)
  print(json.dumps({'method':'turn/completed','params':{'turn':{'status':'completed'}}}),flush=True)
''')
 rpc_class=runner.Rpc;monkeypatch.setattr(runner,'Rpc',lambda *_:rpc_class([sys.executable,str(fake)]));task(store);rid=store.request('qa','ai','Pedido fictício');request=store.claim();thread=threading.Thread(target=runner.execute_request,args=(store,request));thread.start();deadline=time.time()+5;approval=[]
 while time.time()<deadline:
  approval=store.rows('SELECT * FROM approvals')
  if approval:break
  time.sleep(.02)
 assert approval and approval[0]['request_id']==rid;store.decide(approval[0]['id'],'accept');thread.join(5);assert not thread.is_alive();assert store.rows('SELECT state FROM requests WHERE id=?',(rid,))[0]['state']=='completed';assert any('VIGIA_FAKE_OK' in r['text'] for r in store.rows('SELECT text FROM output'));assert store.rows('SELECT answered FROM approvals')[0]['answered']==1

@pytest.mark.asyncio
async def test_task_and_step_editors_keep_working_during_live_refresh(store):
 from vigia_monitor.ui import VigiaApp
 from textual.widgets import Input,Select
 task(store);app=VigiaApp(store)
 async with app.run_test(size=(120,48)) as pilot:
  app.action_new_task(edit=True);await pilot.pause(2.1);app.screen.query_one('#new-title',Input).value='Título editado';await pilot.click('#new-save');await pilot.pause();assert store.rows('SELECT title FROM tasks')[0]['title']=='Título editado'
  app.edit_step();await pilot.pause();app.screen.query_one('#step-id',Input).value='unit';app.screen.query_one('#step-title',Input).value='Etapa fictícia';app.screen.query_one('#step-state',Select).value='completed';await pilot.click('#step-save');await pilot.pause();assert store.progress('qa')==100

def test_git_graph_and_diffs_show_changes_without_runtime_files(tmp_path):
 import subprocess
 from vigia_monitor.sources import git_snapshot,git,file_diff
 repo=tmp_path/'repo';repo.mkdir();subprocess.run(['git','init','-q',str(repo)],check=True);path=repo/'site/src/unit.py';path.parent.mkdir(parents=True);path.write_text('VALUE = 1\n');subprocess.run(['git','-C',str(repo),'add','.'],check=True);subprocess.run(['git','-C',str(repo),'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','Fixture commit'],check=True)
 path.write_text('VALUE = 2\n');snap=git_snapshot(repo);assert 'Fixture commit' in snap['graph'];assert snap['files']==['site/src/unit.py'];assert '+VALUE = 2' in file_diff(repo,'site/src/unit.py');assert 'fora' in file_diff(repo,'.env');commit=git(repo,'rev-parse','HEAD').strip();assert '+VALUE = 1' in file_diff(repo,'site/src/unit.py',commit)

@pytest.mark.asyncio
async def test_keyboard_selection_targets_visible_task_and_ctrl_enter(store):
 from vigia_monitor.ui import VigiaApp
 from textual.widgets import DataTable,TextArea
 task(store);store.task('second',title='Segunda tarefa');app=VigiaApp(store)
 async with app.run_test(size=(120,45)) as pilot:
  table=app.query_one('#tasks',DataTable);table.focus();await pilot.press('down');await pilot.pause();key=table.coordinate_to_cell_key(table.cursor_coordinate).row_key.value;assert app.task_id==key
  await pilot.press('f2');await pilot.pause();app.query_one('#prompt-text',TextArea).load_text('Pedido de teste pelo teclado');await pilot.press('ctrl+enter');await pilot.pause();row=store.rows('SELECT task_id,body FROM requests')[0];assert row['task_id']==key and row['body']=='Pedido de teste pelo teclado'

def test_diagnostic_cursor_pages_replays_and_rejects_identity_values(store,monkeypatch):
 from vigia_monitor import diagnostics
 import datetime as dt,uuid,copy
 base=dt.datetime.now(dt.timezone.utc);records=[{'id':str(uuid.uuid4()),'ts':(base+dt.timedelta(milliseconds=i)).isoformat(),'classification':'validation_failed','metadata':{'name':'PRIVATE_NAME','cpf':'52998224725','errorFields':['cpf','PRIVATE_NAME'],'marks':[{'phase':'name','code':'mismatch','analysis':{'reason':'word_order','typedWords':3,'registryWords':3,'name':'PRIVATE_NAME'}}]}} for i in range(503)];calls=[]
 def query(after):
  calls.append(after);return {'available':True,'source_at':base.isoformat(),'summary':[],'records':copy.deepcopy(records[:500] if len(calls)%2 else records[500:])}
 monkeypatch.setattr(diagnostics,'remote_query',query);diagnostics.pull(store);assert len(store.rows('SELECT id FROM events'))==503;diagnostics.pull(store);assert len(store.rows('SELECT id FROM events'))==503
 assert len(calls)==4;assert 'PRIVATE_NAME' not in str(store.rows('SELECT data FROM events'));assert '52998224725' not in str(store.rows('SELECT data FROM events'));cursor=json.loads(store.rows("SELECT value FROM meta WHERE key='diagnostics_cursor'")[0]['value']);assert cursor['id']==records[-1]['id']
 with pytest.raises((ValueError,TypeError)):diagnostics.query_sql({'ts':"x'; DROP TABLE signatures; --",'id':'bad'})

@pytest.mark.asyncio
async def test_approval_button_uses_visible_keyboard_selection_after_refresh(store):
 from vigia_monitor.ui import VigiaApp
 from textual.widgets import TabbedContent,DataTable
 task(store);rid=store.request('qa','ai','fictício')
 for aid in ['first','second']:store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?)',(aid,rid,json.dumps(aid),'item/commandExecution/requestApproval',json.dumps({'command':aid}),'2026-11-07',time.time()+600,None,0))
 app=VigiaApp(store)
 async with app.run_test(size=(120,40)) as pilot:
  app.query_one(TabbedContent).active='tab-approvals';await pilot.pause();table=app.query_one('#approvals',DataTable);table.focus();await pilot.press('down');await pilot.pause();expected=table.coordinate_to_cell_key(table.cursor_coordinate).row_key.value;app.refresh_data();await pilot.pause();assert app.approval_id==expected;await pilot.click('#approval-accept');await pilot.pause();decided=store.rows('SELECT id FROM approvals WHERE decision=?',('accept',));assert [x['id'] for x in decided]==[expected]

def test_local_owned_job_can_pause_resume_and_cancel(store):
 import psutil
 task(store);rid=store.request('qa','shell','sleep 30');request=store.claim();thread=threading.Thread(target=execute_request,args=(store,request),daemon=True);thread.start()
 def wait(check):
  deadline=time.time()+5
  while time.time()<deadline:
   if check():return
   time.sleep(.03)
  raise AssertionError('Controle não confirmado')
 try:
  wait(lambda:store.rows('SELECT pid FROM requests WHERE id=?',(rid,))[0]['pid'] is not None)
  store.execute('UPDATE requests SET control=? WHERE id=?',(json.dumps({'id':'pause','action':'pause'}),rid));wait(lambda:store.rows('SELECT state FROM requests WHERE id=?',(rid,))[0]['state']=='paused')
  pid=store.rows('SELECT pid FROM requests WHERE id=?',(rid,))[0]['pid'];assert psutil.Process(pid).status()==psutil.STATUS_STOPPED
  store.execute('UPDATE requests SET control=? WHERE id=?',(json.dumps({'id':'resume','action':'resume'}),rid));wait(lambda:store.rows('SELECT state FROM requests WHERE id=?',(rid,))[0]['state']=='running')
 finally:
  store.execute('UPDATE requests SET control=? WHERE id=?',(json.dumps({'id':'cancel','action':'cancel'}),rid));thread.join(6)
 assert not thread.is_alive();assert store.rows('SELECT state FROM requests WHERE id=?',(rid,))[0]['state']=='interrupted'
