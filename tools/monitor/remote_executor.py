#!/usr/bin/env python3
"""Adunir-only persistent jobs, private PTY and controls. No app credentials are loaded."""
import datetime, hashlib, json, os, pathlib, pty, re, select, signal, subprocess, sys, time, uuid
ROOT=pathlib.Path.home()/'.local/state/peticao-monitor/jobs'
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(path,value):
 tmp=path.with_name('.'+uuid.uuid4().hex);tmp.write_text(json.dumps(value));tmp.chmod(0o600);os.replace(tmp,path)
def directory(job_id):
 if not re.fullmatch('[a-f0-9]{32}',job_id):raise ValueError('Invalid job ID')
 return ROOT/job_id
def worker(job_id):
 os.umask(0o077);folder=directory(job_id);config=json.loads((folder/'config.json').read_text());master,slave=pty.openpty()
 try:proc=subprocess.Popen(['bash','-lc',config['command']],cwd=config['cwd'],stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
 except OSError:
  os.close(slave);os.close(master);atomic(folder/'state.json',{'id':job_id,'state':'failed','error':'invalid_cwd_or_command','finished_at':stamp()});return
 os.close(slave);canceled=False
 state={'id':job_id,'state':'running','started_at':stamp(),'pid':proc.pid,'exit_code':None,'boot_id':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'start_ticks':pathlib.Path(f'/proc/{proc.pid}/stat').read_text().rpartition(') ')[2].split()[19]};atomic(folder/'state.json',state)
 def cancel(*_):
  nonlocal canceled
  canceled=True
 signal.signal(signal.SIGTERM,cancel);signal.signal(signal.SIGINT,cancel)
 try:
  with (folder/'output.log').open('ab',buffering=0) as log:
   while proc.poll() is None:
    for path in sorted(folder.glob('control-*.json')):
     try:
      data=json.loads(path.read_text())
      if data.get('handled'):continue
      action=data['action']
      if action=='cancel':canceled=True
      elif action in ('pause','resume'):
       os.killpg(proc.pid,signal.SIGSTOP if action=='pause' else signal.SIGCONT);state['state']='paused' if action=='pause' else 'running';atomic(folder/'state.json',state)
      elif action=='stdin':os.write(master,data.get('text','').encode())
      atomic(path,{'handled':True})
     except (OSError,ValueError,KeyError):pass
    if canceled:
     os.killpg(proc.pid,signal.SIGCONT);os.killpg(proc.pid,signal.SIGTERM)
     try:proc.wait(timeout=5)
     except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL)
    ready,_,_=select.select([master],[],[],.2)
    if ready:
     try:raw=os.read(master,8192)
     except OSError:break
     if log.tell()<2000000:log.write(raw)
   deadline=time.monotonic()+1
   while time.monotonic()<deadline and select.select([master],[],[],0)[0]:
    try:raw=os.read(master,8192)
    except OSError:break
    if not raw:break
    if log.tell()<2000000:log.write(raw)
  code=proc.wait();state.update(state='interrupted' if canceled else 'completed' if code==0 else 'failed',exit_code=code,finished_at=stamp());atomic(folder/'state.json',state)
 finally:
  if proc.poll() is None:os.killpg(proc.pid,signal.SIGTERM)
  os.close(master)
def request(data):
 os.umask(0o077);job_id=data['id'];folder=directory(job_id);action=data['action']
 if action=='start':
  ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
  digest=hashlib.sha256(json.dumps({'command':data['command'],'cwd':data['cwd']},sort_keys=True).encode()).hexdigest()
  if folder.exists():
   previous=json.loads((folder/'config.json').read_text())
   if previous['digest']!=digest:raise ValueError('Job identity mismatch')
   return {'existing':True}
  if not pathlib.Path(data['cwd']).is_dir():raise ValueError('invalid_cwd')
  folder.mkdir(mode=0o700);atomic(folder/'config.json',{'command':data['command'],'cwd':data['cwd'],'digest':digest});atomic(folder/'state.json',{'id':job_id,'state':'queued'})
  result=subprocess.run(['systemd-run','--user','--quiet','--collect','--unit=peticao-vigia-job-'+job_id,'--property=UMask=0077','--property=NoNewPrivileges=yes','/usr/bin/python3',str(pathlib.Path(__file__).resolve()),'worker',job_id],capture_output=True,timeout=10)
  if result.returncode:atomic(folder/'state.json',{'id':job_id,'state':'failed','error':'user_service_unavailable'});raise RuntimeError('User service unavailable')
  return {'started':True}
 if action=='read':
  offset=max(0,int(data.get('offset',0)));raw=b'';path=folder/'output.log'
  if path.is_file():
   with path.open('rb') as f:f.seek(offset);raw=f.read(32768)
  state=json.loads((folder/'state.json').read_text())
  if state.get('state') in ('running','paused'):
   try:alive=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()==state.get('boot_id') and pathlib.Path(f"/proc/{state['pid']}/stat").read_text().rpartition(') ')[2].split()[19]==state.get('start_ticks')
   except (OSError,KeyError,IndexError):alive=False
   if not alive:state.update(state='interrupted',finished_at=stamp(),error='worker_lost');atomic(folder/'state.json',state)
  return {'state':state,'offset':offset+len(raw),'output':raw.decode(errors='replace')}
 if action=='control':
  cid=data['control']['id']
  if not re.fullmatch('[a-f0-9]{32}',cid):raise ValueError('Invalid control ID')
  if data['control']['action'] not in ('stdin','pause','resume','cancel'):raise ValueError('Unknown control')
  path=folder/('control-'+cid+'.json')
  if not path.exists():atomic(path,data['control'])
  return {'accepted':True}
 raise ValueError('Unknown request')
if __name__=='__main__':
 try:
  if len(sys.argv)==3 and sys.argv[1]=='worker':worker(sys.argv[2])
  else:print(json.dumps(request(json.load(sys.stdin))))
 except Exception as e:print(json.dumps({'error':type(e).__name__}));sys.exit(1)
