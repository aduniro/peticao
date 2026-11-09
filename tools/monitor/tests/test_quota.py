import concurrent.futures
import json
import os
import sys
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vigia_monitor.store import Store
from vigia_monitor.supervision import Supervisor,watch,install_plan
from vigia_monitor.quota import allowed,next_check,configure,record,advance,WAIT_STAGE


def snapshot(permit=True,**bucket):
 return {'ordinaryUsageAllowed':permit,'rateLimits':{'limitId':'codex','rateLimitReachedType':None,'spendControlReached':False,**bucket}}


@pytest.fixture
def pending(tmp_path):
 s=Store(tmp_path/'private/monitor.sqlite');s.task('qa',title='Fictício',state='running',cwd=str(tmp_path),scope='Sem deploy ou envio')
 watch(s,'qa');install_plan(s,'qa',[{'id':'one','title':'QA','body':'Somente ficção','criteria':'Checar marcador','checks':[[sys.executable,'-c','print("QA")']]}])
 configure(s,'qa',True)
 # Distinct persisted timestamps, no sleep or real service.
 s.execute("UPDATE quota_policy SET enabled_since='2020-01-01T00:00:00+00:00'")
 Supervisor(s).advance();r=s.claim();s.execute("INSERT INTO threads VALUES('qa','local','fiction-thread')")
 assert record(s,r,'fiction-thread',{'codexErrorInfo':'usageLimitExceeded'},snapshot(False))
 s.execute("UPDATE requests SET state='failed',pid=NULL WHERE id=?",(r['id'],))
 s.execute('UPDATE quota_waits SET next_check=0')
 return s,r


@pytest.mark.parametrize('value',[{},snapshot(None),snapshot(False),snapshot(False,credits={'hasCredits':True}),snapshot(1),snapshot(True,spendControlReached=True),snapshot(True,rateLimitReachedType='workspace_owner_credits_depleted'),snapshot(True,limitId='other')])
def test_no_entitlement_inference(value):
 assert not allowed(value)
 assert not allowed({'rateLimits':{'primary':{'usedPercent':0},'credits':{'hasCredits':True}}})


def test_reset_is_only_probe_deadline():
 assert next_check({'rateLimits':{'primary':{'usedPercent':100,'resetsAt':1100}}},1000)==1115
 assert next_check({'rateLimits':{'secondary':{'usedPercent':100,'resetsAt':9000}}},1000)==1900
 assert next_check({},1000)==1900
 assert allowed(snapshot())


def test_durable_same_thread_context_and_exactly_one_successor(pending):
 s,r=pending;s=Store(s.path);calls=[]
 def probe():calls.append(1);return snapshot()
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda _:advance(s,probe,timestamp=1000),range(4)))
 assert len(calls)==1
 rows=s.rows('SELECT * FROM requests ORDER BY at,rowid');assert len(rows)==2
 successor=next(x for x in rows if x['id']!=r['id'])
 assert successor['state']=='queued' and successor['context']==r['context']
 assert r['id'] in successor['body'] and 'Checkpoint:' in successor['body']
 assert s.rows('SELECT * FROM threads')[0]['id']=='fiction-thread'
 assert s.rows('SELECT work_request FROM workflow_steps')[0]['work_request']==successor['id']
 assert s.rows('SELECT state FROM quota_waits')[0]['state']=='resumed'
 assert s.path.stat().st_mode&0o777==0o600
 advance(s,probe,timestamp=3000);assert len(s.rows('SELECT * FROM requests'))==2


def test_failed_probe_is_spaced_and_does_not_execute(pending):
 s,r=pending;calls=[]
 def probe():calls.append(1);raise TimeoutError('fictício')
 advance(s,probe,timestamp=1000);advance(s,probe,timestamp=1001)
 assert len(calls)==1 and len(s.rows('SELECT * FROM requests'))==1
 assert s.rows('SELECT state,stage FROM tasks')[0]=={'state':'waiting','stage':WAIT_STAGE}
 assert s.rows('SELECT next_check FROM quota_waits')[0]['next_check']==1900


@pytest.mark.parametrize('state',['paused','waiting','interrupted','completed','failed'])
def test_user_state_changes_cancel_and_never_revive(pending,state):
 s,r=pending
 if state=='completed':s.execute('DELETE FROM supervision')
 s.task('qa',state=state);s.task('qa',state='running')
 advance(s,lambda:pytest.fail('Must not probe'),timestamp=1000)
 assert s.rows('SELECT state FROM quota_waits')[0]['state']=='canceled'
 assert len(s.rows('SELECT * FROM requests'))==1


def test_pause_during_probe_wins_transactional_revalidation(pending):
 s,r=pending
 def probe():s.task('qa',state='paused');return snapshot()
 advance(s,probe,timestamp=1000)
 assert len(s.rows('SELECT * FROM requests'))==1
 assert s.rows('SELECT state FROM tasks')[0]['state']=='paused'


def test_scope_change_cancels_pending_authorization(pending):
 s,r=pending;s.task('qa',scope='Escopo menor')
 advance(s,lambda:pytest.fail('No probe after changed scope'),timestamp=1000)
 assert len(s.rows('SELECT * FROM requests'))==1
 assert not record(s,r,'fiction-thread',{'codexErrorInfo':'usageLimitExceeded'},snapshot())


