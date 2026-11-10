import importlib.util,pathlib,tempfile,unittest,json
from unittest.mock import patch
P=pathlib.Path('/mnt/apps/peticao-final/_ops/controle-operacional/infra/qualify_fixture_turn.py');SPEC=importlib.util.spec_from_file_location('fixture_qualification',P);q=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(q)
class FixtureQualificationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir="/dev/shm" if pathlib.Path("/dev/shm").is_dir() else None);self.addCleanup(self.tmp.cleanup);root=pathlib.Path(self.tmp.name);schema=root/'schema';schema.mkdir()
  text_input={'type':'object','properties':{'type':{'enum':['text']},'text':{'type':'string'}},'required':['type','text'],'additionalProperties':False}
  definitions={
   'ThreadStartParams':{'type':'object','properties':{'ephemeral':{'const':True},'cwd':{'type':'string'},'sandbox':{'enum':['read-only']},'approvalPolicy':{'enum':['never']}},'required':['ephemeral','cwd','sandbox','approvalPolicy'],'additionalProperties':False},
   'TurnStartParams':{'type':'object','properties':{'threadId':{'type':'string'},'input':{'type':'array','items':text_input},'sandboxPolicy':{'type':'object','properties':{'type':{'const':'readOnly'},'networkAccess':{'const':False}},'required':['type','networkAccess'],'additionalProperties':False},'approvalPolicy':{'const':'never'}},'required':['threadId','input','sandboxPolicy','approvalPolicy'],'additionalProperties':False},
   'TurnInterruptParams':{'type':'object','properties':{'threadId':{'type':'string'},'turnId':{'type':'string'}},'required':['threadId','turnId'],'additionalProperties':False}}
  for name,data in definitions.items():(schema/(name+'.json')).write_text(json.dumps(data))
  for name,value in [('SCHEMA',schema),('WORKSPACE',root/'empty')]:
   patcher=patch.object(q,name,value);patcher.start();self.addCleanup(patcher.stop)
 def setup_proxy(self):
  a,b,_=q.preflight();return q.FixtureProxy(a,b)
 def test_schema_preflight_confirms_ephemeral_readonly_no_model_or_provider_override(self):
  a,b,hashes=q.preflight();self.assertTrue(a['ephemeral']);self.assertEqual(a['sandbox'],'read-only');self.assertEqual(b['sandboxPolicy'],{'type':'readOnly','networkAccess':False});self.assertEqual(b['input'][0]['text'],q.PROMPT)
  self.assertTrue(all(k not in a and k not in b for k in ['model','modelProvider','config','objective','goal']));self.assertEqual(len(hashes),3)
 def test_gateway_readonly_allowlist_is_not_relaxed(self):
  self.assertEqual(q.g.ReadOnlyProxy.METHODS,{'initialize','thread/read'})
  self.assertNotIn('turn/start',q.g.ReadOnlyProxy.METHODS)
 def test_single_start_and_real_thread_target_rejected(self):
  p=self.setup_proxy();p.fixture_id='fixture-only';params={**p.turn_template,'threadId':p.fixture_id};p.validate_call('turn/start',params);p.turn_start_sent=True
  with self.assertRaises(q.FixtureFailure):p.validate_call('turn/start',params)
  p.turn_start_sent=False;p.fixture_id=q.g.ALIASES['admin']
  with self.assertRaises(q.FixtureFailure):p.validate_call('turn/start',{**p.turn_template,'threadId':p.fixture_id})
  for method in ('thread/resume','turn/steer','thread/objective/set','command/exec'):
   with self.assertRaises(q.FixtureFailure):p.validate_call(method,{})
 def test_tool_detection_interrupts_only_fixture_once(self):
  p=self.setup_proxy();p.fixture_id='fixture-only';p.turn_id='fixture-turn';p.turn_start_sent=True;sent=[];p.send=sent.append
  message={'method':'item/started','params':{'threadId':p.fixture_id,'turnId':p.turn_id,'item':{'type':'mcpToolCall'}}}
  p.notification(message);p.notification(message);self.assertTrue(p.tool_seen);self.assertEqual(len(sent),1);self.assertEqual(sent[0]['method'],'turn/interrupt');self.assertEqual(sent[0]['params'],{'threadId':'fixture-only','turnId':'fixture-turn'})
  other=self.setup_proxy();other.fixture_id='fixture-only';other.turn_id='fixture-turn';other.turn_start_sent=True;other.send=sent.append
  other.notification({'method':'item/started','params':{'threadId':q.g.ALIASES['admin'],'item':{'type':'commandExecution'}}});self.assertFalse(other.tool_seen);self.assertFalse(other.interrupt_sent)
 def test_intent_existing_prevents_any_transport_or_retry(self):
  with tempfile.TemporaryDirectory(dir="/dev/shm" if pathlib.Path("/dev/shm").is_dir() else None) as t:
   p=pathlib.Path(t)/'intent.json';p.write_text('{}')
   with patch.object(q,'INTENT',p),patch.object(q,'FixtureProxy',side_effect=AssertionError('must not connect')):
    with self.assertRaises(FileExistsError):q.run_once()
 def test_answer_and_completed_tracking_do_not_expose_history(self):
  p=self.setup_proxy();p.fixture_id='fixture-only';p.turn_id='fixture-turn';p.turn_start_sent=True
  p.notification({'method':'item/agentMessage/delta','params':{'threadId':'fixture-only','turnId':'fixture-turn','delta':q.EXPECTED}})
  p.notification({'method':'turn/completed','params':{'threadId':'fixture-only','turn':{'id':'fixture-turn','status':'completed'}}})
  self.assertEqual(p.answer,q.EXPECTED);self.assertTrue(p.turn_completed);self.assertFalse(p.tool_seen)
if __name__=='__main__':unittest.main()
