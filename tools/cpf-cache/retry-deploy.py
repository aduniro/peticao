#!/usr/bin/env python3
import datetime,hashlib,json,subprocess,sys,urllib.request
from pathlib import Path
root=Path(sys.argv[1]);app=Path('/opt/peticao/app');stage=Path('/home/adunir/peticao-stage/site');backup=root/'backup';bundle=root/'cpf-cache-candidato.tar.gz'
def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def psql(sql):
 p=subprocess.run(['runuser','-u','postgres','--','psql','-X','-qAt','-d','peticao','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,check=True)
 return p.stdout.strip()
status={}
def phase(name,**values):
 status.update(phase=name,at=datetime.datetime.now(datetime.timezone.utc).isoformat(),**values)
 (root/'status.json').write_text(json.dumps(status,indent=2));print(name,flush=True)
def main():
    manifest=json.loads((root/'package/patch-manifest.json').read_text())
    for entry in manifest:
        rel=Path(entry['file']).relative_to('site');target=app/rel
        actual=sha(target) if target.is_file() else None
        if actual!=entry['before_sha256'] or sha(stage/rel)!=entry['after_sha256']:
            raise RuntimeError('Source changed before deployment retry')
    phase('ownership_verified_rebuilding')
    with (root/'deploy-retry.log').open('w') as log:
        result=subprocess.run(['/usr/local/sbin/peticao-deploy'],stdout=log,stderr=subprocess.STDOUT)
    if result.returncode:raise RuntimeError('Deployment retry failed')
    phase('verification')
    for entry in manifest:
        if sha(app/Path(entry['file']).relative_to('site')) != entry['after_sha256']:
            raise RuntimeError('Deployed source mismatch')
    # Public text/UI stayed byte-for-byte equal to the preserved installation.
    ui_count = 0
    for old in (backup/'app').rglob('*'):
        if not old.is_file() or 'node_modules' in old.parts or '.next' in old.parts:
            continue
        rel = old.relative_to(backup/'app')
        if old.suffix in {'.tsx','.css'} or str(rel).startswith('src/i18n/') or str(rel)=='README.md':
            if not (app/rel).is_file() or sha(old)!=sha(app/rel):
                raise RuntimeError('Public UI changed unexpectedly')
            ui_count += 1
    http = {}
    for path in ('/','/api/contador','/privacidade','/confirmar'):
        with urllib.request.urlopen('http://127.0.0.1:3000'+path,timeout=30) as response:
            http[path] = response.status
    aggregate = json.loads(psql("""BEGIN READ ONLY;
      SELECT json_build_object('cache_total',(SELECT count(*) FROM cpf_lookup_cache),
        'active',(SELECT count(*) FROM cpf_lookup_cache WHERE expires_at>now()),
        'invalid_lifetime',(SELECT count(*) FROM cpf_lookup_cache WHERE expires_at-fetched_at>interval '30 days'),
        'confirmed_with_cache',(SELECT count(*) FROM signatures s JOIN cpf_lookup_cache c USING(cpf_hash) WHERE s.status='confirmed'),
        'pending_with_cache',(SELECT count(*) FROM signatures s JOIN cpf_lookup_cache c USING(cpf_hash) WHERE s.status='pending'));
      COMMIT;"""))
    phase('complete',http=http,public_files_unchanged=ui_count,**aggregate)
    (root/'backup-manifest.json').write_text(json.dumps({
        'database_sha256':sha(backup/'producao.dump'),'package_sha256':sha(bundle),
        'secret_backups_remain_on_vps':True,'backup':str(backup)},indent=2))
try:
 main()
except Exception:
 phase('retry_failed');sys.exit(1)
