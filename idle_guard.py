"""Evidence checks, never power operations."""
import re,time
VM='peticao-azure-dev-01'
WORK=re.compile(r'^(node|npm|npx|python|java|ruby|php|postgres|mongod|redis|ffmpeg|ffprobe|convert|cmake|make|gcc|g\+\+|cc1|clang|chrome|chromium|tar|gzip|zstd|rsync|scp|sftp|code|codium|codex|uvicorn|gunicorn|docker-buildx|containerd-shim)')

def idle(sample):
 if sample.get('hostname')!=VM:raise ValueError('wrong host')
 for name in ['sessions','who','units','jobs','containers','mounts']:
  if sample[name]['exit']:raise ValueError('incomplete observer:'+name)
 if sample['containers']['stdout'].strip() or sample['jobs']['stdout'].strip():raise ValueError('active containers/systemd jobs')
 ancestors={p['pid'] for p in sample['processes'] if p['observer_ancestor']}
 for row in sample['sessions']['stdout'].splitlines():
  f=row.split()
  if len(f)<6 or (f[5]!='manager' and int(f[4]) not in ancestors):raise ValueError('other interactive session/consumer')
 for row in sample['units']['stdout'].splitlines():
  f=row.split()
  if len(f)<4:continue
  if not (f[0]=='peticao-azure-qualified-build-20261114-attempt1.service' and f[1:4]==['loaded','active','exited']):raise ValueError('project unit requires investigation')
 allowed={'systemd','systemd-journal','systemd-resolve','systemd-udevd','hv_kvp_daemon','systemd-network','dbus-daemon','systemd-logind','chronyd','agetty','unattended-upgr','waagent','tailscaled','containerd','dockerd','(sd-pam)','sshd'}
 for p in sample['processes']:
  if p['observer_ancestor'] or p['pid']==2 or p['ppid']==2:continue
  if p['comm']=='python3' and p['cwd']=='/var/lib/waagent/WALinuxAgent-2.16.0.2':continue
  if WORK.match(p['comm']) or (p['cwd'] and p['cwd'].startswith('/mnt/apps/')):raise ValueError('workload process:'+p['comm'])
  if p['comm'] not in allowed:raise ValueError('unknown user-space process:'+p['comm'])
 return True

def window(rows,now=None):
 if len(rows)!=21 or [x['sample'] for x in rows]!=list(range(21)):raise ValueError('21 sequential samples required')
 samples=[x['metadata'] for x in rows]
 if samples[-1]['monotonic']-samples[0]['monotonic']<600:raise ValueError('less than10min observed')
 gaps=[b['monotonic']-a['monotonic'] for a,b in zip(samples,samples[1:])]
 if any(x<29 or x>45 for x in gaps):raise ValueError('sampling gap invalid')
 age=(time.time() if now is None else now)-samples[-1]['unix']
 if age<0 or age>300:raise ValueError('observation stale')
 for s in samples:idle(s)
 return {'samples':len(samples),'observed_seconds':samples[-1]['monotonic']-samples[0]['monotonic'],'last_age_seconds':age,'sampling_limit':'30-second snapshots; not continuous process tracing'}
