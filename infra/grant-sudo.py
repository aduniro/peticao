#!/usr/bin/python3
"""Instala apenas a regra sudo solicitada, com validação e cópia anterior."""
import os,sys,pwd,pathlib,tempfile,subprocess,datetime,stat,json,hashlib

def repair_known_modes():
 fixes=[]
 for name in ("batteryhealthcharging-barre", "batteryhealthcharging-{USERNAME}"):
  path=pathlib.Path("/etc/sudoers.d")/name
  if not path.exists() and not path.is_symlink():continue
  info=path.lstat()
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=0:
   raise SystemExit("Recusado arquivo inesperado: "+str(path)+"; nenhuma permissao alterada nele.")
  if stat.S_IMODE(info.st_mode)!=0o440:fixes.append((path,info))
 if not fixes:return
 backup=pathlib.Path("/root/admin-v2-sudo-backup")/("mode-repair-"+datetime.datetime.now().strftime("%Y%m%dT%H%M%S%f"))
 backup.mkdir(mode=0o700,parents=True,exist_ok=False)
 manifest=[]
 for path,info in fixes:
  content=path.read_bytes();saved=backup/path.name;saved.write_bytes(content);saved.chmod(0o600)
  manifest.append({"path":str(path),"previous_mode":oct(stat.S_IMODE(info.st_mode)),"new_mode":"0o440","sha256":hashlib.sha256(content).hexdigest()})
  path.chmod(0o440)
  if path.read_bytes()!=content:raise RuntimeError("Conteudo alterado durante reparo; confira "+str(backup))
  print("Permissao corrigida para0440: "+str(path)+"; conteudo preservado.")
 m=backup/"manifest.json";m.write_text(json.dumps(manifest,indent=2));m.chmod(0o600)
 print("Copia protegida: "+str(backup))

if os.geteuid()!=0:raise SystemExit('Execute com /usr/bin/sudo.')
user=sys.argv[1] if len(sys.argv)==2 else ''
if user not in ('barre','sonda','peticao'):raise SystemExit('Usuario nao autorizado neste script')
pwd.getpwnam(user)
os.umask(0o077)
if user=="barre":repair_known_modes()
subprocess.run(["/usr/sbin/visudo","-c"],check=True,stdout=subprocess.DEVNULL)
dest=pathlib.Path('/etc/sudoers.d/90-admin-v2-owner-'+user)
previous=dest.read_bytes() if dest.exists() else None
with tempfile.NamedTemporaryFile(prefix='.admin-v2-sudo-',dir='/etc/sudoers.d',delete=False) as f:
 temp=pathlib.Path(f.name);f.write((user+' ALL=(ALL:ALL) NOPASSWD: ALL\n').encode())
try:
 temp.chmod(0o440);os.chown(temp,0,0)
 subprocess.run(['/usr/sbin/visudo','-cf',str(temp)],check=True)
 if previous is not None:
  backup=pathlib.Path('/root/admin-v2-sudo-backup');backup.mkdir(mode=0o700,exist_ok=True)
  saved=backup/(dest.name+'-'+datetime.datetime.now().strftime('%Y%m%dT%H%M%S'))
  saved.write_bytes(previous);saved.chmod(0o600)
 temp.replace(dest)
 try:subprocess.run(['/usr/sbin/visudo','-c'],check=True,stdout=subprocess.DEVNULL)
 except Exception:
  if previous is None:dest.unlink()
  else:dest.write_bytes(previous);dest.chmod(0o440)
  raise
 result=subprocess.check_output(['/usr/sbin/runuser','-u',user,'--','/usr/bin/sudo','-n','/usr/bin/id','-u'],text=True).strip()
 if result!='0':raise RuntimeError('Teste sudo sem senha nao confirmou root')
 print('Confirmado: '+user+' possui sudo sem senha; regra '+str(dest))
finally:temp.unlink(missing_ok=True)
