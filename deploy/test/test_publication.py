import importlib.util, json, os, pathlib, tempfile, unittest
SOURCE=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publication',SOURCE/'publication.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class IdentityTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);(self.root/'package.json').write_text('{"name":"fixture"}')
 def tearDown(self):self.temp.cleanup()
 def test_source_and_public_assets_are_bound_but_runtime_and_secrets_are_not_read(self):
  for folder in ['public/data','src','data','secrets','node_modules']:(self.root/folder).mkdir(parents=True)
  (self.root/'public/data/map.json').write_text('original')
  first=p.fingerprint(self.root)['sha256']
  for file in ['data/local.sqlite','secrets/password','.env.local','.npmrc','node_modules/dependency']:(self.root/file).symlink_to('/definitely-not-readable')
  self.assertEqual(p.fingerprint(self.root)['sha256'],first)
  (self.root/'public/data/map.json').write_text('changed');self.assertNotEqual(p.fingerprint(self.root)['sha256'],first)
 def test_symlinks_and_special_files_fail_closed(self):
  (self.root/'source.ts').symlink_to('/etc/hostname')
  with self.assertRaises(ValueError):p.fingerprint(self.root)
  (self.root/'source.ts').unlink();os.mkfifo(self.root/'fifo')
  with self.assertRaises(ValueError):p.fingerprint(self.root)
 def test_order_is_stable_and_commit_is_metadata(self):
  (self.root/'z.ts').write_text('z');(self.root/'a.ts').write_text('a');(self.root/'VERSAO').write_text('a'*40)
  identity=p.fingerprint(self.root);self.assertEqual(identity['commit'],'a'*40)
  self.assertEqual(identity['sha256'],p.fingerprint(self.root)['sha256'])
  self.assertEqual([x[0] for x in identity['files']],sorted([x[0] for x in identity['files']]))
  (self.root/'a.ts').chmod(0o744);self.assertNotEqual(p.fingerprint(self.root)['sha256'],identity['sha256'])

