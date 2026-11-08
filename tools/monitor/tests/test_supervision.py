import concurrent.futures
import datetime as dt
import json
import sys
import time
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vigia_monitor.store import Store
from vigia_monitor.supervision import Supervisor,watch,install_plan
from vigia_monitor.notifications import deliver_one


@pytest.fixture
def store(tmp_path):
 s=Store(tmp_path/'monitor.sqlite');s.task('qa',title='QA',state='running',cwd=str(tmp_path));return s


def plan():
 return [{'id':'one','title':'Primeira','body':'Usar apenas dados fictícios','criteria':'Verificação independente aprovada','require_report':False,'checks':[[sys.executable,'-c','print("QA_VERIFY")']]}]


def finish(store,rid,state='completed'):
 store.execute('UPDATE requests SET state=?,exit_code=? WHERE id=?',(state,0 if state=='completed' else 1,rid))


def test_stall_detected_once_and_does_not_replay_or_kill(store):
 watch(store,'qa');rid=store.request('qa','shell','Não executar');store.claim()
 old='2020-01-01T00:00:00+00:00';store.execute('UPDATE tasks SET updated_at=?',(old,));store.execute('UPDATE requests SET updated_at=?',(old,))
 supervisor=Supervisor(store);supervisor.scan();supervisor.scan()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='interrupted'
 assert store.rows('SELECT state FROM requests')[0]['state']=='running'
 assert len(store.rows('SELECT * FROM outbox'))==1
 assert len(store.rows('SELECT * FROM requests'))==1
 store.out(rid,'Saída real');assert store.rows('SELECT state FROM tasks')[0]['state']=='running'
 assert len(store.rows('SELECT * FROM outbox'))==2


def test_manual_pause_and_wait_are_not_resumed(store):
 watch(store,'qa');rid=store.request('qa','shell','Não executar');store.claim()
 store.task('qa',state='paused');store.out(rid,'Saída');Supervisor(store).scan()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='paused'
 assert not store.rows('SELECT * FROM outbox')


def test_recent_work_and_silent_executors_distinguished(store):
 watch(store,'qa');old='2020-01-01T00:00:00+00:00';store.execute('UPDATE tasks SET updated_at=?',(old,))
 rid=store.request('qa','ai','QA');store.claim();Supervisor(store).scan()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='running'
 store.execute('UPDATE requests SET updated_at=?',(old,));Supervisor(store).scan()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='interrupted'


def test_install_is_atomic_and_completion_guarded(store):
 watch(store,'qa')
 with pytest.raises(ValueError):store.task('qa',state='completed')
 with pytest.raises(ValueError):install_plan(store,'qa',[*plan(),{**plan()[0],'id':'two','dependencies':['unknown']}])
 assert not store.rows('SELECT * FROM workflow_steps')
 install_plan(store,'qa',plan())
 store.step('qa','old','Etapa histórica',state='completed')
 assert store.progress('qa')==0
 with pytest.raises(ValueError):install_plan(store,'qa',plan())
 with pytest.raises(ValueError):store.task('qa',state='completed')


def test_serial_claims_validation_gate_and_persistent_resume(store):
 watch(store,'qa');install_plan(store,'qa',[*plan(),{**plan()[0],'id':'two','dependencies':['one']}])
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda _:Supervisor(store).advance(),range(4)))
 assert len(store.rows('SELECT * FROM requests'))==1
 work=store.claim();assert work['kind']=='ai';finish(store,work['id'])
 s=Store(store.path);Supervisor(s).advance();check=s.claim();assert check['kind']=='shell'
 assert s.rows('SELECT state FROM workflow_steps ORDER BY position')[0]['state']=='checking'
 assert s.rows('SELECT state FROM tasks')[0]['state']=='running'
 finish(s,check['id']);Supervisor(s).advance()
 assert s.rows('SELECT state FROM workflow_steps ORDER BY position')[0]['state']=='completed'
 assert len(s.rows('SELECT * FROM requests'))==3
 work=s.claim();finish(s,work['id']);Supervisor(s).advance();check=s.claim();finish(s,check['id']);Supervisor(s).advance()
 assert s.rows('SELECT state FROM tasks')[0]['state']=='completed'
 assert len(s.rows('SELECT * FROM outbox'))==3


