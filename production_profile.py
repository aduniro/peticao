#!/usr/bin/python3
"""Production-mode build profile. No build occurs without --execute-build."""
from pathlib import Path
import argparse,base64,datetime,fcntl,hashlib,json,os,platform,re,signal,subprocess,time

ROOT=Path(__file__).resolve().parent
SOURCE=Path('/mnt/apps/peticao-final/_ops/drafts/materials-preview-api-20261111')
COMMIT='140ce6b98af23045849335693a82b426fdc9c826'
NODE=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node')
NODE_SHA='b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac'
DEPS=Path('/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules')
ASSET_CACHE=Path('/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/pdfjs-preview-runtime')
TARGET=Path('/mnt/apps/peticao-final/_ops/controle-operacional/evidence/sp-runtime-target-ro-20261110.json')
DB_URL='postgres://build_only:build_only@127.0.0.1:1/build_only'
FAKE_PEPPER='BUILD_ONLY_PEPPER_NOT_PRODUCTION_0123456789'
FAKE_PASSWORD='BuildOnly-NotAProductionPassword'
ENV_KEYS={'PATH','HOME','LANG','NODE_ENV','APP_URL','DATABASE_URL','HASH_PEPPER','ADMIN_PASSWORD','ADMIN_PASSWORD_FILE','SECRETS_DIR','PETICAO_CONFIG_DIR','CREDENTIALS_DIRECTORY','GEO_DIR','MAIL_PROVIDER','MAIL_PROVIDERS','MAIL_PROVIDERS_MARKETING','MAIL_FROM','CONTACT_TO','CONTACT_BCC','RECIPIENTS','APPROVER_EMAIL','CRON_SECRET','WHATSAPP_ENABLED','SIGNER','NEXT_TELEMETRY_DISABLED','CI','TMPDIR','PRODUCTION_PROFILE_ROOT','PRODUCTION_PROFILE_RUN','NODE_OPTIONS'}

def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb')as f:
  for block in iter(lambda:f.read(2**20),b''):h.update(block)
 return h.hexdigest()

def git(*args):return subprocess.check_output(['/usr/bin/git','-C',str(SOURCE),*args],text=True).strip()
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')

def new_run(prefix):
 run=ROOT/'runs'/(prefix+'-'+str(time.time_ns()));run.mkdir(mode=0o700)
 for n in ['empty','tmp']:(run/n).mkdir(mode=0o700)
 return run

def environment(run):
 if not run.is_absolute()or run.resolve()!=run or not run.is_relative_to(ROOT/'runs'):raise ValueError('unsafe_run')
 empty=str(run/'empty')
 env={'PATH':str(NODE.parent)+':/usr/bin:/bin','HOME':empty,'LANG':'C.UTF-8','NODE_ENV':'production','APP_URL':'https://sancionaintegral.org','DATABASE_URL':DB_URL,'HASH_PEPPER':FAKE_PEPPER,'ADMIN_PASSWORD':FAKE_PASSWORD,'ADMIN_PASSWORD_FILE':empty+'/admin-password-never-present.hash','SECRETS_DIR':empty,'PETICAO_CONFIG_DIR':empty,'CREDENTIALS_DIRECTORY':empty,'GEO_DIR':empty,'MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','MAIL_PROVIDERS_MARKETING':'','MAIL_FROM':'Build only <noreply@build.invalid>','CONTACT_TO':'noreply@build.invalid','CONTACT_BCC':'','RECIPIENTS':'','APPROVER_EMAIL':'','CRON_SECRET':'','WHATSAPP_ENABLED':'0','SIGNER':'none','NEXT_TELEMETRY_DISABLED':'1','CI':'1','TMPDIR':str(run/'tmp'),'PRODUCTION_PROFILE_ROOT':str(ROOT),'PRODUCTION_PROFILE_RUN':str(run),'NODE_OPTIONS':'--max-old-space-size=3072 --import='+str(ROOT/'production-build-guard.mjs')}
 validate_environment(env,run);return env

