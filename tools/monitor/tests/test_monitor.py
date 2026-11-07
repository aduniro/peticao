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
