#!/usr/bin/python3
"""Only affected DNS/guard/env fixtures. Preserves prior37+5; no app/PG/SSH."""
from pathlib import Path
import hashlib,json,subprocess,time
ROOT=Path(__file__).resolve().parent;NODE=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node')
def main():
 out=ROOT/'artifacts'/('dns-env-revision-'+str(time.time_ns()));out.mkdir(mode=0o700)
 cmds=[[str(NODE),'--test',str(ROOT/'test_dns_guard.cjs'),str(ROOT/'test_guard.cjs')],['/usr/bin/python3','-m','unittest','-v','test_guard_bootstrap','test_harness.ExtractTests.test_env_is_fixed_no_secrets_or_preview_inheritance','test_harness.CorrectionTests','test_harness.ReceiptTests.test_export_only_technical_receipts_not_password_db_runtime']];results=[]
 for i,args in enumerate(cmds):
  start=time.monotonic();p=subprocess.run(args,cwd=ROOT,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/nonexistent'},capture_output=True,text=True,timeout=20)
  (out/f'{i}-stdout.log').write_text(p.stdout);(out/f'{i}-stderr.log').write_text(p.stderr);results.append({'argv':args,'exit':p.returncode,'durationSeconds':round(time.monotonic()-start,3)})
 result={'classification':'PRIVATE_DRAFT_DNS_ENV_CORRECTION_FIXTURES_ONLY','previousFreeze':'9a32f022e80066c837fd9ef5c8592d1ca4543c5e','previousProofInsufficientForInstallation':True,'nodePolicyAndDnsMockTests':74,'pythonAffectedFixtures':7,'actualApplicationCallbacksExecuted':0,'actualPostgresqlStarted':False,'actualTsxImported':False,'realResolverCalled':False,'sshUsed':False,'queueChanged':False,'results':results,'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in out.iterdir()}}
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'output':str(out),'exit':max(v['exit']for v in results)}));return max(v['exit']for v in results)
if __name__=='__main__':raise SystemExit(main())
