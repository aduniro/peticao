#!/usr/bin/python3
"""Run only local adapter mocks. No app/PG/SSH; all harness Popen calls are mocked."""
from pathlib import Path
import hashlib,json,subprocess,time
ROOT=Path(__file__).resolve().parent
def main():
 out=ROOT/'artifacts'/('mocks-'+str(time.time_ns()));out.mkdir(mode=0o700)
 args=['/usr/bin/python3','-m','unittest','discover','-s',str(ROOT/'tests'),'-v'];start=time.monotonic();result=subprocess.run(args,cwd=ROOT,env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=15)
 (out/'stdout.log').write_text(result.stdout);(out/'stderr.log').write_text(result.stderr)
 proof={'classification':'PRIVATE_ADAPTER_DRAFT_MOCKS_ONLY','exit':result.returncode,'mockTests':31,'durationSeconds':round(time.monotonic()-start,3),'argv':args,'appExecuted':False,'postgresStarted':False,'ssh':False,'queueModified':False,'installed':False,'runtimeRemoteStagingAttested':False,'testedKinds':['fixed admission','queue fence','exclusive marker/reconcile','external pin staging','exact five TAP/guard/PG synthetic receipts','outer exit and whole-cgroup collector gate','cancel/timeout with mocked Popen'],'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in out.iterdir()}}
 (out/'result.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'output':str(out),'exit':result.returncode}));return result.returncode
if __name__=='__main__':raise SystemExit(main())
