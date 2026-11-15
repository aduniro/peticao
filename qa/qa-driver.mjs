/** QA100 coordinator; fixed phases, reports private, no execution on import. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {config,envFor,readJSON,writeJSON,BASE,COUNTS} from './common.mjs';
import {launch,wait,stop} from './node-owned.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function backendCount(text){const counts={};for(const key of ['tests','pass','fail']){const rows=[...text.matchAll(new RegExp('^# '+key+' (\\d+)\\s*$','gm'))];assert.equal(rows.length,1);counts[key]=Number(rows[0][1]);}assert.deepEqual(counts,{tests:43,pass:43,fail:0});return 43;}
export function reportCount(report,count,status='ok'){assert.equal(report[status],status==='status'?'PASS':true);assert.equal(report.checks.length,count);if(report.pageErrors)assert.equal(report.pageErrors.length,0);if(report.blockedWrites)assert.equal(report.blockedWrites.length,0);return count;}
async function readiness(runtime,p){for(let i=0;i<1000;i++){if(runtime.ended)throw Error('Fixture runtime died before readiness');try{const f=readJSON(p+'/fixture.private.json');assert.equal(f.fictionalOnly,true);const r=await fetch(BASE+'/api/internal/ready',{headers:{cookie:'adm='+f.token},redirect:'error',signal:AbortSignal.timeout(1500)});if(r.status===200)return;}catch{}await pause(300);}throw Error('Fixture readiness deadline exceeded');}
export async function main(){
 process.umask(0o077);const c=config(),p=c.privateRoot,qa=c.tools+'/qa';assert.equal(process.version,'v20.19.2');let runtime,active,interrupted=false;
 const summary={version:1,counts:{backend:0,http:0,browser:0,maps:0,http_reset:0},passed:false,page_errors:0,blocked_writes:0,fixture_only:true,refreshed:false,cleanup:{runtime_stopped:false,forced:false,app_stopped:false,pg_stopped:false}};
 const signal=()=>{interrupted=true;active?.child.kill('SIGTERM');runtime?.child.kill('SIGTERM');};process.on('SIGTERM',signal);process.on('SIGINT',signal);
 async function stage(executable,args,name,timeout){assert.ok(!interrupted&&!runtime.ended);const handle=launch(executable,args,{cwd:c.root,env:envFor(c,c.root,'fixture'),log:p+'/'+name+'.log'});active=handle;try{const r=await Promise.race([wait(handle,timeout),runtime.done.then(()=>{throw Error('Runtime died during QA');})]);assert.ok(r.code===0&&!r.signal&&!r.logError&&!r.spawnError);assert.ok(!interrupted&&!runtime.ended);}finally{if(!handle.ended){const r=await stop(handle);if(r.forced)throw Error('Forced QA child stop');}if(active===handle)active=null;}}
 try{
  runtime=launch(c.node,[qa+'/qa-runtime.mjs'],{cwd:c.root,env:envFor(c,c.root,'fixture'),log:p+'/supervisor.log'});
  await readiness(runtime,p);summary.counts.backend=backendCount(readFileSync(p+'/backend-tests.log','utf8'));
  await stage(c.node,[qa+'/backend-smoke.mjs'],'backend-smoke',60000);summary.counts.http=reportCount(readJSON(p+'/BACKEND-SMOKE.json'),7);
  await stage(c.python,['-I','-S','-B',qa+'/browser-bootstrap.py','browser40','--base',BASE,'--mode','compiled-next','--cookies-file',p+'/fixture.private.json','--chromium',c.chromium,'--output-dir',p+'/results/browser40'],'browser40',420000);
  const browser=readJSON(p+'/results/browser40/RESULTADO.json');summary.page_errors+=browser.pageErrors?.length||0;summary.blocked_writes+=browser.blockedWrites?.length||0;summary.counts.browser=reportCount(browser,40,'status');
  await stage(c.python,['-I','-S','-B',qa+'/browser-bootstrap.py','maps2','--base',BASE,'--cookies-file',p+'/fixture.private.json','--chromium',c.chromium,'--output-dir',p+'/results/maps2'],'maps2',180000);
  const maps=readJSON(p+'/results/maps2/RESULTADO.json');summary.page_errors+=maps.pageErrors?.length||0;assert.equal(maps.explorerMocked,false);summary.counts.maps=reportCount(maps,2);
  // This final mutation revokes the original synthetic cookie: browsers first.
  await stage(c.node,[qa+'/http-regression.mjs'],'http-reset',90000);summary.counts.http_reset=reportCount(readJSON(p+'/HTTP-REGRESSION.json'),8);
  const before=readJSON(p+'/fixture.private.json').token;
  await stage(c.node,[qa+'/refresh-fixture-session.mjs'],'refresh-session',30000);
  summary.refreshed=readJSON(p+'/fixture.private.json').token!==before;assert.equal(summary.refreshed,true);
  assert.deepEqual(summary.counts,COUNTS);summary.passed=true;
 }catch{summary.passed=false;}finally{
  try{const result=await stop(runtime);const drain=readJSON(p+'/RUNTIME-DRAIN.json');assert.deepEqual(Object.keys(drain).sort(),['app_stopped','forced','pg_stopped','version']);assert.equal(drain.version,1);
   summary.cleanup={runtime_stopped:!runtime||runtime.ended,forced:!!(result.forced||result.logError||result.spawnError||drain.forced),app_stopped:drain.app_stopped===true,pg_stopped:drain.pg_stopped===true};
   if(result.code!==0||result.signal||summary.cleanup.forced||!summary.cleanup.app_stopped||!summary.cleanup.pg_stopped)summary.passed=false;
  }catch{summary.passed=false;summary.cleanup.forced=true;}
  process.off('SIGTERM',signal);process.off('SIGINT',signal);
  writeJSON(p+'/QA-SUMMARY.json',summary);
  // No cookie/fixture/path/error text leaves private QA logs.
  console.log(JSON.stringify({counts:summary.counts,passed:summary.passed,fixture_only:true}));
  if(!summary.passed)process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