def validate_environment(env,run):
 if set(env)!=ENV_KEYS:raise ValueError('environment_not_allowlisted')
 if env['NODE_ENV']!='production'or 'PREVIEW_MODE'in env or 'ADMIN_NO_PASSWORD'in env:raise ValueError('not_production_profile')
 if env['DATABASE_URL']!=DB_URL or env['MAIL_PROVIDER']!='dev'or env['MAIL_PROVIDERS']!='dev':raise ValueError('unsafe_delivery_or_database')
 if env['HASH_PEPPER']!=FAKE_PEPPER or env['ADMIN_PASSWORD']!=FAKE_PASSWORD:raise ValueError('nonfixture_secrets')
 if env['CRON_SECRET']or env['RECIPIENTS']or env['APPROVER_EMAIL']or env['WHATSAPP_ENABLED']!='0':raise ValueError('background_flow_enabled')
 fixed={'APP_URL':'https://sancionaintegral.org','PATH':str(NODE.parent)+':/usr/bin:/bin','PRODUCTION_PROFILE_ROOT':str(ROOT),'PRODUCTION_PROFILE_RUN':str(run),'TMPDIR':str(run/'tmp'),'NODE_OPTIONS':'--max-old-space-size=3072 --import='+str(ROOT/'production-build-guard.mjs'),'MAIL_PROVIDERS_MARKETING':'','MAIL_FROM':'Build only <noreply@build.invalid>','CONTACT_TO':'noreply@build.invalid','CONTACT_BCC':'','NEXT_TELEMETRY_DISABLED':'1','CI':'1','SIGNER':'none','LANG':'C.UTF-8'}
 if any(env[k]!=v for k,v in fixed.items()):raise ValueError('profile_value_changed')
 for key in ['HOME','SECRETS_DIR','PETICAO_CONFIG_DIR','CREDENTIALS_DIRECTORY','GEO_DIR']:
  if env[key]!=str(run/'empty'):raise ValueError('external_credential_path')
 if env['ADMIN_PASSWORD_FILE']!=str(run/'empty/admin-password-never-present.hash'):raise ValueError('external_admin_password_path')
 for n in ['empty','tmp']:
  p=run/n
  if p.resolve()!=p or not p.is_dir()or p.stat().st_uid!=os.getuid():raise ValueError('unsafe_private_directory')
 if list((run/'empty').iterdir()):raise ValueError('credential_directory_not_empty')

def no_dotenv(site):
 for n in ['.env','.env.local','.env.production','.env.production.local']:
  p=site/n
  if p.exists()or p.is_symlink():raise ValueError('dotenv_forbidden:'+n)

def preflight():
 verify_profile_pins()
 verify_dependency_cache()
 if __import__('shutil').disk_usage(ROOT).free<4*1024**3:raise ValueError('minimum_4GiB_free_required')
 if git('rev-parse','HEAD')!=COMMIT or git('status','--porcelain'):raise ValueError('source_not_clean_pinned_commit')
 if sha(NODE)!=NODE_SHA:raise ValueError('node_binary_changed')
 node=json.loads(subprocess.check_output([str(NODE),'-p','JSON.stringify({version:process.versions.node,modules:process.versions.modules,napi:process.versions.napi,arch:process.arch,platform:process.platform})'],env={'PATH':str(NODE.parent)+':/usr/bin:/bin'},text=True))
 target=json.loads(TARGET.read_text())
 if target['os']!='Debian GNU/Linux 13.7 trixie'or target['arch']!='x86_64'or target['libc']!={'name':'glibc','version':'2.41'}:raise ValueError('target_OS_requires_review')
 for k in ['version','modules','napi','arch','platform']:
  if node[k]!=target['node'][k]:raise ValueError('node_target_mismatch:'+k)
 no_dotenv(SOURCE/'site')
 package=json.loads((DEPS/'next/package.json').read_text())
 if package['version']!='14.2.35':raise ValueError('next_version_mismatch')
 lock=json.loads((SOURCE/'site/scripts/pdfjs-assets.lock.json').read_text())
 archive=ASSET_CACHE/'package.tgz'
 if not archive.is_file()or archive.is_symlink()or archive.stat().st_size!=lock['archiveSize']:raise ValueError('offline_asset_archive_missing')
 algorithm,expected=lock['archiveIntegrity'].split('-',1)
 if algorithm!='sha512'or base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()!=expected:raise ValueError('offline_asset_archive_integrity')
 routes=list((SOURCE/'site/src/app').rglob('route.ts'));unsafe_get=[]
 for f in routes:
  text=f.read_text()
  if re.search(r'export\s+(?:async\s+)?function\s+GET\b|export\s+(?:const|let)\s+GET\s*=',text)and not re.search(r'export\s+const\s+dynamic\s*=\s*[\"\x27]force-dynamic',text):unsafe_get.append(str(f))
 if unsafe_get:raise ValueError('GET_static_policy_requires_review')
 layout=(SOURCE/'site/src/app/layout.tsx').read_text()
 if not re.search(r'export\s+const\s+dynamic\s*=\s*[\"\x27]force-dynamic',layout):raise ValueError('root_layout_not_dynamic')
 return {'sourceCommit':COMMIT,'sourceClean':True,'node':node,'nodeSha256':NODE_SHA,'nextVersion':package['version'],'targetEvidence':str(TARGET),'targetEvidenceSha256':sha(TARGET),'targetOs':target['os'],'targetLibc':target['libc'],'buildHost':{'os':platform.platform(),'libc':platform.libc_ver()},'postgresRequiredInitially':False,'GETRoutesWithoutExplicitDynamic':unsafe_get,'offlinePdfjsCachePresent':True,'assetArchiveIntegrityVerified':True,'assetArchiveBytes':archive.stat().st_size,'realArtifactCreated':False,'operationalReady':False}

