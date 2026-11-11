#!/usr/bin/python3
import sys,re,json,subprocess,pathlib
args=sys.argv[1:];cancel=len(args)==2 and args[0]=='--cancel'
if len(args)!=(2 if cancel else 1):raise SystemExit(2)
id=args[-1]
if not re.fullmatch('[a-f0-9]{32}',id):raise SystemExit(2)
unit='admin-v2-job-'+id
if cancel:
 subprocess.run(['/usr/bin/systemctl','stop',unit+'.service'],check=True)
 raise SystemExit(0)
a=json.loads(pathlib.Path('/srv/admin-v2-coordinator/authority.json').read_text())
if a.get('role')!='primary' or a.get('armed_boot_id')!=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip():raise SystemExit('coordinator_not_armed')
p=pathlib.Path('/srv/admin-v2-worker/jobs')/id/'config.json'
if not p.is_file() or p.is_symlink():raise SystemExit('job_config_missing')
config=json.loads(p.read_text())
profile=config.get('payload',{}).get('kind')=='runtime-http-r0000-v1'
history=config.get('payload',{}).get('kind')=='history-populated-native-pg17-r4'
existing=subprocess.run(['/usr/bin/systemctl','show',unit+'.service','-p','LoadState','--value'],capture_output=True,text=True).stdout.strip()
if existing not in ('','not-found'):raise SystemExit('unit_already_exists_do_not_replay')
cmd=['/usr/bin/systemd-run','--quiet','--unit='+unit,'--property=User=vigia-worker','--property=Group=admin-v2-exec','--property=SupplementaryGroups=vigia-worker','--property=CPUQuota='+('200%' if history else '300%'),'--property=MemoryMax='+('3G' if history else '5G'),'--property=MemorySwapMax='+('0' if history else '1G'),'--property=TasksMax=256','--property=RuntimeMaxSec='+('600' if history else '120' if profile else '7200'),'--property=TimeoutStopSec='+('120' if history else '15'),'--property=KillMode=control-group','--property=UMask=0007','--setenv=ADMIN_CLUSTER_ROOT=/srv/admin-v2-coordinator','--setenv=ADMIN_WORKER_ROOT=/srv/admin-v2-worker','/usr/bin/python3','/opt/admin-v2-cluster/coordinator.py','run',id]
subprocess.run(cmd,check=True)
