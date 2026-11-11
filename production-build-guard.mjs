import assert from "node:assert/strict";
import { appendFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";

const ROOT="/mnt/apps/peticao-final/_ops/qa-materials-app-http-20261111";
const run=process.env.PRODUCTION_PROFILE_RUN;
assert.equal(process.env.PRODUCTION_PROFILE_ROOT,ROOT);
assert.ok(run?.startsWith(ROOT+"/runs/"));
assert.equal(realpathSync(run),run);
assert.equal(statSync(run).uid,process.getuid());
assert.equal(statSync(run).mode&0o077,0);
assert.equal(process.env.NODE_ENV,"production");
assert.equal(process.env.PREVIEW_MODE,undefined);
assert.equal(process.env.ADMIN_NO_PASSWORD,undefined);
assert.equal(process.env.MAIL_PROVIDER,"dev");
assert.equal(process.env.MAIL_PROVIDERS,"dev");
assert.equal(process.env.DATABASE_URL,"postgres://build_only:build_only@127.0.0.1:1/build_only");
assert.equal(process.env.CRON_SECRET,"");
assert.equal(process.env.WHATSAPP_ENABLED,"0");
for(const key of ["HOME","SECRETS_DIR","PETICAO_CONFIG_DIR","CREDENTIALS_DIRECTORY","GEO_DIR"])
 assert.equal(process.env[key],run+"/empty");
assert.equal(process.env.ADMIN_PASSWORD_FILE,run+"/empty/admin-password-never-present.hash");
const record=(kind,transport)=>appendFileSync(run+"/guard.jsonl",JSON.stringify({kind,pid:process.pid,transport})+"\n",{mode:0o600});
const deny=kind=>{record("denied",kind);throw Error("PRODUCTION_BUILD_NETWORK_FORBIDDEN:"+kind);};
for(const target of [dns,dns.promises])for(const key of Object.keys(target))
 if(key.startsWith("resolve")||["reverse","lookup","lookupService"].includes(key))target[key]=()=>deny("dns:"+key);
const prototypes=new Set();
for(const Constructor of [dns.Resolver,dns.promises.Resolver])for(let p=Constructor.prototype;p&&p!==Object.prototype;p=Object.getPrototypeOf(p))prototypes.add(p);
for(const p of prototypes)for(const k of Object.getOwnPropertyNames(p))if(k.startsWith("resolve")||k==="reverse")p[k]=()=>deny("dns:resolver:"+k);
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let v=args[0];if(Array.isArray(v))v=v[0];
 const socket=v&&typeof v==="object"?v.path:typeof v==="string"&&v.startsWith("/")?v:null;
 if(socket&&process.env.TMPDIR===run+"/tmp"){
  const absolute=path.resolve(String(socket));
  try {
   const parent=path.dirname(absolute),realParent=realpathSync(parent);
   if(absolute.startsWith(run+"/tmp/")&&realParent===parent&&(realParent===run+"/tmp"||realParent.startsWith(run+"/tmp/")))
    return original.apply(this,args);
  } catch { /* Missing/noncanonical IPC parents stay denied. */ }
 }
 return deny("tcp_or_unapproved_ipc");
};
tls.connect=()=>deny("tls_smtp");
dgram.Socket.prototype.send=()=>deny("udp");
const fetch0=globalThis.fetch;
globalThis.fetch=function(input,init){
 const url=new URL(typeof input==="string"||input instanceof URL?input:input.url);
 if(["data:","blob:"].includes(url.protocol))return fetch0.call(this,input,init);
 return deny("fetch");
};
syncBuiltinESMExports();record("installed","production_no_preview_node_dns_tcp_tls_udp_fetch_guard");
