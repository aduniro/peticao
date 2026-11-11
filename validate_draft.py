#!/usr/bin/python3
"""Only mocks and dummy Node builtins; does NOT run run.py, app, tsx, PG or SSH."""
from pathlib import Path
import hashlib,json,os,subprocess,time
ROOT=Path(__file__).resolve().parent
NODE=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node')
def main():
 out=ROOT/'artifacts'/('mock-validation-'+str(time.time_ns()));out.mkdir(mode=0o700)
 cmds=[['/usr/bin/python3','-m','unittest','-v','test_native_pg','test_harness','test_guard_bootstrap'],[str(NODE),'--test',str(ROOT/'test_guard.cjs')]]
 results=[]
 for i,args in enumerate(cmds):
  start=time.monotonic();p=subprocess.run(args,cwd=ROOT,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/nonexistent'},capture_output=True,text=True,timeout=20)
  (out/f'{i}-stdout.log').write_text(p.stdout);(out/f'{i}-stderr.log').write_text(p.stderr);results.append({'argv':args,'exit':p.returncode,'durationSeconds':round(time.monotonic()-start,3)})
 result={'classification':'PRIVATE_DRAFT_MOCKS_ONLY','actualApplicationCallbacksExecuted':0,'actualPostgresqlStarted':False,'actualTsxImported':False,'sshUsed':False,'queueChanged':False,'productionTouched':False,'pythonMockTests':37,'nodePolicyMockTests':5,'dummyNodeFixtureIncludes':['CJS/ESM exports denial before original network API','exact Node runner argv and inherited child guard'],'results':results,'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in out.iterdir()}}
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'output':str(out),'exit':max(v['exit']for v in results)}));return max(v['exit']for v in results)
if __name__=='__main__':raise SystemExit(main())
