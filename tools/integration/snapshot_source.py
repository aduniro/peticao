"""Capture/verify VPS source without changing its filesystem, runtime or database."""
import argparse,hashlib,json,os,pathlib,subprocess,tarfile

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',choices=['production','stage'],default='production');p.add_argument('--output',type=pathlib.Path,required=True);args=p.parse_args()
 os.umask(0o077);out=args.output.resolve();out.mkdir(parents=True,exist_ok=False,mode=0o700)
 archive=out/'source.tar.gz';helper=pathlib.Path(__file__).with_name('remote_source.py').read_bytes()
 with archive.open('xb') as f:
  result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','peticao-root','python3','-',args.source],input=helper,stdout=f,stderr=subprocess.PIPE,timeout=120)
 if result.returncode:raise SystemExit('Read-only source export failed; no runtime data was requested.')
 source=out/'site';source.mkdir(mode=0o700)
 with tarfile.open(archive) as tar:
  members=tar.getmembers();seen=set()
  for member in members:
   path=pathlib.PurePosixPath(member.name)
   if not member.isfile() or path.is_absolute() or '..' in path.parts or member.name in seen or member.size>32*1024*1024:raise RuntimeError('Unsafe source archive')
   seen.add(member.name)
  manifest=json.load(tar.extractfile('SOURCE-MANIFEST.json'))
  if manifest['schema']!='peticao-source-v1' or not manifest.get('runtime_excluded'):raise RuntimeError('Unexpected source manifest')
  if seen!=set(manifest['files'])|{'SOURCE-MANIFEST.json'}:raise RuntimeError('Source member mismatch')
  for name,expected in manifest['files'].items():
   raw=tar.extractfile(name).read()
   if len(raw)!=expected['bytes'] or hashlib.sha256(raw).hexdigest()!=expected['sha256']:raise RuntimeError('Source checksum mismatch')
   target=source/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2))
 print(json.dumps({'source':args.source,'files':len(manifest['files']),'directory':str(out),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'runtime_excluded':True}))
if __name__=='__main__':main()