@pytest.mark.parametrize('block',['live_pid','active_request','changed_thread','disabled','changed_failure','control','changed_step'])
def test_no_duplicate_or_changed_authorization(pending,block):
 s,r=pending
 if block=='live_pid':s.execute('UPDATE requests SET pid=?',(os.getpid(),))
 elif block=='active_request':s.request('qa','ai','Outro pedido explícito')
 elif block=='changed_thread':s.execute("UPDATE threads SET id='other'")
 elif block=='disabled':configure(s,'qa',False)
 elif block=='changed_failure':s.execute("UPDATE requests SET failure_class='unknown'")
 elif block=='control':s.execute('UPDATE requests SET control=?',(json.dumps({'action':'cancel'}),))
 else:s.execute("UPDATE workflow_steps SET state='waiting'")
 before=len(s.rows('SELECT * FROM requests'));advance(s,lambda:snapshot(),timestamp=1000)
 assert len(s.rows('SELECT * FROM requests'))==before


@pytest.mark.parametrize('code',['rateLimitExceeded','sessionBudgetExceeded','sandboxError','cyberPolicy','unauthorized','unknown',None])
def test_only_exact_terminal_usage_code_is_eligible(pending,code):
 s,r=pending;s.execute('DELETE FROM quota_waits');s.task('qa',state='running')
 assert not record(s,r,'fiction-thread',{'codexErrorInfo':code,'message':'usage_limit credits'},snapshot())
 assert not s.rows('SELECT * FROM quota_waits')


def test_legacy_and_retry_cap_are_not_resurrected(pending):
 s,r=pending;s.execute('DELETE FROM quota_waits');s.task('qa',state='running')
 s.execute("UPDATE quota_policy SET enabled_since='2099-01-01T00:00:00+00:00'")
 assert not record(s,r,'fiction-thread',{'codexErrorInfo':'usageLimitExceeded'},snapshot())
 s.execute("UPDATE quota_policy SET enabled_since='2020-01-01T00:00:00+00:00'")
 for i in range(2):s.execute("INSERT INTO quota_waits VALUES(?,?,'fiction-thread',0,'resumed','fiction',0,'checkpoint')",('old-'+str(i),'qa'))
 assert not record(s,r,'fiction-thread',{'codexErrorInfo':'usageLimitExceeded'},snapshot())


def test_supervisor_does_not_reclassify_pending_quota(pending):
 s,r=pending;Supervisor(s).advance();Supervisor(s).scan(timestamp=9999999999)
 assert s.rows('SELECT state FROM tasks')[0]['state']=='waiting'
 assert s.rows('SELECT state FROM workflow_steps')[0]['state']=='working'
 assert len(s.rows('SELECT * FROM requests'))==1


def test_task_pause_after_enqueue_blocks_claim(pending):
 s,r=pending;advance(s,lambda:snapshot(),timestamp=1000)
 s.task('qa',state='paused');assert s.claim() is None


@pytest.mark.parametrize('case',['terminal','willRetry','active','denied','safety','cancel','pause'])
def test_runner_protocol_final_state_and_denials(pending,monkeypatch,case):
 from types import SimpleNamespace
 from vigia_monitor import runner
 s,r=pending;s.execute('DELETE FROM quota_waits');s.task('qa',state='running')
 s.execute("UPDATE requests SET state='running',failure_class=NULL")
 error={'codexErrorInfo':'usageLimitExceeded','message':'Ficção'}
 messages=[];calls=[]
 if case=='denied':s.execute("INSERT INTO approvals VALUES('qa-approval',?,'1','fiction','{}','fiction',0,'decline',1)",(r['id'],))
 if case in ('cancel','pause'):s.execute('UPDATE requests SET control=?',(json.dumps({'action':case}),))
 if case=='safety':messages.append({'method':'error','params':{'error':{'codexErrorInfo':'cyberPolicy'},'willRetry':False}})
 if case=='willRetry':messages.append({'method':'error','params':{'error':error,'willRetry':True}})
 messages.append({'method':'turn/completed','params':{'turn':{'status':'completed' if case=='willRetry' else 'failed','error':None if case=='willRetry' else error}}})
 class FakeRpc:
  proc=SimpleNamespace(pid=999999999)
  def initialize(self):pass
  def close(self):pass
  def request(self,*a):calls.append(a)
  def call(self,method,params,**kw):
   calls.append((method,params))
   if method.startswith('thread/'):return {'thread':{'id':'fiction-thread','status':{'type':'active' if case=='active' else 'idle'}}}
   if method=='turn/start':return {'turn':{'id':'fiction-turn'}}
   if method=='account/rateLimits/read':return snapshot(False)
   raise AssertionError(method)
  def receive(self):return messages.pop(0)
 monkeypatch.setattr(runner,'Rpc',lambda *_:FakeRpc())
 runner.execute_request(s,r)
 assert bool(s.rows('SELECT * FROM quota_waits'))==(case=='terminal')
 if case=='terminal':assert s.rows('SELECT failure_class FROM requests')[0]['failure_class']=='usage_limit'
 if case=='active':assert not any(x[0]=='turn/start' for x in calls)
 if case=='willRetry':assert s.rows('SELECT state FROM requests')[0]['state']=='completed'
 if case=='pause':assert s.rows('SELECT state FROM tasks')[0]['state']=='paused'
