#!/usr/bin/python3
"""Only fake files/SQLite and mock services. No SSH/app/PG/HTTP or actual apply."""
from pathlib import Path
import hashlib,json,subprocess,time
ROOT=Path(__file__).resolve().parent
def main():
 out=ROOT/'evidence'/('revision2-mocks-'+str(time.time_ns()));out.mkdir(mode=0o700,parents=True)
 args=['/usr/bin/python3','-m','unittest','discover','-s',str(ROOT/'tests'),'-v'];started=time.monotonic();p=subprocess.run(args,cwd=ROOT,env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=15)
 (out/'stdout.log').write_text(p.stdout);(out/'stderr.log').write_text(p.stderr)
 proof={'classification':'PRIVATE_OPERATOR_REV2_MOCKS_ONLY','baseCommit':'d52d817d041d3848c490b1d4640bf8de7d616c38','exit':p.returncode,'distinctTests':34,'inheritedTests':24,'newIncidentTests':10,'durationSeconds':round(time.monotonic()-started,3),'twoConnectionsUsedOnlyFictitiousSQLite':True,'actualSystemctl':False,'actualApply':False,'ssh':False,'postgres':False,'application':False,'remoteStagingVerified':False,'appReleaseReady':False,'argv':args,'files':{f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in out.iterdir()}}
 (out/'result.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'output':str(out),'exit':p.returncode}));return p.returncode
if __name__=='__main__':raise SystemExit(main())
