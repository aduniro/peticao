/** Fixed per-job configuration. Import has no filesystem/process effects. */
import {mkdirSync,openSync,writeSync,fsyncSync,closeSync,lstatSync,readFileSync} from 'node:fs';
import {join,relative,isAbsolute,sep} from 'node:path';
export const TOOLS='/opt/peticao-dev-profile-tools-v1';
export const APP_PORT=28452, PG_PORT=28451, BASE='http://127.0.0.1:28452';
export const COUNTS=Object.freeze({backend:43,http:7,browser:40,maps:2,http_reset:8});
export function config(){
 const root=process.cwd();
 for(const [key,value] of Object.entries({PROFILE_TOOLS_ROOT:TOOLS,NODE:TOOLS+'/node20',PYTHON:TOOLS+'/python312/bin/python3.12',CHROMIUM:TOOLS+'/chromium/chrome-linux64/chrome',QA_ROOT:'private-qa',WHEELS_ROOT:TOOLS+'/python-wheels/site',PLAYWRIGHT_NODEJS_PATH:TOOLS+'/node20'}))
  if(process.env[key]!==value)throw Error('Fixed QA tool/environment binding absent');
 return {root,privateRoot:join(root,'private-qa'),site:join(root,'source/site'),compiled:join(root,'compiled'),tools:TOOLS,node:TOOLS+'/node20',python:TOOLS+'/python312/bin/python3.12',chromium:TOOLS+'/chromium/chrome-linux64/chrome'};
}
export function envFor(c,cwd,phase){
 const within=relative(c.root,cwd);if(isAbsolute(within)||within==='..'||within.startsWith('..'+sep))throw Error('Child cwd escapes job');
 const dir=name=>relative(cwd,join(c.privateRoot,name))||'.';
 return {PATH:TOOLS+':/usr/bin:/bin',LANG:'C.UTF-8',TZ:'UTC',HOME:dir('e'),TMPDIR:dir('t'),TMP:dir('t'),TEMP:dir('t'),XDG_CACHE_HOME:dir('c'),XDG_CONFIG_HOME:dir('g'),XDG_RUNTIME_DIR:dir('r'),PYTHONDONTWRITEBYTECODE:'1',NEXT_TELEMETRY_DISABLED:'1',PLAYWRIGHT_NODEJS_PATH:c.node,
  NODE_OPTIONS:'--require='+TOOLS+'/qa/network-guard.cjs --max-old-space-size=3072',
  PROFILE_TOOLS_ROOT:TOOLS,NODE:c.node,PYTHON:c.python,CHROMIUM:c.chromium,QA_ROOT:'private-qa',WHEELS_ROOT:TOOLS+'/python-wheels/site',
  NODE_ENV:phase==='app'?'production':'test',DATABASE_URL:'postgres://peticao:peticao@127.0.0.1:28451/peticao',HASH_PEPPER:'UI-AUDIT-ONLY-PEPPER-NOT-PRODUCTION-20261113',CPF_CACHE_ENCRYPTION_KEY:'c'.repeat(64),ADMIN_PASSWORD:'QaOnlyPassword-20261113',MAIL_PROVIDER:'dev',MAIL_PROVIDERS:'dev',MAIL_OUTBOX_DIR:relative(cwd,join(c.privateRoot,'outbox')),WHATSAPP_ENABLED:'0',CRON_SECRET:'',SECRETS_DIR:dir('e'),CREDENTIALS_DIRECTORY:dir('e'),PETICAO_CONFIG_DIR:dir('e'),ADMIN_PASSWORD_FILE:dir('e')+'/missing.hash'};
}
export function readJSON(path){const i=lstatSync(path);if(!i.isFile()||i.isSymbolicLink()||i.nlink!==1||i.uid!==process.getuid()||(i.mode&0o777)!==0o600||i.size>1048576)throw Error('Bounded private JSON required');return JSON.parse(readFileSync(path,'utf8'));}
export function writeJSON(path,value){const fd=openSync(path,'wx',0o600);try{const raw=Buffer.from(JSON.stringify(value)+'\n');if(raw.length>1048576)throw Error('Bounded private report required');let offset=0;while(offset<raw.length){const n=writeSync(fd,raw,offset,raw.length-offset);if(n<=0)throw Error('Private report write failed');offset+=n;}fsyncSync(fd);}finally{closeSync(fd);}}
export function mkdirPrivate(path){mkdirSync(path,{mode:0o700});}
