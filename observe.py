"""Read-only metadata observation; no argv/environment/credential inspection."""
from pathlib import Path
import subprocess,json,time,os,socket

def cmd(args):
 p=subprocess.run(args,capture_output=True,text=True,timeout=20)
 return {'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr[-1000:]}

def sample():
 own=set();pid=os.getpid()
 while pid>1:
  own.add(pid)
  try:pid=int(Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[1])
  except (OSError,ValueError):break
 procs=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   stat=(p/'stat').read_text().rsplit(')',1)[1].split();comm=(p/'comm').read_text().strip()
   try:cwd=os.readlink(p/'cwd')
   except OSError:cwd=None
   procs.append({'pid':int(p.name),'ppid':int(stat[1]),'comm':comm,'state':stat[0],'cpu_ticks':int(stat[11])+int(stat[12]),'start_ticks':int(stat[19]),'cwd':cwd,'observer_ancestor':int(p.name) in own})
  except (OSError,ValueError,IndexError):continue
 return {'unix':time.time(),'monotonic':time.monotonic(),'hostname':socket.gethostname(),'processes':procs,'sessions':cmd(['/usr/bin/loginctl','list-sessions','--no-legend','--no-pager']),'who':cmd(['/usr/bin/who']),'units':cmd(['/usr/bin/systemctl','list-units','--all','--no-legend','--no-pager','peticao*','admin*','vigia*','codex*']),'jobs':cmd(['/usr/bin/systemctl','list-jobs','--no-legend','--no-pager']),'containers':cmd(['/usr/bin/docker','ps','--no-trunc','--format','{"ID":"{{.ID}}","Names":"{{.Names}}","State":"{{.State}}"}']),'mounts':cmd(['/usr/bin/findmnt','-J','-o','TARGET,SOURCE,FSTYPE','--target','/mnt/apps/peticao-final/.runtime/azure-qualification-c472-20261114-attempt1/exports/build-1'])}
if __name__=='__main__':
 for i in range(21):
  print(json.dumps({'sample':i,'metadata':sample()}),flush=True)
  if i<20:time.sleep(30)
