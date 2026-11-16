import concurrent.futures,datetime,json,shlex,subprocess
from pathlib import Path
P=Path(__file__).resolve().parent;nodes=json.loads((P/'installed.json').read_text())['nodes']
CODE=r'''
import concurrent.futures,json,os,pwd,shlex,subprocess,sys
from pathlib import Path
d=json.load(sys.stdin);origin=d['origin'];nodes=d['nodes'];items=[(account,peer,root) for account in [origin['user'],'root'] for peer in nodes for root in [False,True]]
probe="import json,os,pwd,subprocess; r=subprocess.run(['sudo','-n','id','-u'],capture_output=True,text=True); print(json.dumps({'uid':os.getuid(),'user':pwd.getpwuid(os.getuid()).pw_name,'sudoUid':r.stdout.strip(),'sudoExit':r.returncode,'sshConnection':os.environ.get('SSH_CONNECTION','')}))"
def test(item):
 account,peer,root=item;home=Path(pwd.getpwnam(account).pw_dir);alias='peticao-'+peer['id']+('-root' if root else '')+'-tailnet';cmd=(['runuser','-u',account,'--'] if account!='root' else [])+['ssh','-F',str(home/'.ssh/config_peticao_tailnet_v2'),alias,'python3 -c '+shlex.quote(probe)]
 try:
  r=subprocess.run(cmd,capture_output=True,text=True,timeout=22);result=json.loads(r.stdout) if r.returncode==0 else {};expected='root' if root else peer['user'];ok=r.returncode==0 and result.get('user')==expected and result.get('sudoUid')=='0' and result.get('sshConnection','').split()[0]==origin['ip']
  return {'origin':origin['id'],'originAccount':account,'destination':peer['id'],'destinationAccount':expected,'ok':ok,'exit':r.returncode,'result':result,'error':r.stderr[-300:] if not ok else None}
 except Exception as e:return {'origin':origin['id'],'originAccount':account,'destination':peer['id'],'destinationAccount':'root' if root else peer['user'],'ok':False,'error':type(e).__name__}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(test,items))
print(json.dumps(results))
'''
def run(origin):
 cmd=['sudo','-n','python3','-c',CODE] if origin['bootstrap'] is None else ['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10',origin['bootstrap'],('' if origin['id']=='akamai' else 'sudo -n ')+'python3 -c '+shlex.quote(CODE)]
 r=subprocess.run(cmd,input=json.dumps({'origin':origin,'nodes':nodes}),capture_output=True,text=True,timeout=150)
 if r.returncode:raise RuntimeError(origin['id']+': '+r.stderr[-400:])
 return json.loads(r.stdout)
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 futures={pool.submit(run,n):n for n in nodes}
 for f in concurrent.futures.as_completed(futures):
  out=f.result();results+=out;print(json.dumps({'origin':futures[f]['id'],'passed':sum(x['ok'] for x in out),'total':len(out),'failed':[x for x in out if not x['ok']]}),flush=True)
(P/'TESTES-MALHA.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'total':len(results),'passed':sum(x['ok'] for x in results),'results':results},ensure_ascii=False,indent=2)+'\n')
if not all(x['ok'] for x in results):raise SystemExit(1)
