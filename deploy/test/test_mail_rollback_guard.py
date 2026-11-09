import os,pathlib,subprocess,tempfile,unittest
SOURCE=pathlib.Path(__file__).resolve().parents[1]
class RollbackGuardTests(unittest.TestCase):
 def scenario(self,active='inactive',pid='0',kill_mode='control-group',unsafe=False,symlink=False):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);root=pathlib.Path(temp.name);bin=root/'bin';bin.mkdir();sql=root/'mail.sql';sql.write_text('SELECT 1;');sql.chmod(0o644);marker=root/'psql-called'
  for name,body in {
   'id':'#!/bin/sh\necho 0\n',
   'runuser':'#!/bin/sh\nshift; shift; shift; exec "$@"\n',
   'systemctl':f'''#!/bin/sh
case "$*" in *LoadState*) echo loaded;; *KillMode*) echo {kill_mode};; *ActiveState*) echo {active};; *MainPID*) echo {pid};; *) exit 1;; esac
''',
   'psql':f'''#!/bin/sh
[ -z "${{PGPASSWORD:-}}" ] && [ -z "${{PGHOST:-}}" ] || exit 77
printf '%s\\n' "$*" > '{marker}'
exit 0
'''
  }.items():
   file=bin/name;file.write_text(body);file.chmod(0o755)
  if unsafe:sql.chmod(0o666)
  if symlink:
   target=root/'target.sql';sql.rename(target);sql.symlink_to(target)
  script=(SOURCE/'peticao-mail-rollback-guard.sh').read_text().replace('/usr/local/lib/peticao/publication.py',str(SOURCE/'publication.py')).replace('/usr/local/lib/peticao/mail-rollback.sql',str(sql)).replace('/run/lock/peticao-deploy.lock',str(root/'deploy.lock'))
  # Emulate root ownership with this fixture user's files; production source keeps strict uid=0 checks.
  script=script.replace('s.st_uid!=0 or parent.st_uid!=0',f's.st_uid!={os.getuid()} or parent.st_uid!={os.getuid()}').replace('PATH=/usr/bin:/bin',f'PATH={bin}:/usr/bin:/bin')
  executable=root/'guard.sh';executable.write_text(script)
  env={**os.environ,'PATH':str(bin)+':'+os.environ['PATH'],'PUBLICAR_TESTING':'1','PUBLICAR_DEPLOY_LOCK':str(root/'deploy.lock'),'PGPASSWORD':'fixture-must-not-pass','PGHOST':'fixture-must-not-pass'}
  env.pop('PETICAO_DEPLOY_LOCK_FD',None)
  result=subprocess.run(['bash',str(executable)],env=env,capture_output=True,timeout=10)
  return result,marker
 def test_stopped_consumers_use_fixed_database_without_inherited_credentials(self):
  result,marker=self.scenario();self.assertEqual(result.returncode,0,result.stderr.decode());args=marker.read_text();self.assertIn('-d peticao',args);self.assertIn('ON_ERROR_STOP=1',args)
 def test_active_or_activating_app_is_rejected_before_sql(self):
  for state in ['active','activating','deactivating']:
   result,marker=self.scenario(active=state);self.assertNotEqual(result.returncode,0);self.assertFalse(marker.exists())
 def test_live_pid_or_unsupported_kill_mode_is_rejected(self):
  for opts in [dict(pid='123'),dict(kill_mode='process')]:
   result,marker=self.scenario(**opts);self.assertNotEqual(result.returncode,0);self.assertFalse(marker.exists())
 def test_writable_or_symlinked_sql_is_rejected(self):
  for opts in [dict(unsafe=True),dict(symlink=True)]:
   result,marker=self.scenario(**opts);self.assertNotEqual(result.returncode,0);self.assertFalse(marker.exists())
if __name__=='__main__':unittest.main()