def resource_limits():
 # Read actual cgroup v2 hierarchy; do not trust an env assertion about limits.
 lines=Path('/proc/self/cgroup').read_text().splitlines();rel=next((x[3:]for x in lines if x.startswith('0::')),None)
 if rel is None:raise ValueError('cgroup_v2_limits_unavailable')
 root=Path('/sys/fs/cgroup');current=(root/rel.lstrip('/')).resolve()
 if not current.is_relative_to(root):raise ValueError('unsafe_cgroup_path')
 if current.name!='peticao-materials-production-build-20261111.service':raise ValueError('exact_retained_build_unit_required')
 memory=[];cpu=[]
 for p in [current,*current.parents]:
  if not p.is_relative_to(root):break
  m=p/'memory.max';q=p/'cpu.max'
  if m.is_file():
   value=m.read_text().strip()
   if value!='max':memory.append(int(value))
  if q.is_file():
   quota,period=q.read_text().split()
   if quota!='max':cpu.append(int(quota)/int(period))
 if not memory or min(memory)>5*1024**3 or not cpu or min(cpu)>3:raise ValueError('external_3cpu_5GiB_cgroup_required')
 return {'memoryMaxBytes':min(memory),'cpuQuotaCores':min(cpu),'heapMiBPerNode':3072,'timeoutSeconds':900,'parallelBuilds':1,'cgroup':str(current)}

def dry_config():
 info=preflight();run=new_run('dry-config');env=environment(run)
 command=[str(NODE),str(ROOT/'dry-config.mjs')]
 with(run/'dry-config.log').open('w')as log:r=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=30)
 records=[json.loads(x)for x in(run/'guard.jsonl').read_text().splitlines()]
 result={'classification':'DRY_CONFIG_ONLY_NO_BUILD','exit':r.returncode,'sourceCommit':COMMIT,'node':info['node'],'guardInstalled':any(x['kind']=='installed'for x in records),'networkDenials':sum(x['kind']=='denied'for x in records),'noPreview':True,'noService':True,'postgresStarted':False,'realArtifactCreated':False,'run':str(run)}
 save(run/'result.json',result)
 if r.returncode or not result['guardInstalled']or result['networkDenials']:raise ValueError('dry_config_failed:'+str(run))
 return result

def source_manifest(root):
 pins=json.loads((ROOT/'source-manifest.json').read_text())['files']
 return {p:sha(root/p)for p in pins}

def profile_manifest():
 m=json.loads((ROOT/'manifest.json').read_text())
 return {str(ROOT/n):sha(ROOT/n)for n in m['files']}

def verify_profile_pins():
 m=json.loads((ROOT/'manifest.json').read_text())
 for n,pin in m['files'].items():
  f=ROOT/n
  if f.is_symlink()or not f.is_file()or sha(f)!=pin:raise ValueError('profile_pin_drift:'+n)
 return True

