#!/usr/bin/python3
"""Package committed private profile only. Does not start workers or applications."""
from pathlib import Path
import hashlib,json,subprocess,tarfile,io,os
ROOT=Path(__file__).resolve().parent

def git(*args):return subprocess.check_output(['/usr/bin/git','-C',str(ROOT),*args])
def main():
 os.umask(0o077)
 if git('status','--porcelain','--untracked-files=no').strip():raise ValueError('tracked profile dirty')
 commit=git('rev-parse','HEAD').decode().strip();manifest=json.loads(git('show','HEAD:code-manifest.json'));tracked=set(git('ls-files','-z').decode().strip('\0').split('\0'));expected=set(manifest['files'])|{'code-manifest.json'}
 if tracked!=expected:raise ValueError('unexpected tracked files; package only code/tests/docs/manifests')
 payload={}
 for name in sorted(expected):
  raw=git('show','HEAD:'+name)
  if name in manifest['files'] and {'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}!=manifest['files'][name]:raise ValueError('code manifest mismatch')
  payload[name]=raw
 payload['profile-provenance.json']=(json.dumps({'profileCommit':commit,'runtimeSourceCommit':manifest['runtimeSourceCommit'],'codeManifestSha256':hashlib.sha256(payload['code-manifest.json']).hexdigest(),'operationalReady':False,'executedPopulatedHttpChecks':0},indent=2)+'\n').encode()
 out=ROOT.parent/'r4-native-artifacts';out.mkdir(mode=0o700,exist_ok=True);artifact=out/('history-native-r4-'+commit[:12]+'.tar')
 if artifact.exists():raise ValueError('preserve previous package')
 with tarfile.open(artifact,'w',format=tarfile.USTAR_FORMAT) as tf:
  for name,data in sorted(payload.items()):
   ti=tarfile.TarInfo(name);ti.size=len(data);ti.mode=0o600;ti.mtime=0;tf.addfile(ti,io.BytesIO(data))
 # Verify archive regular member set and bytes before reporting.
 with tarfile.open(artifact,'r:') as tf:
  seen={}
  for member in tf:
   if not member.isfile() or member.name in seen or member.name not in payload:raise ValueError('invalid archive member')
   seen[member.name]=tf.extractfile(member).read()
  if seen!=payload:raise ValueError('archive differs from commit')
 result={'classification':'R4_NATIVE_PROFILE_COMMITTED_BUNDLE_NOT_EXECUTED','operationalReady':False,'profileCommit':commit,'artifact':str(artifact),'artifactBytes':artifact.stat().st_size,'artifactSha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'codeManifestSha256':hashlib.sha256(payload['code-manifest.json']).hexdigest(),'members':len(payload),'executedPopulatedHttpChecks':0}
 report=out/('bundle-'+commit[:12]+'.json');report.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
