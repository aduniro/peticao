#!/usr/bin/env python3
"""Private VPS snapshot. SQL is exclusively READ ONLY; no CPF API requests."""
import hashlib,json,os,sqlite3,subprocess,sys,tarfile,shutil
from pathlib import Path
os.umask(0o077)
if sys.argv[1]=='--cleanup':
 cleanup=Path(sys.argv[2])
 if cleanup.parent!=Path('/root/peticao-recovery/revisao-exports') or cleanup.is_symlink():raise RuntimeError('Unexpected cleanup path')
 if cleanup.exists():shutil.rmtree(cleanup)
 sys.exit(0)
job=Path('/root/peticao-recovery/complementos/complemento-20261106T115500Z')
target=Path(sys.argv[1]);previous=sys.argv[2] if len(sys.argv)>2 else '';previous_static=sys.argv[3] if len(sys.argv)>3 else ''
if target.parent!=Path('/root/peticao-recovery/revisao-exports'):raise RuntimeError('Unexpected export')
if previous=='-':previous=''
if previous_static=='-':previous_static=''
if previous and (len(previous)!=64 or any(c not in '0123456789abcdef' for c in previous)):raise RuntimeError('Unexpected fingerprint')
helper=Path(__file__).with_name('export-live.mjs')
p=subprocess.run(['node',str(helper)],capture_output=True,text=True,timeout=45)
if p.returncode:raise RuntimeError('Read-only snapshot unavailable')
snapshot=json.loads(p.stdout)
if snapshot.get('read_only') is not True:raise RuntimeError('Read-only transaction required')
def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
static={}
for name in ('consultas.sqlite','recuperacao.sqlite'):
 static[name]=sha(job/name)
 wal=Path(str(job/name)+'-wal')
 if wal.exists():static[name+'-wal']=sha(wal)
static_id=hashlib.sha256(json.dumps(static,sort_keys=True).encode()).hexdigest()
semantic={'signatures':snapshot['signatures'],'cache':snapshot['cache'],'validation_version':snapshot['validation_version'],'build_id':snapshot['build_id'],'static':static}
fingerprint=hashlib.sha256(json.dumps(semantic,sort_keys=True,separators=(',',':')).encode()).hexdigest()
report={'changed':fingerprint!=previous,'static_id':static_id,'fingerprint':fingerprint,'source_at':snapshot['at'],'read_only':True,'validation_version':snapshot['validation_version'],'build_id':snapshot['build_id'],'signatures':len(snapshot['signatures']),'cache_records':len(snapshot['cache']['records'])}
if fingerprint==previous:
 print(json.dumps(report));sys.exit(0)
target.mkdir(mode=0o700)
(target/'signatures.json').write_text(json.dumps({k:v for k,v in snapshot.items() if k not in ('cache',)},ensure_ascii=False))
(target/'cache.json').write_text(json.dumps(snapshot['cache'],ensure_ascii=False))
for name in (() if static_id==previous_static else ('consultas.sqlite','recuperacao.sqlite')):
 with sqlite3.connect((job/name).as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(target/name) as dst:
  src.backup(dst)
  if dst.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('SQLite export failed')
files=list(target.iterdir())
manifest=[{'file':p.name,'sha256':sha(p),'bytes':p.stat().st_size} for p in files]
(target/'manifest.json').write_text(json.dumps(manifest,indent=2))
with tarfile.open(target/'fontes.tar.gz','w:gz') as tar:
 for path in files+[target/'manifest.json']:tar.add(path,arcname=path.name,recursive=False)
report['archive_sha256']=sha(target/'fontes.tar.gz')
print(json.dumps(report))
