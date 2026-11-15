/** Fixed direct PG/App ownership; no embedded loader/download or host service. */
import {writeFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {config,envFor,writeJSON,PG_PORT,APP_PORT} from './common.mjs';
import {launch,wait,stop} from './node-owned.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function main(){
 process.umask(0o077);const c=config(),p=c.privateRoot,qa=c.tools+'/qa';let postgres,app,active,stopping=false,forced=false;
 let release;const completed=new Promise(r=>release=r);
 async function shutdown(code){
  if(stopping)return;stopping=true;
  try{const current=await stop(active),a=await stop(app),g=await stop(postgres);forced=current.forced||current.logError||current.spawnError||current.code!==0||current.signal||a.forced||g.forced||a.logError||g.logError||a.spawnError||g.spawnError||a.code!==0||g.code!==0||a.signal||g.signal;
   writeJSON(p+'/RUNTIME-DRAIN.json',{version:1,app_stopped:!app||app.ended,pg_stopped:!postgres||postgres.ended,forced:!!forced});
  }catch{forced=true;}
  process.exitCode=code||forced?1:0;release();
 }
 async function stage(executable,args,options,timeout){if(stopping)throw Error('Stopping QA runtime');const handle=launch(executable,args,options);active=handle;try{const r=await wait(handle,timeout);if(r.code!==0||r.signal||r.spawnError||r.logError)throw Error('Private QA fixture stage failed');}finally{if(!handle.ended)await stop(handle);if(active===handle)active=null;}}
 const term=()=>{void shutdown(0);};process.on('SIGTERM',term);process.on('SIGINT',term);
 try{
  if(existsSync(p+'/pg/PG_VERSION'))throw Error('Existing per-job PG refused');
  writeFileSync(p+'/pg-password','peticao\n',{mode:0o600,flag:'wx'});
  const env=envFor(c,c.root,'fixture');
  await stage(c.tools+'/postgres/bin/initdb',['--pgdata=private-qa/pg','--username=peticao','--pwfile=private-qa/pg-password','--auth-local=trust','--auth-host=scram-sha-256','--encoding=UTF8','--locale=C.UTF-8'],{cwd:c.root,env,log:p+'/initdb.log'},60000);
  if(stopping)throw Error('Stopped before fixture PG spawn');
  postgres=launch(c.tools+'/postgres/bin/postgres',['-D','private-qa/pg','-h','127.0.0.1','-p',String(PG_PORT),'-c','unix_socket_directories='],{cwd:c.root,env,log:p+'/postgres.log'});
  const {default:pg}=await import(pathToFileURL(c.site+'/node_modules/pg/lib/index.js'));
  let ready=false;for(let i=0;i<300;i++){if(stopping||postgres.ended)throw Error('Fixture PG stopped');const pool=new pg.Pool({connectionString:'postgres://peticao:peticao@127.0.0.1:'+PG_PORT+'/postgres',connectionTimeoutMillis:1000});try{await pool.query('SELECT 1');await pool.query('CREATE DATABASE peticao');ready=true;break;}catch{await pause(100);}finally{await pool.end();}}
  if(!ready)throw Error('Fixture PG readiness failed');
  const tests=['ratelimit.test.ts','admin-reset-login-limit.test.ts','admin-users.test.ts','admin-reset-requests.test.ts','admin-login.test.ts','signature-explorer-admin-client.test.ts','signature-explorer-admin-contract.test.ts','signature-explorer-csv.test.ts'];
  await stage(c.node,[c.site+'/node_modules/tsx/dist/cli.mjs','--tsconfig',c.site+'/tsconfig.json','--test','--test-concurrency=1',...tests.map(n=>c.site+'/src/lib/'+n)],{cwd:c.site,env:envFor(c,c.site,'test'),log:p+'/backend-tests.log'},300000);
  await stage(c.node,[c.site+'/node_modules/tsx/dist/cli.mjs','--tsconfig',c.site+'/tsconfig.json',qa+'/fixture.ts'],{cwd:c.root,env,log:p+'/fixture.log'},90000);
  const {readJSON}=await import('./common.mjs');const fixture=readJSON(p+'/fixture.private.json');
  const appEnv={...envFor(c,c.compiled,'app'),DATABASE_URL:'postgres://qa_ui_runtime:qa-local-only@127.0.0.1:'+PG_PORT+'/peticao',PETICAO_RUNTIME:'admin-v2',MAIL_QUEUE_SCOPE:'v2',DB_BOOTSTRAP_MODE:'verify',DB_SCHEMA_SHA256:fixture.schemaSha256,BATCH_LEGACY_CONTROL:'admin-v2',APP_URL:'http://127.0.0.1:'+APP_PORT,ADMIN_URL:'http://127.0.0.1:'+APP_PORT,NCPF_ENABLED:'1',NCPF_QUERY_ENABLED:'0',NCPF_ACCEPT_NEW:'1',MATERIALS_LIBRARY_ENABLED:'1'};
  if(stopping)throw Error('Stopped before fixture app spawn');
  app=launch(c.node,[c.compiled+'/node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(APP_PORT)],{cwd:c.compiled,env:appEnv,log:p+'/runtime.log'});
  app.done.then(()=>{if(!stopping)void shutdown(1);});postgres.done.then(()=>{if(!stopping)void shutdown(1);});
  await completed;
 }catch{await shutdown(1);}finally{process.off('SIGTERM',term);process.off('SIGINT',term);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