def verify_dependency_cache():
 m=json.loads((ROOT/'dependency-cache-manifest.json').read_text());root=Path(m['root']);actual={}
 if root!=DEPS or root.is_symlink():raise ValueError('dependency_root_drift')
 for base,dirs,files in os.walk(root,followlinks=False):
  for name in list(dirs)+files:
   f=Path(base)/name;rel=str(f.relative_to(root))
   if f.is_symlink():
    if not f.resolve(strict=True).is_relative_to(root.resolve()):raise ValueError('dependency_link_escape')
    actual[rel]={'link':os.readlink(f)}
   elif f.is_file():actual[rel]={'bytes':f.stat().st_size,'sha256':sha(f)}
   elif not f.is_dir():raise ValueError('dependency_special_file')
 if actual!=m['entries']:raise ValueError('dependency_cache_bytes_changed')
 return True

def stage_exact_source(clone):
 pins=json.loads((ROOT/'source-manifest.json').read_text())
 if pins['commit']!=COMMIT:raise ValueError('source_pin_commit')
 clone.mkdir(mode=0o700)
 for name,pin in pins['files'].items():
  rel=Path(name)
  if rel.is_absolute()or '..'in rel.parts or any(x.startswith('.env')or x in {'secrets','preview-state','node_modules','.next','.cache'}for x in rel.parts):raise ValueError('unsafe_source_member')
  if pin['mode']not in {'100644','100755'}:raise ValueError('source_special_member')
  data=subprocess.check_output(['/usr/bin/git','-C',str(SOURCE),'show',COMMIT+':'+name])
  if len(data)!=pin['bytes']or hashlib.sha256(data).hexdigest()!=pin['sha256']:raise ValueError('source_object_drift')
  target=clone/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);target.chmod(0o700 if pin['mode']=='100755'else 0o600)
 return clone

def process_group_members(pgid):
 members=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   # comm may itself contain spaces or parentheses; fields after the final ')'
   # start with state, ppid and process-group id.
   tail=(p/'stat').read_text().rsplit(')',1)[1].split()
   if int(tail[2])==pgid and tail[0]!='Z':members.append({'pid':int(p.name),'comm':(p/'comm').read_text().strip(),'state':tail[0]})
  except (OSError,ValueError,IndexError):continue
 return members

def assert_no_live_build_group(runs):
 # A daemon/terminal restart may release the runner lock while Next children
 # remain alive in its recorded process group. Do not create a second run.
 for record in runs.glob('build-*/pid.json'):
  d=json.loads(record.read_text());pgid=d.get('pgid')
  if type(pgid)is not int or pgid<=1:raise ValueError('invalid_prior_build_identity:'+str(record))
  if process_group_members(pgid):raise ValueError('prior_build_group_still_live:'+str(record))

