"""Pinned regular-byte staging. Never extract links or execute package lifecycle scripts."""
from pathlib import Path,PurePosixPath
import hashlib,json,os,stat,tarfile
class StagingError(RuntimeError):pass
def digest(p,limit=512*1024**2):
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_size>limit:raise StagingError('single regular bounded file required')
  h=hashlib.sha256()
  with os.fdopen(fd,'rb',closefd=False)as f:
   for b in iter(lambda:f.read(1024**2),b''):h.update(b)
  return h.hexdigest()
 finally:os.close(fd)
def pinned(path,expected,limit=512*1024**2):
 if path.resolve()!=path or digest(path,limit)!=expected:raise StagingError('pin mismatch: '+path.name)
def read_manifest(p,expected):pinned(p,expected,8*1024**2);return json.loads(p.read_text())
def safe_name(name):
 p=PurePosixPath(name)
 if not name or p.is_absolute()or '..'in p.parts or str(p)!=name:raise StagingError('unsafe member')
 return p

def extract(archive,expected,entries,destination,*,prefix='',extra=None,existing=False):
 pinned(archive,expected)
 if existing:
  if destination.resolve()!=destination or not destination.is_dir()or destination.stat().st_uid!=os.getuid()or stat.S_IMODE(destination.stat().st_mode)!=0o700:raise StagingError('unsafe existing private destination')
 else:destination.mkdir(mode=0o700)
 seen=set();written={}
 with tarfile.open(archive,'r:')as tf:
  for t in tf:
   safe_name(t.name.rstrip('/')if t.isdir()else t.name)
   if t.isdir():continue
   if not t.isfile()or t.name in seen:raise StagingError('link/special/duplicate member')
   seen.add(t.name)
   if extra and t.name in extra:
    data=tf.extractfile(t).read()
    if hashlib.sha256(data).hexdigest()!=extra[t.name]:raise StagingError('embedded manifest drift')
    continue
   name=t.name
   if prefix:
    if not name.startswith(prefix):raise StagingError('unexpected archive root')
    name=name[len(prefix):]
   if name not in entries:raise StagingError('unmanifested member '+name)
   pin=entries[name]
   if t.size!=pin['bytes']or t.size>256*1024**2:raise StagingError('member size')
   # Runtime .next is checked byte-for-byte, but only dependencies are staged for route QA.
   retain=not prefix or name.startswith('node_modules/')
   h=hashlib.sha256();out=None
   if retain:
    dest=destination/name;dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True);out=dest.open('xb')
   try:
    with tf.extractfile(t)as src:
     for b in iter(lambda:src.read(1024**2),b''):
      h.update(b)
      if out:out.write(b)
   finally:
    if out:out.close()
   if h.hexdigest()!=pin['sha256']:raise StagingError('member sha mismatch '+name)
   written[name]=pin['sha256']
   if retain:
    mode=pin.get('mode',0o644)
    if isinstance(mode,str):mode=int(mode,8)
    (destination/name).chmod(0o700 if mode&0o111 else 0o600)
 expected_names={prefix+n for n in entries}|set(extra or {})
 if seen!=expected_names:raise StagingError('archive inventory mismatch')
 return written
