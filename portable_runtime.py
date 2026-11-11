#!/usr/bin/python3
"""Offline export of a frozen build. Never starts the app, installs or deploys."""
import argparse, hashlib, io, json, os, pathlib, re, shutil, stat, tarfile
ROOT=pathlib.Path(__file__).resolve().parent
BUILD=None
CACHE=pathlib.Path('/home/barre/.cache/peticao-admin-deps-preview-v1')
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
 from production_profile import verify_profile_pins,verify_dependency_cache
 verify_profile_pins();verify_dependency_cache()
 if out!=ROOT/'export' or out.resolve()!=out:raise ValueError('fixed_new_profile_export_required')
 if build is None:raise ValueError('explicit_build_required')
 if not build.is_absolute()or build.parent!=ROOT/'runs' or build.resolve()!=build:raise ValueError('approved_build_path_required')
 if json.loads((ROOT/'config.json').read_text()).get('infra_reviewed')is not True:raise ValueError('preparation_only')
 if __import__('shutil').disk_usage(ROOT).free<3*1024**3:raise ValueError('minimum_export_3GiB_free_required')
 site=build/'clone/site'; result=json.loads((build/'result.json').read_text())
 for k in ['sourceStable','cloneSourceStable','sourceClean','sourceHeadStable','profileStable','targetEvidenceStable','guardInstalled','assetsStable','processGroupDrained','noPreview','dependencyCacheStable']:
  if result.get(k) is not True:raise ValueError('unqualified build evidence: '+k)
 if result['exit']!=0 or result['networkDenials'] or result['remainingBuildProcesses'] or result['fakeSecretsEmbedded'] or result['postgresStarted'] or result['listenerStarted']:raise ValueError('build failure or unsafe evidence')
 profile=json.loads((build/'profile.json').read_text()); target=pathlib.Path(profile['target']['targetEvidence'])
 if sha(target.read_bytes())!=profile['target']['targetEvidenceSha256']:raise ValueError('target evidence drift')
 # Validate selected tracked source and copied runtime assets against frozen evidence.
 for filename in ['source-manifest.json','runtime-assets-manifest.json']:
  obj=json.loads((build/filename).read_text())
  if not isinstance(obj,dict):raise ValueError('unknown evidence schema')
  for rel,digest in obj.items():
   if not isinstance(digest,str):raise ValueError('unknown evidence entry')
   base=build/'clone'
   path=base/rel
   if sha(path.read_bytes())!=digest:raise ValueError('source/asset drift: '+rel)
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
 manifest={'schema_version':1,'release_id':'materials-preview-140ce6b-local-20261111','source_commit':result['sourceCommit'],'runtime_format':'next-start-v1','entrypoint':'node_modules/next/dist/bin/next','files':dict(sorted(files.items())),'migration_id':'materials-library-additive-fixture-only','migration_ack_sha256':None}
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
 report={'classification':'PORTABLE_RUNTIME_EXPORTED_NOT_SMOKED','operationalReady':False,'sourceCommit':result['sourceCommit'],'buildResultSha256':sha((build/'result.json').read_bytes()),'manifestSha256':sha(raw),'artifactSha256':sha(artifact.read_bytes()),'artifactBytes':artifact.stat().st_size,'runtimeFileCount':len(files),'runtimeBytes':sum(d['bytes'] for d in files.values()),'productionPackages':installed,'skippedOptional':skipped,'entrypointContract':['/usr/bin/node','node_modules/next/dist/bin/next','start','-p','3000','-H','127.0.0.1'],'excluded':['.next/cache','.next/types','.next/trace','node_modules/.bin','development dependencies','GEO databases','application secrets'],'pending':['isolated HTTP smoke without database','database and signature workflow smoke with fictitious records','native compatibility on actual SP target','external GEO/environment/secret provisioning','migration compatibility and deployment authorization'],'compiledBytesRewritten':False,'targetEvidenceSha256':sha(target.read_bytes())}
 (out/'export-report.json').write_bytes(canonical(report));verify(out);verify_dependency_cache()
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
 p=argparse.ArgumentParser();p.add_argument('action',choices=['export','verify']);p.add_argument('--out',type=pathlib.Path,default=ROOT/'export');p.add_argument('--build',type=pathlib.Path);a=p.parse_args()
 print(json.dumps(export(a.build,a.out) if a.action=='export' else verify(a.out),indent=2))
