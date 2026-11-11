#!/usr/bin/python3
"""Local-only adaptation of infra/send_source.py; preserves complete app identity."""
from pathlib import Path,PurePosixPath
import subprocess,json,hashlib,tarfile,io,base64,uuid,re,datetime
ROOT=Path(__file__).resolve().parent/'artifacts/source'
REPO=Path('/mnt/apps/peticao-final/_ops/r0003-govbr-http-gates-20261110')
COMMIT='93557bfba931f8f731807fc9f30f1d88dbafedf1'
BASELINE=Path('/mnt/apps/peticao-final/_ops/admin-v2-executors/releases/source-4eb9349079fb7e89dd3faee58e78300d7308ada4-app-complete/source-manifest.json')
INFRA=Path('/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110')
APP=('site/','deploy/','tools/signing/','tools/admin-qa/')
def sha(data):return hashlib.sha256(data).hexdigest()
def git(*args):return subprocess.check_output(['/usr/bin/git','-C',str(REPO),*args])
def safe(name):
 p=PurePosixPath(name)
 if p.is_absolute() or '..' in p.parts or str(p)!=name or not name:raise ValueError('unsafe archive path')
 for part in p.parts:
  if part in {'.git','node_modules','.next','.next-dev','secrets','preview-state','.pgdata','pgdata'} or part.startswith('.env') or part.endswith(('.pfx','.p12','.key','.pem','.dump','.sqlite','.sqlite3','.db')):raise ValueError('runtime/secret path in tracked export: '+name)
 return name

def identity(data):return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def validate_file_map(tree,included,excluded):
 if set(included)!=set(tree)-set(excluded):raise ValueError('snapshot omitted or added tracked files')
 if any(p.startswith(APP) for p in excluded):raise ValueError('application file exclusion forbidden')
 for name,data in included.items():
  safe(name)
  if identity(data)!=tree[name]['oid']:raise ValueError('Git blob identity mismatch: '+name)
 return {name:{'sha256':sha(data),'bytes':len(data),'git_blob':tree[name]['oid'],'mode':tree[name]['mode']} for name,data in sorted(included.items())}

def export():
 if (ROOT/'source.tar').exists():raise ValueError('preserve previous snapshot')
 git('cat-file','-e',COMMIT+'^{commit}')
 head=git('rev-parse','HEAD').decode().strip();tree={}
 for row in git('ls-tree','-r','-z',COMMIT).split(b'\0'):
  if not row:continue
  info,name=row.split(b'\t',1);mode,kind,oid=info.decode().split();name=name.decode()
  if kind!='blob' or mode not in ['100644','100755']:raise ValueError('link/submodule/special Git entry: '+name)
  tree[name]={'mode':mode,'oid':oid}
 old=json.loads(BASELINE.read_text());excluded={x['path']:dict(x) for x in old['excluded'] if x['path'] in tree}
 if len(excluded)!=21:raise ValueError('review changed non-app exclusion catalog before export')
 archive=git('archive','--format=tar',COMMIT);included={};all_seen=set()
 with tarfile.open(fileobj=io.BytesIO(archive),mode='r:') as tf:
  for item in tf:
   if item.isdir():continue
   if not item.isfile() or item.name in all_seen:raise ValueError('link/special/duplicate Git archive member')
   all_seen.add(item.name)
   if item.name not in tree:raise ValueError('unexpected Git archive entry')
   if item.name not in excluded:included[item.name]=tf.extractfile(item).read()
 if all_seen!=set(tree):raise ValueError('git archive export-ignore omitted Git blobs')
 files=validate_file_map(tree,included,excluded)
 # Only high-confidence credential payloads. Generic variable names or test strings are not secrets.
 patterns={'private_key_material':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}-----END','aws_access_key':rb'AKIA[0-9A-Z]{16}','openai_realistic_key':rb'\bsk-proj-[A-Za-z0-9_-]{60,}'}
 matches=[{'path':name,'kind':label} for name,data in included.items() for label,pattern in patterns.items() if re.search(pattern,data)]
 if matches:raise ValueError('credential scan needs review: '+json.dumps(matches))
 out=ROOT/'source.tar'
 with tarfile.open(out,'w',format=tarfile.USTAR_FORMAT) as tf:
  for name,data in sorted(included.items()):
   item=tarfile.TarInfo(name);item.size=len(data);item.mode=0o755 if tree[name]['mode']=='100755' else 0o644;item.mtime=0;tf.addfile(item,io.BytesIO(data))
 raw=out.read_bytes()
 if len(raw)>=64*1024**2:raise ValueError('snapshot must be below 64MiB')
 app_files={name:entry for name,entry in files.items() if name.startswith(APP)}
 expected_app={name for name in tree if name.startswith(APP)}
 if set(app_files)!=expected_app:raise ValueError('all-app-files gate failed')
 for name in excluded:excluded[name]['current_git_object']=tree[name]['oid']
 manifest={'schema_version':1,'classification':'R0003_FROZEN_SOURCE_NOT_EXECUTED','commit':COMMIT,'observedHeadAtPreparation':head,'origin':str(REPO),'archive':str(out),'archive_sha256':sha(raw),'archive_bytes':len(raw),'tracked_tree_entries':len(tree),'included_files':len(files),'excluded_files':len(excluded),'excluded':list(excluded.values()),'full_application_sources':True,'app_build_scope':list(APP),'application_files':len(app_files),'app_build_sources':app_files,'app_build_sources_sha256':sha(json.dumps(app_files,sort_keys=True,separators=(',',':')).encode()),'files':files,'not_full_git_tree':True,'history_included':False,'symlinks_followed':0,'high_confidence_secret_scan_matches':matches,'secret_scan_not_proof_of_absence':True,'sent':False,'typecheckExecuted':False,'reuse':{'sendSource':str(INFRA/'infra/send_source.py'),'sendSourceSha256':sha((INFRA/'infra/send_source.py').read_bytes()),'handoff':str(INFRA/'APP-QA-HANDOFF-20261110.md'),'handoffSha256':sha((INFRA/'APP-QA-HANDOFF-20261110.md').read_bytes())}}
 (ROOT/'source-manifest.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
 print(json.dumps({'commit':COMMIT,'archiveSha256':sha(raw),'archiveBytes':len(raw),'files':len(files),'applicationFiles':len(app_files),'excludedNonApp':len(excluded),'executed':False},indent=2))
if __name__=='__main__':export()
