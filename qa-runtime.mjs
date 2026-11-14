import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const deps=root+'/source/site';
const port=54524, appPort=3184;
for(const name of ['pg-http','e','t','outbox'])mkdirSync(root+'/'+name,{recursive:true,mode:0o700});
const {default:EmbeddedPostgres}=await import(deps+'/node_modules/embedded-postgres/dist/index.js');
if(existsSync(root+'/pg-http/PG_VERSION'))throw Error('Existing QA database refused; preserve previous run and issue a new attempt');
const pg=new EmbeddedPostgres({databaseDir:root+'/pg-http',user:'peticao',password:'peticao',port,persistent:true,postgresFlags:['-k',root+'/t','-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
await pg.initialise();await pg.start();await pg.createDatabase('peticao');
let app,stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;if(app&&app.exitCode===null){app.kill('SIGTERM');await new Promise(r=>app.once('exit',r));}await pg.stop();process.exit(code);}
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
const common={HOME:root+'/e',XDG_CACHE_HOME:root+'/c',XDG_CONFIG_HOME:root+'/g',XDG_RUNTIME_DIR:root+'/r',TMP:root+'/t',TEMP:root+'/t',PATH:'/usr/local/bin:/usr/bin:/bin',TMPDIR:root+'/t',DATABASE_URL:'postgres://peticao:peticao@127.0.0.1:'+port+'/peticao',HASH_PEPPER:'UI-AUDIT-ONLY-PEPPER-NOT-PRODUCTION-20261113',CPF_CACHE_ENCRYPTION_KEY:'c'.repeat(64),ADMIN_PASSWORD:'QaOnlyPassword-20261113',MAIL_PROVIDER:'dev',MAIL_PROVIDERS:'dev',MAIL_OUTBOX_DIR:root+'/outbox',WHATSAPP_ENABLED:'0',SECRETS_DIR:root+'/e',CREDENTIALS_DIRECTORY:root+'/e',PETICAO_CONFIG_DIR:root+'/e',ADMIN_PASSWORD_FILE:root+'/e/missing.hash',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require='+root+'/network-guard.cjs --max-old-space-size=1536'};
async function child(args,env,logName){const log=createWriteStream(root+'/'+logName,{mode:0o600});const p=spawn(process.execPath,args,{cwd:deps,env,stdio:['ignore','pipe','pipe']});p.stdout.pipe(log);p.stderr.pipe(log);const code=await new Promise(r=>p.once('exit',r));await new Promise(r=>log.end(r));if(code!==0)throw Error(logName+' failed; inspect private evidence');}
try{
 const files=['ratelimit.test.ts','admin-reset-login-limit.test.ts','admin-users.test.ts','admin-reset-requests.test.ts','admin-login.test.ts','signature-explorer-admin-client.test.ts','signature-explorer-admin-contract.test.ts','signature-explorer-csv.test.ts'];
 await child([deps+'/node_modules/tsx/dist/cli.mjs','--test','--test-concurrency=1',...files.map(n=>deps+'/src/lib/'+n)],{...common,NODE_ENV:'test'},'backend-tests.log');
 await child([deps+'/node_modules/tsx/dist/cli.mjs','--tsconfig',deps+'/tsconfig.json',root+'/fixture.ts'],{...common,NODE_ENV:'test'},'fixture.log');
 const fixture=JSON.parse(readFileSync(root+'/fixture.private.json','utf8'));
 const env={...common,NODE_ENV:'production',DATABASE_URL:'postgres://qa_ui_runtime:qa-local-only@127.0.0.1:'+port+'/peticao',PETICAO_RUNTIME:'admin-v2',MAIL_QUEUE_SCOPE:'v2',DB_BOOTSTRAP_MODE:'verify',DB_SCHEMA_SHA256:fixture.schemaSha256,BATCH_LEGACY_CONTROL:'admin-v2',APP_URL:'http://127.0.0.1:'+appPort,ADMIN_URL:'http://127.0.0.1:'+appPort,NCPF_ENABLED:'1',NCPF_QUERY_ENABLED:'0',NCPF_ACCEPT_NEW:'1',MATERIALS_LIBRARY_ENABLED:'1'};
 const log=createWriteStream(root+'/runtime.log',{mode:0o600});
 app=spawn(process.execPath,[root+'/runtime/node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(appPort)],{cwd:root+'/runtime',env,stdio:['ignore','pipe','pipe']});app.stdout.pipe(log);app.stderr.pipe(log);
 writeFileSync(root+'/processes.json',JSON.stringify({supervisor:process.pid,next:app.pid,appPort,dbPort:port,fictionalOnly:true}),{mode:0o600});
 app.once('exit',code=>{if(!stopping)stop(code??1)});
 console.log(JSON.stringify({stage:'backend-tests-and-seed-complete; compiled runtime starting',appPort,dbPort:port,fixtureFile:root+'/fixture.private.json',realMail:false}));
}catch(e){console.error(String(e));await stop(1);}
