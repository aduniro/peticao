#!/usr/bin/python3
"""Materialize three complete locked QA packages; never run npm or package code."""
from pathlib import Path
import json,subprocess,hashlib,tarfile,io,os
ROOT=Path(__file__).resolve().parent;CACHE=Path('/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules');REPO=Path('/mnt/apps/peticao-final/_ops/r0003-govbr-http-gates-20261110');COMMIT='93557bfba931f8f731807fc9f30f1d88dbafedf1';PACKAGES=['tsx','esbuild','@esbuild/linux-x64']
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
 os.umask(0o077);out=ROOT/'artifacts/devdeps.tar'
 if out.exists():raise ValueError('preserve existing dependency artifact')
 lockbytes=subprocess.check_output(['/usr/bin/git','--no-optional-locks','-C',str(REPO),'show',COMMIT+':site/package-lock.json']);lock=json.loads(lockbytes);files={};metadata={}
 for name in PACKAGES:
  entry=lock['packages']['node_modules/'+name];package=CACHE/name;pkg=json.loads((package/'package.json').read_text())
  if pkg['version']!=entry['version']:raise ValueError('dependency version mismatch')
  metadata[name]={'version':pkg['version'],'lockIntegrity':entry.get('integrity'),'resolved':entry.get('resolved'),'dependencies':pkg.get('dependencies',{}),'packageJsonSha256':sha((package/'package.json').read_bytes())}
  for path in sorted(package.rglob('*')):
   if path.is_symlink():raise ValueError('symlink dependency entry needs review')
   if path.is_dir():continue
   if not path.is_file():raise ValueError('special dependency entry')
   name_in_archive='node_modules/'+name+'/'+str(path.relative_to(package));raw=path.read_bytes();files[name_in_archive]={'sha256':sha(raw),'bytes':len(raw),'mode':0o755 if path.stat().st_mode&0o111 else 0o644,'origin':str(path)}
 with tarfile.open(out,'w',format=tarfile.USTAR_FORMAT) as tf:
  for name,entry in files.items():
   raw=Path(entry['origin']).read_bytes()
   if sha(raw)!=entry['sha256']:raise ValueError('dependency cache drift')
   member=tarfile.TarInfo(name);member.mode=entry['mode'];member.size=len(raw);member.mtime=0;tf.addfile(member,io.BytesIO(raw))
 manifest={'classification':'LOCK_MATCHED_OBSERVED_THREE_PACKAGE_QA_CLOSURE_NOT_EXECUTED','sourceCommit':COMMIT,'packageLockSha256':sha(lockbytes),'packages':metadata,'files':files,'artifactSha256':sha(out.read_bytes()),'artifactBytes':out.stat().st_size,'completePackages':True,'registryArchiveReattested':False,'npmExecuted':False,'networkUsed':False,'intendedEntrypoint':'node --import <job>/site/node_modules/tsx/dist/loader.mjs --test <fixed-filter> <fixed-file>','excludedOptional':'fsevents Darwin only; get-tsconfig/resolve-pkg-maps are not packages in this lock'}
 (ROOT/'artifacts/devdeps-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps({'packages':metadata,'files':len(files),'logicalBytes':sum(d['bytes'] for d in files.values()),'archiveBytes':manifest['artifactBytes'],'archiveSha256':manifest['artifactSha256'],'executed':False},indent=2))
if __name__=='__main__':main()
