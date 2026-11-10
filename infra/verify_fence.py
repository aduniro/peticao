#!/usr/bin/python3
import sys,os,json,subprocess,datetime
proof=json.load(sys.stdin)
if proof.get('method')!='coordinator-stopped' or proof.get('previous_host')!='sonda-verifica3':raise SystemExit('unsupported_fencing_proof')
cmd=['/usr/bin/ssh','-T','-p','2222','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','UserKnownHostsFile=/root/.ssh/admin-v2-fence-known-hosts','-i','/root/.ssh/id_admin_v2_fence','vigia-coord@100.80.18.81']
p=subprocess.run(cmd,input=json.dumps({'action':'fence-info'}),text=True,capture_output=True,timeout=20,check=True)
s=json.loads(p.stdout)
if not s.get('fenced') or s.get('hostname')!=proof['previous_host'] or s.get('generation')!=proof['previous_generation']:raise SystemExit('fencing_not_confirmed')
when=datetime.datetime.fromisoformat(s['checked_at']);now=datetime.datetime.now(datetime.timezone.utc)
if not 0<=(now-when).total_seconds()<60:raise SystemExit('stale_fence_check')
print(json.dumps({'confirmed':True,'nonce':os.environ['ADMIN_CLUSTER_FENCE_NONCE'],'previous_host':s['hostname'],'previous_generation':s['generation'],'method':'coordinator-stopped','verified_at':now.isoformat()}))
