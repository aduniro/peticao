import concurrent.futures,importlib.util,json,multiprocessing,pathlib,sqlite3,tempfile,time,unittest
from unittest.mock import patch
SPEC=importlib.util.spec_from_file_location('coord',pathlib.Path(__file__).with_name('coord.py'));coord=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(coord)
def compete(db,actor):
 try:return coord.Ledger(db).acquire(actor,['code:site/src/lib/db.ts'])['lease']
 except RuntimeError:return None
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=pathlib.Path(self.tmp.name)/'coord.sqlite';self.l=coord.Ledger(self.db)
  self.l.register('apoio','session-a',[self.tmp.name]);self.l.register('admin','session-b',[self.tmp.name])
 def tearDown(self):self.tmp.cleanup()
 def manifest(self):
  n=self.l.announce('apoio','Manifesto ficticio de testes',['code:'],{'manifest':{'commit':'a'*40,'files':['site/src/fictitious.ts'],'api_contracts':'sem alteracao','database':'sem alteracao','tests':['fixture assertions passaram'],'destination':'/tmp/fixture-target'}})
  self.l.ack('admin',n['seq']);return n['seq']
 def test_normalization_same_logical_resource_across_four_worktrees(self):
  expected='code:site/src/lib/db.ts'
  for r in coord.ROOTS:self.assertEqual(coord.resource(str(r/'site/src/lib/db.ts')),expected)
  self.assertTrue(coord.overlaps('code:site/src','code:site/src/lib/db.ts'));self.assertFalse(coord.overlaps('code:site/src/lib/a','code:site/src/lib/abc'))
 def test_integrated_root_excludes_candidates_without_broad_prefix_alias(self):
  integrated=pathlib.Path('/mnt/apps/peticao-final/peticao-integrado')
  self.assertIn(integrated,coord.ROOTS)
  target='site/src/lib/db.ts'
  lease=self.l.acquire('apoio',[str(coord.ROOTS[1]/target)])
  for root in (coord.ROOTS[0],coord.ROOTS[2],integrated):
   with self.assertRaises(RuntimeError):self.l.acquire('admin',[str(root/target)])
  self.assertEqual(coord.resource(str(integrated/target)),'code:'+target)
  sibling=pathlib.Path('/mnt/apps/peticao-final/peticao-integrado-outra')/target
  self.assertEqual(coord.resource(str(sibling)),'path:'+str(sibling))
  self.assertFalse(coord.overlaps(str(sibling),str(integrated/target)))
 def test_exclusive_concurrent_processes_only_one_owner(self):
  with concurrent.futures.ProcessPoolExecutor(max_workers=2) as p:result=list(p.map(compete,[str(self.db)]*2,['apoio','admin']))
  self.assertEqual(sum(x is not None for x in result),1)
 def test_absolute_path_spellings_collide_and_legacy_is_conservative(self):
  path=str(pathlib.Path(self.tmp.name)/'resource')
  self.assertEqual(coord.resource(path),coord.resource('path:'+path))
  self.assertTrue(coord.overlaps('path:'+path.lstrip('/'),'path:'+path))
  self.assertEqual(coord.resource('path:'+str(coord.ROOTS[1]/'site/src/a.ts')),'code:site/src/a.ts')
  a=self.l.acquire('apoio',[path])
  with self.assertRaises(RuntimeError):self.l.acquire('admin',['path:'+path])
  with self.assertRaises(ValueError):coord.resource('path:relative')
 def test_distinct_paths_can_proceed_together(self):
  self.l.acquire('apoio',['code:site/src/components/Form.tsx']);self.l.acquire('admin',['code:site/src/lib/db.ts'])
  self.assertEqual(len(self.l.status()['leases']),2)
 def test_fence_and_token_checked_and_generations_increase(self):
  a=self.l.acquire('apoio',['code:a'])
  with self.assertRaises(PermissionError):self.l.release('admin',a['lease'],a['token'],a['fence'])
  with self.assertRaises(PermissionError):self.l.release('apoio',a['lease'],'wrong',a['fence'])
  self.l.release('apoio',a['lease'],a['token'],a['fence']);b=self.l.acquire('admin',['code:a']);self.assertGreater(b['fence'],a['fence'])
  with self.assertRaises(PermissionError):self.l.check('admin',b['lease'],b['token'],a['fence'])
 def test_expiry_never_authorizes_blind_takeover_or_renewal(self):
  a=self.l.acquire('apoio',['deploy:production'],'deploy',manifest_event=self.manifest())
  with self.l.db(True) as d:d.execute('UPDATE leases SET expires=? WHERE id=?',(time.time()-1,a['lease']))
  with self.assertRaises(RuntimeError):self.l.acquire('admin',['deploy:production'],'deploy',manifest_event=self.manifest())
  self.assertEqual(self.l.status()['leases'][0]['state'],'uncertain')
  with self.assertRaises(RuntimeError):self.l.renew('apoio',a['lease'],a['token'],a['fence'])
 def test_reconciliation_needs_both_and_cannot_replay(self):
  a=self.l.acquire('apoio',['deploy:production'],'deploy',manifest_event=self.manifest())
  with self.l.db(True) as d:d.execute('UPDATE leases SET expires=0 WHERE id=?',(a['lease'],))
  r=self.l.propose_resolution('apoio',a['lease'],'aborted','Teste ficticio: processo finalizado e resultado conferido')
  self.assertFalse(self.l.confirm_resolution('apoio',r['resolution'])['confirmed'])
  with self.assertRaises(RuntimeError):self.l.acquire('admin',['deploy:production'],'deploy',manifest_event=self.manifest())
  self.assertTrue(self.l.confirm_resolution('admin',r['resolution'])['confirmed'])
  b=self.l.acquire('admin',['deploy:production'],'deploy',manifest_event=self.manifest());self.assertGreater(b['fence'],a['fence'])
  with self.assertRaises(ValueError):self.l.confirm_resolution('apoio',r['resolution'])
 def test_deploy_claims_source_root_and_cannot_overlap_editor(self):
  a=self.l.acquire('apoio',['code:site/src/Form.tsx'])
  with self.assertRaises(RuntimeError):self.l.acquire('admin',['deploy:production'],'deploy',manifest_event=self.manifest())
  self.l.release('apoio',a['lease'],a['token'],a['fence'])
  self.l.acquire('admin',['deploy:production'],'deploy',manifest_event=self.manifest())
  with self.assertRaises(RuntimeError):self.l.acquire('apoio',['code:site/src/Other.tsx'])
 def test_notice_ack_required_before_peer_edit_and_before_deploy(self):
  n=self.l.announce('apoio','Contrato ficticio alterado',['code:site/src/lib/db.ts'])
  with self.assertRaises(RuntimeError):self.l.acquire('admin',['code:site/src/lib/db.ts'])
  with self.assertRaises(RuntimeError):self.l.acquire('apoio',['deploy:production'],'deploy',manifest_event=self.manifest())
  self.l.ack('admin',n['seq']);self.l.acquire('apoio',['deploy:production'],'deploy',manifest_event=self.manifest())
 def test_history_append_only_and_tokens_not_exported(self):
  a=self.l.acquire('apoio',['code:a'])
  with self.l.db() as d:
   with self.assertRaises(sqlite3.IntegrityError):d.execute('DELETE FROM events')
   with self.assertRaises(sqlite3.IntegrityError):d.execute("UPDATE events SET summary='rewrite'")
  self.assertNotIn(a['token'],json.dumps(self.l.status()));self.assertNotIn(a['token'],json.dumps(self.l.history()))
 def test_unknown_actor_rejected(self):
  with self.assertRaises(ValueError):self.l.acquire('stranger',['code:a'])
 def test_observation_never_reads_untracked_or_tracked_contents(self):
  r=coord.ROOTS[1]
  calls=[]
  def git(argv,**kw):
   calls.append(argv)
   if 'rev-parse' in argv:return b'1'*40+b'\n'
   if 'branch' in argv:return b'main\n'
   if 'status' in argv:return b' M site/src/a.ts\0'
   raise AssertionError('Unexpected content command')
  with patch.object(coord.subprocess,'check_output',side_effect=git):
   a=self.l.observe('apoio',str(r));b=self.l.observe('apoio',str(r))
  self.assertTrue(a['changed']);self.assertFalse(b['changed'])
  self.assertTrue(any('--untracked-files=no' in c for c in calls));self.assertFalse(any('show' in c or 'cat-file' in c for c in calls))
 def test_critical_operations_require_complete_acknowledged_manifest(self):
  for op,res in [('deploy','deploy:production'),('merge','code:'),('migration','db:production')]:
   with self.assertRaises(RuntimeError):self.l.acquire('apoio',[res],op)
  bad=self.l.announce('apoio','Manifesto incompleto',['code:'],{'manifest':{'commit':'a'*40}})
  self.l.ack('admin',bad['seq'])
  with self.assertRaises(ValueError):self.l.acquire('apoio',['deploy:production'],'deploy',manifest_event=bad['seq'])
  good=self.l.announce('apoio','Manifesto sem ACK',['code:'],{'manifest':{'commit':'a'*40,'files':['site/a'],'api_contracts':'sem alteracao','database':'sem alteracao','tests':['pass'],'destination':'/tmp'}})
  with self.assertRaises(RuntimeError):self.l.acquire('apoio',['deploy:production'],'deploy',manifest_event=good['seq'])
  self.l.ack('admin',good['seq']);self.l.acquire('apoio',['deploy:production'],'deploy',manifest_event=good['seq'])
 def test_app_scope_excludes_private_artifacts_and_observe_ack_flag(self):
  for name in ('site/src/private.csv','site/public/list.xlsx','site/.env.local','secrets/key','classificacao-divergentes.csv'):
   self.assertFalse(coord.app_path(name))
  self.assertTrue(coord.app_path('site/src/app/page.tsx'))
  counter=[0]
  def git(argv,**kw):
   if 'rev-parse' in argv:counter[0]+=1;return str(counter[0]).encode()*40+b'\n'
   if 'branch' in argv:return b'main\n'
   if 'status' in argv:return b' M site/src/app/page.tsx\0 M site/src/private.csv\0'
   if 'diff' in argv:return b'site/src/app/page.tsx\nsite/public/private.xlsx\n'
   raise AssertionError('Unexpected command')
  with patch.object(coord.subprocess,'check_output',side_effect=git):
   self.l.observe('apoio',str(coord.ROOTS[1]),False);self.l.observe('apoio',str(coord.ROOTS[1]),False)
  event=self.l.history()[-1];self.assertFalse(event['requires_ack']);self.assertEqual(event['resources'],['code:site/src/app/page.tsx'])
  self.assertEqual([x['path'] for x in event['data']['tracked_changes']],['site/src/app/page.tsx'])
if __name__=='__main__':unittest.main()