class PublisherPipelineTests(unittest.TestCase):
 def scenario(self, mutation, inherited=False, bad_fd=False, health_fail=False, start_fail=False, fence_fail=False, timer_active=True, unresolved_backup=False):
  import pwd, subprocess
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);root=pathlib.Path(temp.name)
  home=root/'home';stage=home/'peticao-stage/site';stage.mkdir(parents=True)
  (stage/'package.json').write_text('{"name":"fixture"}');(stage/'src.ts').write_text('approved')
  opt=root/'opt';opt.mkdir();app=opt/'app';app.mkdir();(app/'previous.txt').write_text('preserve')
  if unresolved_backup:
   old=opt/'app.old';old.mkdir();(old/'recovery.txt').write_text('keep recovery')
  bin=root/'bin';bin.mkdir();envfile=root/'app.env';envfile.write_text('MAIL_PROVIDER=dev\n')
  owner=pwd.getpwuid(os.getuid()).pw_name
  events=root/'events';(root/'app-active').touch()
  if timer_active:(root/'timer-active').touch()
  guard=root/'rollback-guard.sh';guard.write_text('#!/bin/sh\necho fence >> "'+str(events)+'"\n[ ! -e "'+str(root/'app-active')+'" ] || exit 90\n[ ! -e "'+str(root/'timer-active')+'" ] || exit 91\nexit '+('1' if fence_fail else '0')+'\n');guard.chmod(0o755)
  scripts={
   'id':'#!/bin/sh\nif [ "$1" = -u ]; then echo 0; else exec /usr/bin/id "$@"; fi\n',
   'runuser':'#!/bin/sh\nshift; shift; shift; exec "$@"\n',
   'systemctl':'''#!/bin/sh
printf 'systemctl:%s\\n' "$*" >> "$FIXTURE_ROOT/events"
case "$1" in
 show) case "$*" in *LoadState*) echo loaded;; *KillMode*) echo control-group;; *MainPID*) echo 0;; *ActiveState*) [ -f "$FIXTURE_ROOT/app-active" ] && echo active || echo inactive;; esac ;;
 is-active) [ -f "$FIXTURE_ROOT/timer-active" ]; exit $? ;;
 stop) case "$2" in peticao) rm -f "$FIXTURE_ROOT/app-active";; peticao-agendador.timer) rm -f "$FIXTURE_ROOT/timer-active";; esac ;;
 start) if [ "$2" = peticao ]; then
         if [ -f "$FIXTURE_ROOT/opt/app/previous.txt" ]; then echo old-start >> "$FIXTURE_ROOT/events";
         else echo new-start >> "$FIXTURE_ROOT/events"; [ "$START_FAIL" != 1 ] || exit 1; fi
         touch "$FIXTURE_ROOT/app-active"
        elif [ "$2" = peticao-agendador.timer ]; then touch "$FIXTURE_ROOT/timer-active"; fi ;;
 *) echo active ;;
esac
exit 0
''',
   'curl':'''#!/bin/sh
case "$*" in *api/contador*) printf '{}';; *) if [ "$HEALTH_FAIL" = 1 ] && [ ! -f "$FIXTURE_ROOT/opt/app/previous.txt" ]; then printf 503; else printf 200; fi;; esac
''',
   'sleep':'#!/bin/sh\nexit 0\n',
   'npm':'''#!/bin/sh
case "$1" in
ci) mkdir -p node_modules/typescript ;;
run) if [ "$MUTATION" = stage ]; then printf changed > "$FIXTURE_STAGE/src.ts"; fi
     if [ "$MUTATION" = copy ]; then printf changed > src.ts; fi ;;
esac
exit 0
'''}
  for name,body in scripts.items():(bin/name).write_text(body);(bin/name).chmod(0o755)
  script=(SOURCE/'03-instalar-app.sh').read_text()
  script=script.replace('DEPLOY_USER=adunir; APP_USER=peticao',f'DEPLOY_USER={owner}; APP_USER={owner}')
  script=script.replace('/usr/local/lib/peticao/publication.py',str(SOURCE/'publication.py')).replace('/run/lock/peticao-deploy.lock',str(root/'deploy.lock'))
  script=script.replace('/usr/local/sbin/peticao-mail-rollback-guard',str(guard))
  script=script.replace('/opt/peticao',str(opt)).replace('/etc/peticao/app.env',str(envfile))
  start=script.index('HOME_DIR=');end=script.index('\n',start)
  script=script[:start]+f'HOME_DIR="{home}"; SRC="$HOME_DIR/peticao-stage/site"'+script[end:]
  script=script.replace('PATH=/usr/bin:/bin',f'PATH={bin}:/usr/bin:/bin')
  deployed=root/'publisher.sh';deployed.write_text(script)
  expected=p.fingerprint(stage)['sha256']
  env={**os.environ,'PUBLICAR_TESTING':'1','PATH':str(bin)+':'+os.environ['PATH'],'MUTATION':mutation,'FIXTURE_ROOT':str(root),'HEALTH_FAIL':'1' if health_fail else '0','START_FAIL':'1' if start_fail else '0','FIXTURE_STAGE':str(stage),'PUBLICAR_DEPLOY_LOCK':str(root/'deploy.lock'),'PETICAO_CANDIDATO_SHA256':expected}
  lock=None
  if inherited:
   import fcntl
   lock=open(root/('other.lock' if bad_fd else 'deploy.lock'),'a')
   fcntl.flock(lock,fcntl.LOCK_EX);env['PETICAO_DEPLOY_LOCK_FD']=str(lock.fileno())
  try: result=subprocess.run(['bash',str(deployed)],env=env,capture_output=True,timeout=15,pass_fds=(lock.fileno(),) if lock else ())
  finally:
   if lock:lock.close()
  return result,app
 def test_unresolved_backup_is_preserved_before_build_or_stop(self):
  result,app=self.scenario('none',unresolved_backup=True)
  self.assertNotEqual(result.returncode,0);self.assertEqual((app.parent/'app.old/recovery.txt').read_text(),'keep recovery')
  self.assertTrue((app/'previous.txt').exists());self.assertFalse((app.parent/'app.new').exists())
  self.assertFalse((app.parent.parent/'events').exists());self.assertTrue((app.parent.parent/'app-active').exists())
 def test_exact_candidate_is_swapped(self):
  result,app=self.scenario('none');self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual((app/'src.ts').read_text(),'approved')
 def test_stage_changed_while_building_never_replaces_running_app(self):
  result,app=self.scenario('stage');self.assertNotEqual(result.returncode,0);self.assertEqual((app/'previous.txt').read_text(),'preserve')
 def test_copied_source_changed_by_build_never_replaces_running_app(self):
  result,app=self.scenario('copy');self.assertNotEqual(result.returncode,0);self.assertEqual((app/'previous.txt').read_text(),'preserve')

 def test_root_job_can_keep_same_lock_during_backup_and_deploy(self):
  result,app=self.scenario('none',inherited=True);self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual((app/'src.ts').read_text(),'approved')
 def test_unrelated_inherited_fd_cannot_bypass_the_common_lock(self):
  result,app=self.scenario('none',inherited=True,bad_fd=True);self.assertNotEqual(result.returncode,0);self.assertEqual((app/'previous.txt').read_text(),'preserve')

 def test_failed_health_fences_mail_before_old_start_and_keeps_failed_candidate(self):
  result,app=self.scenario('none',health_fail=True);root=app.parent.parent
  self.assertNotEqual(result.returncode,0);self.assertEqual((app/'previous.txt').read_text(),'preserve')
  events=(root/'events').read_text().splitlines();self.assertLess(events.index('fence'),events.index('old-start'))
  self.assertTrue((root/'timer-active').exists());self.assertEqual(len(list(app.parent.glob('app.failed-*'))),1)
 def test_start_failure_uses_same_protected_rollback(self):
  result,app=self.scenario('none',start_fail=True);root=app.parent.parent
  self.assertNotEqual(result.returncode,0);self.assertTrue((app/'previous.txt').exists());self.assertIn('fence',(root/'events').read_text())
 def test_fence_failure_preserves_old_backup_and_never_starts_old_worker(self):
  result,app=self.scenario('none',health_fail=True,fence_fail=True);root=app.parent.parent
  self.assertNotEqual(result.returncode,0);self.assertTrue((app.parent/'app.old/previous.txt').exists())
  self.assertFalse((root/'app-active').exists());self.assertFalse((root/'timer-active').exists());self.assertNotIn('old-start',(root/'events').read_text())
 def test_inactive_scheduler_is_not_enabled_by_a_deploy(self):
  result,app=self.scenario('none',timer_active=False)
  self.assertEqual(result.returncode,0,result.stderr.decode());self.assertFalse((app.parent.parent/'timer-active').exists())

if __name__=='__main__':unittest.main()