def execute_build():
 cfg=json.loads((ROOT/'config.json').read_text())
 if cfg.get('infra_reviewed')is not True:raise ValueError('preparation_only_independent_activation_required')
 info=preflight();limits=resource_limits()
 marker=ROOT/'execution.started'
 fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
 lock=(ROOT/'build.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert_no_live_build_group(ROOT/'runs')
 run=new_run('build');env=environment(run);clone=run/'clone';profile_before=profile_manifest();target_before=sha(TARGET)
 stage_exact_source(clone)
 site=clone/'site';no_dotenv(site);(site/'node_modules').symlink_to(DEPS,target_is_directory=True)
 before=source_manifest(SOURCE)
 if before!=source_manifest(clone):raise ValueError('clone_source_mismatch')
 prepare=[str(NODE),str(site/'scripts/prepare-pdfjs-assets.mjs'),'--offline','--cache-dir',str(ASSET_CACHE)]
 with(run/'assets-prepare.log').open('w')as out:subprocess.run(prepare,cwd=site,env=env,stdout=out,stderr=subprocess.STDOUT,check=True,timeout=120)
 sys_path=clone/'tools/admin-qa'
 import sys
 sys.path.insert(0,str(sys_path));from pdfjs_runtime import runtime_manifest
 assets=runtime_manifest(clone,required=True)
 if len(assets)!=202:raise ValueError('asset_closure_mismatch')
 command=[str(NODE),str(DEPS/'next/dist/bin/next'),'build']
 save(run/'profile.json',{'classification':'PRODUCTION_MODE_BUILD_ISOLATED_NOT_DEPLOY_QUALIFIED','command':command,'prepare':prepare,'cwd':str(site),'env':env,'sourceCommit':COMMIT,'limits':limits,'target':info,'dependencyCachePortable':False})
 save(run/'source-manifest.json',before);save(run/'runtime-assets-manifest.json',assets);save(run/'profile-source-manifest.json',profile_before)
 with(run/'build.log').open('w')as log:
  proc=subprocess.Popen(command,cwd=site,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  save(run/'pid.json',{'pid':proc.pid,'pgid':proc.pid,'command':command})
  cancelled={'signals':0,'cleaning':False}
  def interrupt(signum,frame):
   cancelled['signals']+=1
   if not cancelled['cleaning']:raise InterruptedError('build_cancelled')
  old_handlers={sig:signal.signal(sig,interrupt)for sig in [signal.SIGTERM,signal.SIGINT]}
  try:code=proc.wait(timeout=900)
  except BaseException:
   code=124 if cancelled['signals']==0 else 130
  finally:
   cancelled['cleaning']=True
   if process_group_members(proc.pid):
    os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
     os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=10)
   for sig,handler in old_handlers.items():signal.signal(sig,handler)
   if cancelled['signals']:code=130
 records=[json.loads(x)for x in(run/'guard.jsonl').read_text().splitlines()]
 embedded=[]
 for p in(site/'.next').rglob('*'):
  if p.is_file()and p.suffix in ['.js','.html','.json']:
   data=p.read_bytes()
   if FAKE_PEPPER.encode()in data or FAKE_PASSWORD.encode()in data:embedded.append(str(p.relative_to(site)))
 remaining=process_group_members(proc.pid)
 dependencies_stable=verify_dependency_cache()
 result={'classification':'PRODUCTION_MODE_BUILD_ISOLATED_NOT_DEPLOY_QUALIFIED','exit':code,'run':str(run),'sourceCommit':COMMIT,'sourceStable':before==source_manifest(SOURCE),'cloneSourceStable':before==source_manifest(clone),'sourceClean':not git('status','--porcelain'),'sourceHeadStable':git('rev-parse','HEAD')==COMMIT,'profileStable':profile_before==profile_manifest(),'targetEvidenceStable':target_before==sha(TARGET),'guardInstalled':any(x['kind']=='installed'for x in records),'networkDenials':sum(x['kind']=='denied'for x in records),'assetsStable':assets==runtime_manifest(clone,required=True),'remainingBuildProcesses':remaining,'processGroupDrained':not remaining,'fakeSecretsEmbedded':embedded,'noPreview':True,'postgresStarted':False,'listenerStarted':False,'operationalReady':False,'dependencyCachePortable':False,'dependencyCacheStable':dependencies_stable,'limits':limits}
 save(run/'result.json',result)
 if code or not all(result[k]for k in ['sourceStable','cloneSourceStable','sourceClean','sourceHeadStable','profileStable','targetEvidenceStable','guardInstalled','assetsStable','processGroupDrained'])or result['networkDenials']or embedded:raise ValueError('production_build_failed:'+str(run))
 return result

def plan():
 return {'classification':'PRODUCTION_PROFILE_PREPARED_BUILD_NOT_STARTED','source':str(SOURCE),'sourceCommit':COMMIT,'command':[str(NODE),str(DEPS/'next/dist/bin/next'),'build'],'prepareCommandPolicy':'offline pinned PDFjs archive into private clone only','environmentKeys':sorted(ENV_KEYS),'forbidden':['PREVIEW_MODE','ADMIN_NO_PASSWORD','external credentials','real database','provider tokens','implicit .env loading'],'limits':{'cpuCores':3,'memoryBytes':5*1024**3,'heapMiBPerNode':3072,'timeoutSeconds':900,'mustBeEnforcedByCgroup':True},'postgresInitially':False,'targetEvidence':str(TARGET),'operationalReady':False,'executionCommand':['/usr/bin/systemd-run','--user','--unit=peticao-materials-production-build-20261111.service','-pRemainAfterExit=yes','-pMemoryMax=5G','-pCPUQuota=300%','-pTasksMax=256','-pRuntimeMaxSec=930','-pTimeoutStopSec=120','-pKillMode=control-group','/usr/bin/python3',str(ROOT/'production_profile.py'),'--execute-build']}

if __name__=='__main__':
 os.umask(0o077)
 parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group()
 for option in ['plan','preflight','dry-config','execute-build']:group.add_argument('--'+option,action='store_true')
 args=parser.parse_args()
 result=execute_build()if args.execute_build else dry_config()if args.dry_config else preflight()if args.preflight else plan()
 print(json.dumps(result,ensure_ascii=False,indent=2))
