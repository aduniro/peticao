import datetime as dt
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

PATH=pathlib.Path(__file__).with_name('watch_sessions.py')
spec=importlib.util.spec_from_file_location('watch',PATH);w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)

class WatchTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def row(self,kind='function_call',stamp='2026-11-10T18:00:00Z'):
  return dict(timestamp=stamp,type='response_item',payload=dict(type=kind,name='functions.exec',arguments='SECRET_TOOL_ARGS',output='SECRET_OUTPUT',content='SECRET_USER_TEXT'))
 def write(self,rows):
  path=self.root/'session.jsonl';path.write_text(''.join(json.dumps(row)+'\n' for row in rows));return path
 def test_metadata_allowlist_never_contains_content(self):
  data=w.metadata(self.row());self.assertEqual(data['tool_name'],'functions.exec')
  encoded=json.dumps(data)
  for value in ['SECRET_TOOL_ARGS','SECRET_OUTPUT','SECRET_USER_TEXT','arguments','output','content']:self.assertNotIn(value,encoded)
 def test_incremental_partial_json_and_dedup(self):
  row=json.dumps(self.row()).encode();path=self.root/'partial.jsonl';path.write_bytes(row[:40])
  state,events,_=w.consume(path,None);self.assertEqual(state['offset'],0);self.assertEqual(events,[])
  with path.open('ab') as stream:stream.write(row[40:]+b'\n')
  state,events,_=w.consume(path,state);self.assertEqual(len(events),1)
  same,events,_=w.consume(path,state);self.assertEqual(events,[]);self.assertEqual(same,state)
  self.assertNotIn('SECRET',json.dumps(state))
 def test_truncation_and_rotation_reset_offsets(self):
  path=self.write([self.row()]);state,_,_=w.consume(path,None)
  path.write_text('{}\n');fresh,events,_=w.consume(path,state);self.assertEqual(fresh['offset'],3);self.assertEqual(events,[])
  replacement=self.root/'replacement';replacement.write_text(json.dumps(self.row())+'\n');replacement.replace(path)
  rotated,events,_=w.consume(path,fresh);self.assertNotEqual(rotated['identity'],fresh['identity']);self.assertEqual(len(events),1)
 def test_budget_and_large_line_skip_without_raw_state(self):
  row=self.row();row['payload']['arguments']='SENSITIVE_CANARY'*20000
  path=self.write([row,self.row(stamp='2026-11-10T18:00:01Z')])
  state,_,used=w.consume(path,None,budget=64*1024);self.assertLessEqual(used,64*1024)
  self.assertNotIn('SENSITIVE_CANARY',json.dumps(state))
  self.assertGreater(state['initial_history_skipped_bytes'],0)
 def test_state_is_not_watcher_heartbeat(self):
  clock=dt.datetime(2026,11,10,18,0,tzinfo=dt.timezone.utc)
  self.assertEqual(w.activity_state({},clock),'unknown')
  state={'last_activity':{'at':'2026-11-10T17:00:00+00:00','event_type':'function_call'}}
  self.assertEqual(w.activity_state(state,clock),'stale')
  state['last_activity']['at']='2026-11-10T17:59:00+00:00';self.assertEqual(w.activity_state(state,clock),'recent_activity')
  state['last_activity']['event_type']='task_complete';state['last_task_signal']=state['last_activity'];self.assertEqual(w.activity_state(state,clock),'task_closed')
 def test_ledger_publish_changes_only_without_ack(self):
  calls=[];cp={};actors={'apoio':{'state':'stale','last_activity':{'at':'2026-11-10T17:00:00Z'}}};repos={'consolidacao':{'state':'observed','app_commit':'a'*40}}
  w.publish(actors,repos,cp,calls.append);self.assertEqual(len(calls),2)
  w.publish(actors,repos,cp,calls.append);self.assertEqual(len(calls),2)
  self.assertTrue(all('--no-require-ack' in args for args in calls));self.assertIn('--app-code-only',calls[1])
 def test_tracked_app_only_no_private_or_untracked_files(self):
  repo=self.root/'repo';repo.mkdir()
  def git(*args):subprocess.run(['/usr/bin/git','-C',str(repo),*args],check=True,capture_output=True)
  git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid')
  (repo/'site/src').mkdir(parents=True);(repo/'site/src/app.ts').write_text('ok');(repo/'site/src/private.csv').write_text('PRIVATE_CSV');(repo/'private.txt').write_text('PRIVATE')
  git('add','.');git('commit','-m','fixture')
  (repo/'site/src/app.ts').write_text('changed');(repo/'site/src/private.csv').write_text('changed private');(repo/'site/src/untracked.ts').write_text('untracked')
  result=w.app_status(repo);self.assertEqual([x['path'] for x in result['tracked_app_changes']],['site/src/app.ts'])
  self.assertNotIn('PRIVATE',json.dumps(result));self.assertNotIn('untracked',json.dumps(result))
 def test_collect_only_named_sessions(self):
  path=self.root/('rollout-'+w.ACTORS['apoio']+'.jsonl');path.write_text(json.dumps(self.row())+'\n')
  (self.root/'other.jsonl').write_text('UNAUTHORIZED_CANARY')
  cp={};actors=w.collect_sessions(self.root,cp)
  self.assertEqual(actors['admin']['state'],'unknown');self.assertEqual(actors['apoio']['last_activity']['tool_name'],'functions.exec')
  self.assertNotIn('UNAUTHORIZED_CANARY',json.dumps(cp))

if __name__=='__main__':unittest.main()
