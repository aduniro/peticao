from pathlib import Path
import datetime,json,subprocess,time,urllib.request,ssl,os
ROOT=Path(__file__).resolve().parents[1];DEST=ROOT/'evidence/production-baseline';DEST.mkdir(parents=True,exist_ok=True)
code='''import pathlib,json,subprocess,os
m={}
for l in pathlib.Path('/proc/meminfo').read_text().splitlines():
 k,v=l.split(':',1)
 if k in ('MemTotal','MemAvailable','SwapFree'):m[k]=int(v.split()[0])*1024
s=subprocess.check_output(['/usr/bin/systemctl','show','peticao.service','postgresql@17-main.service','-p','Id','-p','ActiveState','-p','MainPID'],text=True)
print(json.dumps({'mem':m,'load':os.getloadavg(),'services':s}))
'''
start=time.monotonic();deadline=start+1800;count=0;http_failures=0
while True:
 tick=time.monotonic();row={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsed':round(tick-start,2)}
 try:
  t=time.monotonic()
  with urllib.request.urlopen(urllib.request.Request('https://sancionaintegral.org',headers={'User-Agent':'Peticao-infrastructure-readiness/1'}),timeout=15,context=ssl.create_default_context()) as r:row.update(http=r.status,latency_ms=round((time.monotonic()-t)*1000,2))
 except Exception as e:row['http_error']=type(e).__name__+': '+str(e)[:200];http_failures+=1
 try:
  r=subprocess.run(['/usr/bin/ssh','-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes','peticao-root','/usr/bin/python3 -'],input=code,capture_output=True,text=True,timeout=15)
  if r.returncode==0:row['node']=json.loads(r.stdout)
  else:row['node_error']=r.stderr[:200]
 except Exception as e:row['node_error']=type(e).__name__
 count+=1
 with (DEST/'samples.jsonl').open('a') as f:f.write(json.dumps(row)+'\n');f.flush()
 print(json.dumps({'sample':count,'elapsed':row['elapsed'],'http':row.get('http'),'node_ok':'node' in row}),flush=True)
 if time.monotonic()>=deadline:break
 time.sleep(max(0,min(30-(time.monotonic()-tick),deadline-time.monotonic())))
samples=[json.loads(l) for l in (DEST/'samples.jsonl').read_text().splitlines()];lat=sorted(x['latency_ms'] for x in samples if 'latency_ms' in x)
result={'started_at':samples[0]['at'],'finished_at':samples[-1]['at'],'elapsed_seconds':time.monotonic()-start,'samples':count,'http_failures':http_failures,'p95_ms':lat[min(len(lat)-1,int(len(lat)*.95))] if lat else None,'all_nodes_observed':all('node' in x for x in samples),'pass':count>=30 and http_failures==0 and all('node' in x for x in samples)}
(DEST/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