def test_failed_checks_stop_and_preserve_evidence(store):
 watch(store,'qa');install_plan(store,'qa',plan());Supervisor(store).advance();work=store.claim();finish(store,work['id']);Supervisor(store).advance();check=store.claim();finish(store,check['id'],'failed');Supervisor(store).advance();Supervisor(store).advance()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='waiting'
 step=store.rows('SELECT * FROM workflow_steps')[0];assert step['state']=='waiting' and check['id'] in step['checkpoint']
 assert len(store.rows('SELECT * FROM requests'))==2


def test_repair_is_diagnostic_bounded_and_no_shell_replay(store):
 watch(store,'qa');install_plan(store,'qa',[{**plan()[0],'max_repairs':1}])
 for attempt in range(2):
  Supervisor(store).advance();work=store.claim();assert work['kind']=='ai'
  if attempt:assert 'Verificação falhou' in work['body']
  finish(store,work['id']);Supervisor(store).advance();check=store.claim();finish(store,check['id'],'failed');Supervisor(store).advance()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='waiting'
 assert len(store.rows('SELECT * FROM requests'))==4


def test_agent_failure_and_restart_never_replay_unknown_commands(store):
 watch(store,'qa');install_plan(store,'qa',plan());Supervisor(store).advance();work=store.claim();store.recover();Supervisor(store).advance()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='waiting'
 assert len(store.rows('SELECT * FROM requests'))==1
 assert store.rows('SELECT state FROM requests')[0]['state']=='interrupted'


def test_notifications_claim_once_and_unknown_result_not_retried(store,monkeypatch):
 from vigia_monitor import notifications
 calls=[]
 def run(*args,**kwargs):
  calls.append(json.loads(kwargs['input']));time.sleep(.05)
  return type('Result',(),{'returncode':0,'stdout':'{"status":202,"id":"fixture"}'})()
 monkeypatch.setattr(notifications.subprocess,'run',run)
 store.queue_mail('fixture','QA','Não enviar realmente')
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(lambda _:deliver_one(store),range(3)))
 assert len(calls)==1 and store.rows('SELECT state FROM outbox')[0]['state']=='accepted'
 def timeout(*args,**kwargs):raise notifications.subprocess.TimeoutExpired('fixture',1)
 monkeypatch.setattr(notifications.subprocess,'run',timeout);store.queue_mail('unknown','QA','Sem reenvio')
 deliver_one(store);deliver_one(store)
 assert store.rows('SELECT state FROM outbox WHERE id=?',('unknown',))[0]['state']=='uncertain'


def test_real_shell_verification_and_restart_persistence(store):
 from vigia_monitor.runner import execute_request
 watch(store,'qa');install_plan(store,'qa',plan());Supervisor(store).advance()
 work=store.claim();finish(store,work['id']);Supervisor(store).advance()
 check=store.claim();execute_request(store,check)
 restarted=Store(store.path);Supervisor(restarted).advance()
 assert restarted.rows('SELECT state FROM tasks')[0]['state']=='completed'
 assert any('QA_VERIFY' in r['text'] for r in restarted.rows('SELECT text FROM output WHERE request_id=?',(check['id'],)))


def test_transport_retries_back_off_and_stop_after_two(store):
 watch(store,'qa');install_plan(store,'qa',plan());Supervisor(store).advance()
 for attempt in range(3):
  work=store.claim();assert work and work['kind']=='ai'
  finish(store,work['id'],'failed');store.execute("UPDATE requests SET failure_class='transport' WHERE id=?",(work['id'],));Supervisor(store).advance()
  if attempt<2:
   assert store.claim() is None
   row=store.rows('SELECT * FROM workflow_steps')[0];assert row['retry_after'] and row['transient_retries']==attempt+1
   store.execute("UPDATE workflow_steps SET retry_after='2000-01-01T00:00:00+00:00'");Supervisor(store).advance()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='waiting'
 assert len(store.rows('SELECT * FROM requests'))==3


