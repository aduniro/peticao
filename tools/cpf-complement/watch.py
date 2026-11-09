#!/usr/bin/env python3
"""Download verified final files and notify this computer; no messages to third parties."""
import hashlib,json,os,sqlite3,subprocess,sys,tarfile,time
from pathlib import Path
os.umask(0o077)
state=json.loads(Path('/mnt/apps/peticao-final/peticao/.cache/cpf-complement-state.json').read_text())
local=Path('/mnt/apps/peticao-final/cpfs')/state['id'];local.mkdir(mode=0o700,exist_ok=True)
done=local/'download-concluido.json'
if done.exists():sys.exit(0)
while True:
 try:
  p=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','peticao-root','cat '+state['remote']+'/estado-geral.json'],capture_output=True,text=True,timeout=20)
  if p.returncode:raise RuntimeError('Status unavailable')
  report=json.loads(p.stdout)
  (local/'progresso.json').write_text(json.dumps(report,indent=2))
  if report.get('phase') in ('complete','partial','partial_recovery_stopped','pausado_erro_provedor'):
   active=subprocess.run(['ssh','-o','BatchMode=yes','peticao-root','systemctl is-active --quiet '+state['query_unit']],capture_output=True,timeout=20)
   if active.returncode==0:raise RuntimeError('Worker finalizing')
   final=subprocess.run(['ssh','-o','BatchMode=yes','peticao-root','python3 '+state['remote']+'/finalize.py '+state['remote']],capture_output=True,timeout=180)
   if final.returncode:raise RuntimeError('Final package unavailable')
   archive=local/'resultado-completo.tar.gz'
   q=subprocess.run(['scp','-q','-o','BatchMode=yes','peticao-root:'+state['remote']+'/resultado-completo.tar.gz',str(archive)+'.tmp'],capture_output=True,timeout=180)
   if q.returncode:raise RuntimeError('Package not ready')
   Path(str(archive)+'.tmp').replace(archive)
   target=local/('resultados-'+str(time.time_ns()));target.mkdir(mode=0o700)
   with tarfile.open(archive) as t:t.extractall(target,filter='data')
   for entry in json.loads((target/'manifest.json').read_text()):
    path=(target/entry['file']).resolve()
    if not path.is_relative_to(target.resolve()):raise RuntimeError('Unsafe path')
    with path.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    if digest!=entry['sha256']:raise RuntimeError('Checksum mismatch')
    path.chmod(0o600)
    if path.suffix=='.sqlite':
     with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
      if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('SQLite mismatch')
   if json.loads((target/'estado-geral.json').read_text())['phase']!=report['phase']:raise RuntimeError('Stale package')
   done.write_text(json.dumps({'status':report,'directory':str(target)},indent=2))
   subprocess.run(['/usr/bin/python3','/mnt/apps/peticao-final/peticao/tools/cpf-review/sync.py'],capture_output=True,timeout=240)
   subprocess.run(['notify-send','Petição — consultas de CPF','Execução '+report['phase']+'. Arquivos conferidos e baixados em '+str(target)],capture_output=True)
   print('DOWNLOAD_CONFERIDO',str(target),flush=True);break
 except Exception as e:
  print('Aguardando resultados:',type(e).__name__,flush=True)
 time.sleep(30)
