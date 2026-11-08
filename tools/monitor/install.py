#!/usr/bin/env python3
"""Install only Vigia user services/aliases; never restarts the petition application."""
import argparse,base64,datetime,json,os,pathlib,shutil,subprocess,sys
ROOT=pathlib.Path('/mnt/dev/peticao');HOME=pathlib.Path.home();VENV=HOME/'.local/share/peticao-monitor/venv'
def backup(path):
 if path.exists():shutil.copy2(path,path.with_name(path.name+'.vigia-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')))
def local():
 if not (VENV/'bin/python').exists():subprocess.run([sys.executable,'-m','venv',str(VENV)],check=True)
 subprocess.run([str(VENV/'bin/python'),'-m','pip','install','-r',str(ROOT/'tools/monitor/requirements.txt')],check=True,stdout=subprocess.DEVNULL)
 directory=HOME/'.config/systemd/user';directory.mkdir(parents=True,exist_ok=True)
 unit=directory/'peticao-monitor.service';backup(unit)
 unit.write_text(f'''[Unit]
Description=Vigia task monitor and execution broker
After=network-online.target
[Service]
Type=simple
WorkingDirectory={ROOT}
ExecStart={VENV}/bin/python {ROOT}/tools/monitor/main.py coletor
Restart=on-failure
RestartSec=5
TimeoutStopSec=25
UMask=0077
Environment=PYTHONUNBUFFERED=1
Environment=PATH={HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
[Install]
WantedBy=default.target
''')
 unit.chmod(0o600)
 for name,content in {
  'peticao-monitor-watchdog.service':f'''[Unit]
Description=Detect stalled Vigia tasks independently of the collector
[Service]
Type=oneshot
WorkingDirectory={ROOT}
ExecStart={VENV}/bin/python {ROOT}/tools/monitor/main.py supervisionar
UMask=0077
''',
  'peticao-monitor-watchdog.timer':'''[Unit]
Description=Check task activity every minute
[Timer]
OnBootSec=60
OnUnitActiveSec=60
Persistent=true
[Install]
WantedBy=timers.target
''',
 }.items():
  path=directory/name;backup(path);path.write_text(content);path.chmod(0o600)
 aliases=HOME/'.bash_aliases';line="alias vigia='/mnt/dev/peticao/vigia'"
 old=aliases.read_text() if aliases.exists() else ''
 if line not in old.splitlines():backup(aliases);aliases.write_text(old.rstrip()+'\n\n# Monitor de tarefas da petição\n'+line+'\n')
 binary=HOME/'.local/bin/vigia';binary.parent.mkdir(parents=True,exist_ok=True)
 if binary.is_symlink() and binary.resolve()!=ROOT/'vigia':backup(binary);binary.unlink()
 if binary.exists() and not binary.is_symlink():raise RuntimeError('Executável vigia já existe; não substituído')
 if not binary.is_symlink():binary.symlink_to(ROOT/'vigia')
 subprocess.run(['systemd-analyze','--user','verify',str(unit)],check=True,capture_output=True)
 subprocess.run(['systemctl','--user','daemon-reload'],check=True);subprocess.run(['systemctl','--user','enable','--now','peticao-monitor.service'],check=True)
 subprocess.run(['systemctl','--user','enable','--now','peticao-monitor-watchdog.timer'],check=True)
 print('Vigia local instalado; serviços anteriores preservados.')
def remote():
 files={name:base64.b64encode((ROOT/'tools/monitor'/name).read_bytes()).decode() for name in ['remote_collector.py','remote_executor.py']}
 installer='''import base64,getpass,json,pathlib,subprocess,os
assert getpass.getuser()=='adunir'
os.umask(0o077);home=pathlib.Path.home();target=home/'.local/share/peticao-monitor';target.mkdir(parents=True,exist_ok=True,mode=0o700)
files=PAYLOAD
for name,raw in files.items():p=target/name;p.write_bytes(base64.b64decode(raw));p.chmod(0o700)
unit=home/'.config/systemd/user/peticao-monitor-collector.service';unit.parent.mkdir(parents=True,exist_ok=True)
unit.write_text('[Unit]\\nDescription=Vigia remote health collector\\n[Service]\\nExecStart=/usr/bin/python3 '+str(target/'remote_collector.py')+'\\nRestart=always\\nRestartSec=5\\nUMask=0077\\nNoNewPrivileges=yes\\n[Install]\\nWantedBy=default.target\\n');unit.chmod(0o600)
subprocess.run(['systemctl','--user','daemon-reload'],check=True,capture_output=True);subprocess.run(['systemctl','--user','enable','--now','peticao-monitor-collector.service'],check=True,capture_output=True)
print(json.dumps({'remote_collector':'installed','user':getpass.getuser()}))
'''.replace('PAYLOAD',repr(files))
 # Linger keeps the unprivileged collector/jobs alive after SSH and the local machine disconnect.
 subprocess.run(['ssh','-o','BatchMode=yes','peticao-root','loginctl','enable-linger','adunir'],check=True,capture_output=True)
 result=subprocess.run(['ssh','-o','BatchMode=yes','peticao','python3','-'],input=installer,text=True,capture_output=True,check=True);print(result.stdout.strip())
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--vps',action='store_true');args=parser.parse_args();remote() if args.vps else local()
