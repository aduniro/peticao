#!/usr/bin/python3
"""Cliente privado do coordenador. Nenhum deploy/merge automático."""
import argparse,json,subprocess,sys,pathlib
BASE=pathlib.Path(__file__).resolve().parent.parent
HOSTS={'santiago':'100.80.18.81','sp':'100.109.6.122'}
def rpc(node,payload):
 cmd=['/usr/bin/ssh','-T','-p','2222','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','UserKnownHostsFile='+str(BASE/'infra/known_hosts'),'-i','/home/barre/.ssh/id_admin_v2_cluster','vigia-coord@'+HOSTS[node]]
 r=subprocess.run(cmd,input=json.dumps(payload),capture_output=True,text=True,timeout=180)
 if not r.stdout.strip():raise RuntimeError(r.stderr.strip() or 'empty_response')
 data=json.loads(r.stdout)
 if r.returncode or data.get('error'):raise RuntimeError(json.dumps(data))
 return data
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--node',choices=HOSTS,default='santiago');p.add_argument('action',nargs='?',default='node-info');p.add_argument('--json',default='{}');a=p.parse_args();data=json.loads(a.json);data['action']=a.action
 try:print(json.dumps(rpc(a.node,data),ensure_ascii=False,indent=2))
 except Exception as e:print(json.dumps({'error':str(e)}),file=sys.stderr);sys.exit(1)
