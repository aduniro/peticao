/** Source-c472 offline build guard; no old shell/unit/profile executor. */
import assert from 'node:assert/strict';
import {appendFileSync,lstatSync,readdirSync,realpathSync} from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';import net from 'node:net';import tls from 'node:tls';import dgram from 'node:dgram';
import {syncBuiltinESMExports} from 'node:module';
export function install(){
 assert.equal(process.env.NODE_ENV,'production');assert.equal(process.env.PREVIEW_MODE,undefined);assert.equal(process.env.ADMIN_NO_PASSWORD,undefined);
 assert.equal(process.env.MAIL_PROVIDER,'dev');assert.equal(process.env.MAIL_PROVIDERS,'dev');assert.equal(process.env.WHATSAPP_ENABLED,'0');assert.equal(process.env.CRON_SECRET,'');
 assert.ok(['postgres://build:build@127.0.0.1:1/build','postgres://build_only:build_only@127.0.0.1:1/build_only'].includes(process.env.DATABASE_URL));
 const tmp=process.env.TMPDIR;assert.ok(tmp&&!path.isAbsolute(tmp));const dir=path.join(process.cwd(),tmp);assert.equal(realpathSync(dir),dir);const i=lstatSync(dir);assert.equal(i.uid,process.getuid());assert.equal(i.mode&0o777,0o700);
 for(const key of ['SECRETS_DIR','PETICAO_CONFIG_DIR','CREDENTIALS_DIRECTORY','GEO_DIR']){const p=process.env[key];assert.ok(p);assert.equal(readdirSync(p).length,0);}
 const deny=kind=>{appendFileSync(path.join(dir,'build-guard.jsonl'),JSON.stringify({kind})+'\n',{mode:0o600});throw Error('OFFLINE_BUILD_NETWORK_FORBIDDEN');};
 for(const v of [dns,dns.promises])for(const k of Object.keys(v))if(k.startsWith('resolve')||['reverse','lookup','lookupService'].includes(k))v[k]=()=>deny('dns');
 const prototypes=new Set();for(const Constructor of [dns.Resolver,dns.promises.Resolver])for(let p=Constructor.prototype;p&&p!==Object.prototype;p=Object.getPrototypeOf(p))prototypes.add(p);for(const p of prototypes)for(const k of Object.getOwnPropertyNames(p))if(k.startsWith('resolve')||k==='reverse')p[k]=()=>deny('dns-resolver');
 const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){let first=args[0];if(Array.isArray(first))first=first[0];const socket=first&&typeof first==='object'?first.path:typeof first==='string'&&!/^\d+$/.test(first)?first:null;if(socket){const p=path.resolve(socket);try{if(p.startsWith(dir+path.sep)&&realpathSync(path.dirname(p))===path.dirname(p))return connect.apply(this,args);}catch{}}return deny('tcp-or-ipc');};
 tls.connect=()=>deny('tls');dgram.Socket.prototype.send=()=>deny('udp');const fetch0=globalThis.fetch;globalThis.fetch=function(input,init){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(['data:','blob:'].includes(u.protocol))return fetch0.call(this,input,init);return deny('fetch');};syncBuiltinESMExports();
 appendFileSync(path.join(dir,'build-guard.jsonl'),JSON.stringify({kind:'installed'})+'\n',{mode:0o600});
}
if((process.env.NODE_OPTIONS||'').split(/\s+/).includes('--import=/opt/peticao-dev-profile-tools-v1/qa/build-guard.mjs'))install();
