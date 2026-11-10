#!/usr/bin/python3
"""One authorized real fixture turn, isolated from the production gateway allowlist."""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json,os,pathlib,time
import jsonschema
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('local_gateway_readonly',HERE/'local_codex_gateway.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
EVIDENCE=g.BASE/'evidence'
SCHEMA=EVIDENCE/'fixture-protocol-schema/v2'
WORKSPACE=EVIDENCE/'fixture-empty-workspace'
INTENT=EVIDENCE/'fixture-turn-intent.json'
PROOF=EVIDENCE/'fixture-turn-proof.json'
PROMPT='Responda exatamente OPS_BRIDGE_FIXTURE_OK. Não use ferramentas, não leia arquivos e não execute comandos.'
EXPECTED='OPS_BRIDGE_FIXTURE_OK'
class FixtureFailure(g.GatewayError):pass
def atomic(path,value):
 temp=path.with_name('.'+path.name+'.tmp')
 with temp.open('w') as f:
  os.chmod(temp,0o600);json.dump(value,f,ensure_ascii=False,sort_keys=True);f.flush();os.fsync(f.fileno())
 temp.replace(path)
def validate_schema(name,params):
 p=SCHEMA/(name+'.json')
 if not p.is_file() or p.is_symlink():raise FixtureFailure('qualified_schema_unavailable')
 schema=json.loads(p.read_text())
 if set(params)-set(schema.get('properties',{})):raise FixtureFailure('schema_fields_unsupported')
 try:jsonschema.validate(params,schema)
 except jsonschema.ValidationError:raise FixtureFailure('schema_rejected_before_generation') from None
 return hashlib.sha256(p.read_bytes()).hexdigest()
def preflight():
 if WORKSPACE.is_symlink():raise FixtureFailure('fixture_workspace_symlink_forbidden')
 WORKSPACE.mkdir(mode=0o700,parents=True,exist_ok=True)
 if any(WORKSPACE.iterdir()):raise FixtureFailure('fixture_workspace_not_empty')
 thread={'ephemeral':True,'cwd':str(WORKSPACE),'sandbox':'read-only','approvalPolicy':'never'}
 turn={'threadId':'fixture-placeholder','input':[{'type':'text','text':PROMPT}],'sandboxPolicy':{'type':'readOnly','networkAccess':False},'approvalPolicy':'never'}
 return thread,turn,{'threadStart':validate_schema('ThreadStartParams',thread),'turnStart':validate_schema('TurnStartParams',turn),'interrupt':validate_schema('TurnInterruptParams',{'threadId':'fixture-placeholder','turnId':'fixture-turn-placeholder'})}
class FixtureProxy(g.ReadOnlyProxy):
 ALLOWED={'initialize','thread/start','turn/start','turn/interrupt'}
 SAFE_ITEMS={'userMessage','agentMessage','reasoning','plan','contextCompaction'}
 def __init__(self,thread_params,turn_template):
  super().__init__(timeout=30);self.thread_params=thread_params;self.turn_template=turn_template;self.fixture_id=None;self.turn_id=None;self.thread_start_sent=False;self.turn_start_sent=False;self.interrupt_sent=False;self.interrupt_id=None;self.turn_completed=False;self.turn_status=None;self.tool_seen=False;self.answer='';self.answer_oversized=False;self.events=collections.Counter();self.pending={};self.rpc_error_code=None
 def __exit__(self,exc_type,exc,tb):
  if exc_type is not None and self.turn_start_sent and not self.turn_completed:
   try:
    self.interrupt_fixture()
    if self.interrupt_sent:self.wait_completed(timeout=5)
   except Exception:self.cleanup_interrupt_unconfirmed=True
  return super().__exit__(exc_type,exc,tb)
 def validate_call(self,method,params):
  if method not in self.ALLOWED:raise FixtureFailure('fixture_rpc_method_forbidden')
  if method=='initialize':
   if self.counter:raise FixtureFailure('fixture_duplicate_initialize')
  elif method=='thread/start':
   if self.thread_start_sent or params!=self.thread_params:raise FixtureFailure('fixture_thread_start_forbidden')
  elif method=='turn/start':
   expected={**self.turn_template,'threadId':self.fixture_id}
   if self.turn_start_sent or not self.fixture_id or self.fixture_id in g.ALIASES.values() or params!=expected:raise FixtureFailure('fixture_turn_start_forbidden')
  else:
   if not self.fixture_id or self.fixture_id in g.ALIASES.values() or not self.turn_id or params!={'threadId':self.fixture_id,'turnId':self.turn_id}:raise FixtureFailure('fixture_interrupt_target_forbidden')
 def request(self,method,params):
  self.validate_call(method,params)
  if method=='initialize':params={'clientInfo':{'name':'peticao_fixture_turn_qualification','title':'Single explicit fixture qualification','version':'1.0'}}
  if method=='thread/start':self.thread_start_sent=True
  if method=='turn/start':self.turn_start_sent=True
  self.counter+=1;ident=self.counter;self.methods.append(method);self.send({'id':ident,'method':method,'params':params});return ident
 def rpc(self,method,params):
  ident=self.request(method,params);deadline=time.monotonic()+self.timeout
  while True:
   message=self.pending.pop(ident,None)
   if message is None:message=self.receive_json(deadline)
   if 'method' in message:self.notification(message);continue
   if message.get('id')!=ident:
    if message.get('id')==self.interrupt_id:self.pending[message['id']]=message;continue
    raise FixtureFailure('fixture_unexpected_response_id')
   if 'error' in message:
    error=message.get('error');self.rpc_error_code=error.get('code') if isinstance(error,dict) and isinstance(error.get('code'),int) else None
    raise FixtureFailure('fixture_rpc_rejected')
   if not isinstance(message.get('result'),dict):raise FixtureFailure('fixture_invalid_response')
   return message['result']
 def interrupt_fixture(self):
  if not self.interrupt_sent and self.fixture_id and self.turn_id:
   self.interrupt_sent=True;self.interrupt_id=self.request('turn/interrupt',{'threadId':self.fixture_id,'turnId':self.turn_id})
 def notification(self,message):
  method=message.get('method');params=message.get('params',{})
  if not isinstance(params,dict):return
  if method in ('thread/started','thread/status/changed','turn/started','turn/completed','item/started','item/completed','item/agentMessage/delta'):self.events[method]+=1
  else:self.events['otherNotifications']+=1
  thread_id=params.get('threadId')
  if thread_id!=self.fixture_id or self.fixture_id is None:return
  if 'id' in message:
   self.tool_seen=True;self.interrupt_fixture();return
  candidate=params.get('turnId')
  if not self.turn_id and self.turn_start_sent and isinstance(candidate,str):self.turn_id=candidate
  if method in ('turn/started','turn/completed'):
   turn=params.get('turn',{})
   if isinstance(turn,dict):
    tid=turn.get('id')
    if not self.turn_id and isinstance(tid,str):self.turn_id=tid
    if tid and tid!=self.turn_id:raise FixtureFailure('fixture_turn_identity_mismatch')
    if method=='turn/completed':self.turn_completed=True;self.turn_status=turn.get('status')
  if method in ('item/started','item/completed'):
   item=params.get('item',{});kind=item.get('type') if isinstance(item,dict) else None
   if kind not in self.SAFE_ITEMS:
    self.tool_seen=True;self.interrupt_fixture()
   if method=='item/completed' and kind=='agentMessage':
    text=item.get('text')
    if isinstance(text,str):self.capture_answer(text,replace=True)
  elif method=='item/agentMessage/delta':
   text=params.get('delta')
   if isinstance(text,str):self.capture_answer(text)
 def capture_answer(self,text,replace=False):
  value=text if replace else self.answer+text
  if len(value.encode())>4096:self.answer_oversized=True;self.interrupt_fixture();return
  self.answer=value
 def wait_completed(self,timeout=120):
  deadline=time.monotonic()+timeout
  while not self.turn_completed:
   message=self.receive_json(deadline)
   if 'method' in message:self.notification(message)
   elif message.get('id')==self.interrupt_id:self.pending[message['id']]=message
   else:raise FixtureFailure('fixture_unexpected_response_id')

def run_once():
 thread_params,turn_template,schema_hashes=preflight()
 intent={'createdAt':g.now(),'phase':'authorized_fixture_intent','promptSha256':hashlib.sha256(PROMPT.encode()).hexdigest(),'modelOverride':False,'providerOverride':False,'schemaSha256':schema_hashes}
 with INTENT.open('x') as f:os.chmod(INTENT,0o600);json.dump(intent,f);f.flush();os.fsync(f.fileno())
 result={'state':'waiting','observedAt':g.now(),'productionGatewayLiveEnabled':False,'fixtureRealTurn':True,'originalThreadIdsContacted':[],'promptSha256':intent['promptSha256'],'schemaSha256':schema_hashes,'workspace':str(WORKSPACE),'modelOverride':False,'providerOverride':False,'newAppServerStarted':False,'historyStored':False,'answerStored':False}
 client=None
 try:
  with FixtureProxy(thread_params,turn_template) as client:
   intent.update(phase='thread_start_intent');atomic(INTENT,intent)
   started=client.rpc('thread/start',thread_params);thread=started.get('thread',{});ident=thread.get('id')
   if not isinstance(ident,str) or not ident or ident in g.ALIASES.values() or thread.get('ephemeral') is not True:raise FixtureFailure('fixture_thread_identity_or_ephemeral_invalid')
   client.fixture_id=ident;intent.update(fixtureThreadId=ident,phase='fixture_thread_created');atomic(INTENT,intent)
   sandbox=started.get('sandbox',{})
   if started.get('cwd')!=str(WORKSPACE) or not isinstance(sandbox,dict) or sandbox.get('type')!='readOnly' or sandbox.get('networkAccess',False) is not False:raise FixtureFailure('fixture_readonly_sandbox_not_confirmed')
   result.update(fixtureThreadId=ident,ephemeral=True,sandbox='readOnly',networkAccess=False)
   turn_params={**turn_template,'threadId':ident};validate_schema('TurnStartParams',turn_params)
   intent.update(phase='turn_start_intent');atomic(INTENT,intent)
   turn=client.rpc('turn/start',turn_params).get('turn',{});turn_id=turn.get('id')
   if not isinstance(turn_id,str) or not turn_id or client.turn_id not in (None,turn_id):raise FixtureFailure('fixture_turn_identity_mismatch')
   client.turn_id=turn_id;intent.update(fixtureTurnId=turn_id,phase='turn_started');atomic(INTENT,intent)
   if client.tool_seen or client.answer_oversized:client.interrupt_fixture()
   client.wait_completed()
   success=client.turn_status=='completed' and not client.tool_seen and not client.answer_oversized and client.answer.strip()==EXPECTED
   result.update(state='completed' if success else 'failed',fixtureTurnId=turn_id,turnStatus=client.turn_status,expectedAnswerMatched=client.answer.strip()==EXPECTED,answerSha256=hashlib.sha256(client.answer.encode()).hexdigest(),answerBytes=len(client.answer.encode()),sameDaemonSocket=client.same_daemon())
 except FileExistsError:raise
 except Exception as error:
  result.update(state='uncertain' if client and client.turn_start_sent else 'waiting',error=error.code if isinstance(error,g.GatewayError) else 'fixture_qualification_unavailable')
  if client:
   try:client.interrupt_fixture()
   except Exception:result['interruptAttemptUnconfirmed']=True
 finally:
  if client:
   result.update(rpcMethods=client.methods,threadStartAttempts=int(client.thread_start_sent),turnStartAttempts=int(client.turn_start_sent),toolOrCommandObserved=client.tool_seen,interruptRequested=client.interrupt_sent,interruptCleanupUnconfirmed=getattr(client,'cleanup_interrupt_unconfirmed',False),rpcErrorCode=client.rpc_error_code)
  result['finishedAt']=g.now();result['qualifierSourceSha256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest();result['gatewaySourceSha256']=hashlib.sha256((HERE/'local_codex_gateway.py').read_bytes()).hexdigest()
  intent.update(phase=result['state'],finishedAt=result['finishedAt']);atomic(INTENT,intent);atomic(PROOF,{'ok':result['state']=='completed','result':result})
 return result

def main():
 os.umask(0o077);p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group(required=True);m.add_argument('--preflight-only',action='store_true');m.add_argument('--run-once',action='store_true');args=p.parse_args()
 try:
  if args.preflight_only:
   a,b,hashes=preflight();result={'state':'preflight_ok','threadParams':a,'turnParamsKeys':list(b),'schemaSha256':hashes,'noRpcSent':True}
  else:result=run_once()
  print(json.dumps({'ok':result['state'] in ('completed','preflight_ok'),'result':result},ensure_ascii=False));return 0 if result['state'] in ('completed','preflight_ok') else 1
 except FileExistsError:print(json.dumps({'ok':False,'error':'fixture_intent_already_exists_do_not_repeat','state':'waiting'}));return 1
 except g.GatewayError as e:print(json.dumps({'ok':False,'error':e.code,'state':'waiting'}));return 1
 except Exception:print(json.dumps({'ok':False,'error':'fixture_preflight_unavailable','state':'waiting'}));return 1
if __name__=='__main__':raise SystemExit(main())
