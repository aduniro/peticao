#!/usr/bin/python3
"""Offline export of a frozen build. Never starts the app, installs or deploys."""
import argparse, hashlib, io, json, os, pathlib, re, shutil, stat, tarfile
ROOT=pathlib.Path(__file__).resolve().parent
BUILD=pathlib.Path('/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt2/snapshot')
CACHE=pathlib.Path('/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt2/deps/site')
MARKERS=(b'BUILD_ONLY_PEPPER_NOT_PRODUCTION_0123456789',b'BuildOnly-NotAProductionPassword')
def canonical(x): return (json.dumps(x,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(data):return hashlib.sha256(data).hexdigest()
def safe(name):
 p=pathlib.PurePosixPath(name)
 if not name or p.is_absolute() or '..' in p.parts or str(p)!=name:raise ValueError('unsafe path: '+name)
 for s in p.parts:
  if s in {'.ssh','secrets','authorized_keys','sudoers','app.env','id_rsa','id_ed25519'} or s.startswith('.env') or pathlib.PurePosixPath(s).suffix.lower() in {'.key','.pem','.pfx','.p12'}:raise ValueError('sensitive path: '+name)
 return name

def package_inventory(site,cache):
 lock=json.loads((site/'package-lock.json').read_text()); installed=[]; skipped=[]
 for rel,d in sorted(lock['packages'].items()):
  if not rel or d.get('dev'):continue
  safe(rel); p=cache/rel
  if not p.exists():
   platforms=d.get('os',[]); cpus=d.get('cpu',[])
   incompatible=(platforms and 'linux' not in platforms) or (cpus and 'x64' not in cpus)
   if not d.get('optional') or not incompatible:raise ValueError('required production dependency missing: '+rel)
   skipped.append({'path':rel,'reason':'optional incompatible platform','os':platforms,'cpu':cpus});continue
  if not p.resolve().is_relative_to(cache.resolve()):raise ValueError('dependency escape')
  actual=json.loads((p/'package.json').read_text())
  if actual['version']!=d['version']:raise ValueError('dependency version mismatch: '+rel)
  installed.append({'path':rel,'version':actual['version']})
 return installed,skipped

def export(build,out):
 site=build/'site'
 evidence=pathlib.Path('/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt2/profile/runs/build-1')
 source=pathlib.Path('/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt2/inputs/source.tar.gz')
 if sha(source.read_bytes())!='19db95b7c0628dac9fbcec961adbdf3a01bfa00b1519f28a376427e80707a4d5':raise ValueError('source_archive_drift')
 tracked_count=0
 with tarfile.open(source) as bundle:
  for member in bundle:
   if member.isfile() and member.name.startswith('site/'):
    path=site/member.name.removeprefix('site/')
    if not path.is_file() or sha(path.read_bytes())!=sha(bundle.extractfile(member).read()):raise ValueError('tracked_source_drift:'+member.name)
    tracked_count+=1
 if (evidence/'source-before.sha256').read_bytes()!=(evidence/'source-after.sha256').read_bytes():raise ValueError('source_drift')
 guard=[json.loads(line) for line in (evidence/'guard.jsonl').read_text().splitlines()]
 if not guard or any(row['kind']=='denied' for row in guard):raise ValueError('build_network_denied')
 if not (site/'.next/BUILD_ID').is_file():raise ValueError('missing_build')
 result={'sourceCommit':'c472837fb5a4584d81f34c420f4de30989084f85'}
 installed,skipped=package_inventory(site,CACHE)
 files={}; origins={}
 def add(src,rel,allowed):
  safe(rel)
  real=src.resolve(strict=True)
  if not real.is_relative_to(allowed.resolve()):raise ValueError('source link escape: '+str(src))
  if not real.is_file():raise ValueError('nonregular input')
  data=real.read_bytes()
  if any(m in data for m in MARKERS):raise ValueError('build-only marker embedded: '+rel)
  if rel in files:raise ValueError('duplicate runtime destination: '+rel)
  files[rel]={'sha256':sha(data),'bytes':len(data)};origins[rel]=str(real)
 def tree(src,prefix,allowed,exclude=()):
  if not src.is_dir():raise ValueError('missing tree '+str(src))
  for dirpath,dirs,names in os.walk(src,followlinks=False):
   dp=pathlib.Path(dirpath); sub=dp.relative_to(src)
   dirs[:]=sorted(d for d in dirs if d not in exclude and not (dp/d).is_symlink())
   # Directory links require explicit treatment, never silently omit one.
   for candidate in dp.iterdir():
    if candidate.is_symlink() and candidate.is_dir():raise ValueError('directory symlink needs qualification: '+str(candidate))
   for n in sorted(names):
    if sub==pathlib.Path('.') and n in exclude:continue
    add(dp/n,str(pathlib.PurePosixPath(prefix)/sub/n),allowed)
 for name in ['package.json','package-lock.json','next.config.mjs']:add(site/name,name,site)
 tree(site/'.next','.next',site,exclude=('cache','types','trace'))
 for name in ['public','assets']:tree(site/name,name,site)
 for dep in installed:tree(CACHE/dep['path'],dep['path'],CACHE,exclude=('node_modules',))
 required=json.loads((site/'.next/required-server-files.json').read_text())['files']
 for rel in required:
  if rel not in files:raise ValueError('required Next server file omitted: '+rel)
 manifest={'schema_version':1,'release_id':'admin-query-r1-c472837-20261114','source_commit':result['sourceCommit'],'runtime_format':'next-start-v1','entrypoint':'node_modules/next/dist/bin/next','files':dict(sorted(files.items())),'migration_id':'20261113-ncpf-v1','migration_ack_sha256':None}
 if out.exists():raise ValueError('output already exists; preserve prior run')
 out.mkdir(mode=0o700,parents=True); runtime=out/'runtime';runtime.mkdir(mode=0o700)
 for rel,entry in manifest['files'].items():
  data=pathlib.Path(origins[rel]).read_bytes()
  if sha(data)!=entry['sha256']:raise ValueError('input drift during export')
  dest=runtime/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);dest.chmod(0o644)
 raw=canonical(manifest);(out/'release-manifest.json').write_bytes(raw)
 artifact=out/'runtime.tar'
 with tarfile.open(artifact,'w',format=tarfile.USTAR_FORMAT) as tf:
  for name,data in [('release-manifest.json',raw)]+[(f'runtime/{rel}',(runtime/rel).read_bytes()) for rel in manifest['files']]:
   ti=tarfile.TarInfo(name);ti.size=len(data);ti.mode=0o644;ti.uid=ti.gid=0;ti.mtime=0;tf.addfile(ti,io.BytesIO(data))
 report={'classification':'PORTABLE_RUNTIME_EXPORTED_NOT_SMOKED','operationalReady':False,'sourceCommit':result['sourceCommit'],'manifestSha256':sha(raw),'artifactSha256':sha(artifact.read_bytes()),'artifactBytes':artifact.stat().st_size,'runtimeFileCount':len(files),'runtimeBytes':sum(d['bytes'] for d in files.values()),'productionPackages':installed,'skippedOptional':skipped,'sourceArchiveSha256':sha(source.read_bytes()),'guardInstalledProcesses':len(guard),'networkDenials':0,'sourceStable':True,'trackedSourceFilesVerified':tracked_count,'buildOnlyMarkersEmbedded':False,'pending':['isolated HTTP/runtime smoke','actual SP native smoke','reviewed deployment manifest','production rollout'],'compiledBytesRewritten':False}
 (out/'export-report.json').write_bytes(canonical(report));verify(out)
 return report

def verify(out):
 raw=(out/'release-manifest.json').read_bytes();m=json.loads(raw);r=json.loads((out/'export-report.json').read_text())
 if sha(raw)!=r['manifestSha256'] or sha((out/'runtime.tar').read_bytes())!=r['artifactSha256']:raise ValueError('pin mismatch')
 expected={'release-manifest.json':{'sha256':sha(raw),'bytes':len(raw)}}|{'runtime/'+k:v for k,v in m['files'].items()}
 actual=set()
 for path in (out/'runtime').rglob('*'):
  if path.is_symlink():raise ValueError('materialized symlink')
  if path.is_file():actual.add(str(path.relative_to(out/'runtime')))
 if actual!=set(m['files']):raise ValueError('materialized inventory mismatch')
 seen=set()
 with tarfile.open(out/'runtime.tar','r:') as tf:
  for member in tf:
   safe(member.name)
   if not member.isfile() or member.name in seen or member.name not in expected:raise ValueError('invalid archive member')
   seen.add(member.name);data=tf.extractfile(member).read();e=expected[member.name]
   if len(data)!=e['bytes'] or sha(data)!=e['sha256']:raise ValueError('archive content mismatch')
 if seen!=set(expected):raise ValueError('missing archive members')
 for rel,d in m['files'].items():
  p=out/'runtime'/safe(rel)
  if p.is_symlink() or not p.is_file() or sha(p.read_bytes())!=d['sha256']:raise ValueError('materialized runtime mismatch')
 return {'verifiedFiles':len(seen),'operationalReady':False}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['export','verify']);p.add_argument('--out',type=pathlib.Path,default=ROOT/'export');a=p.parse_args()
 print(json.dumps(export(BUILD,a.out) if a.action=='export' else verify(a.out),indent=2))