def test_shell_arguments_are_quoted_not_interpreted(store,tmp_path):
 sentinel=tmp_path/'must-not-exist'
 spec=plan();spec[0]['checks']=[[sys.executable,'-c','import sys; print(sys.argv[1])',f'$(touch {sentinel})']]
 watch(store,'qa');install_plan(store,'qa',spec);Supervisor(store).advance();work=store.claim();finish(store,work['id']);Supervisor(store).advance()
 from vigia_monitor.runner import execute_request
 execute_request(store,store.claim());Supervisor(store).advance()
 assert not sentinel.exists()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='completed'


def test_simple_monitor_reads_canonical_supervised_state(store,monkeypatch):
 import importlib.util
 spec=importlib.util.spec_from_file_location('supervision_simple',Path(__file__).resolve().parents[1]/'vigia_simples.py')
 simple=importlib.util.module_from_spec(spec);spec.loader.exec_module(simple)
 monkeypatch.setattr(simple,'STATE',store.path.parent/'simple');watch(store,'qa')
 store.task('qa',updated_at='2020-01-01T00:00:00+00:00');Supervisor(store).scan()
 assert simple.activities()[0]['state']=='interrupted'


def test_structured_continuation_requires_tools_and_does_not_complete_step(store):
 watch(store,'qa');install_plan(store,'qa',[{**plan()[0],'require_report':True}]);Supervisor(store).advance();work=store.claim()
 store.execute('UPDATE requests SET run_report=?,activity_count=1 WHERE id=?',(json.dumps({'status':'continue','checkpoint':'Alteração parcial; faltam regressões'}),work['id']));finish(store,work['id']);Supervisor(store).advance()
 next_run=store.claim();assert next_run['kind']=='ai' and 'faltam regressões' in next_run['body']
 assert store.rows('SELECT state FROM tasks')[0]['state']=='running'
 # A reply without work must not create an endless loop.
 store.execute('UPDATE requests SET run_report=? WHERE id=?',(json.dumps({'status':'continue','checkpoint':'Sem ferramentas'}),next_run['id']));finish(store,next_run['id']);Supervisor(store).advance()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='waiting'
 assert len(store.rows('SELECT * FROM requests'))==2


def test_missing_report_is_not_success_even_if_turn_completed(store):
 watch(store,'qa');install_plan(store,'qa',[{**plan()[0],'require_report':True}]);Supervisor(store).advance();work=store.claim();finish(store,work['id']);Supervisor(store).advance()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='waiting'
 assert not store.rows("SELECT * FROM requests WHERE kind='shell'")


def test_managed_ai_restart_only_resumes_if_previous_pid_is_absent(store,monkeypatch):
 import os
 watch(store,'qa');install_plan(store,'qa',plan());Supervisor(store).advance();work=store.claim();store.execute('UPDATE requests SET pid=123456 WHERE id=?',(work['id'],))
 def gone(*args):raise ProcessLookupError()
 monkeypatch.setattr(os,'kill',gone);store.recover();Supervisor(store).advance()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='queued'
 assert store.rows('SELECT transient_retries FROM workflow_steps')[0]['transient_retries']==1


def test_blocked_stage_does_not_stop_independent_work(store):
 watch(store,'qa');install_plan(store,'qa',[{**plan()[0],'require_report':True},{**plan()[0],'id':'independent'}]);Supervisor(store).advance();work=store.claim()
 store.execute('UPDATE requests SET run_report=? WHERE id=?',(json.dumps({'status':'blocked','checkpoint':'Aprovação necessária'}),work['id']));finish(store,work['id']);Supervisor(store).advance()
 other=store.claim();assert other and other['id']!=work['id']
 assert store.rows('SELECT state FROM tasks')[0]['state']=='running'


def test_existing_executor_pid_prevents_automatic_restart(store,monkeypatch):
 import os
 watch(store,'qa');install_plan(store,'qa',plan());Supervisor(store).advance();work=store.claim();store.execute('UPDATE requests SET pid=? WHERE id=?',(os.getpid(),work['id']))
 store.recover();Supervisor(store).advance()
 assert store.rows('SELECT state FROM tasks')[0]['state']=='waiting'
 assert store.rows('SELECT transient_retries FROM workflow_steps')[0]['transient_retries']==0
