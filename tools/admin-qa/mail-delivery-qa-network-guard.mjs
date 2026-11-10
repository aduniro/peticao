/** Preload ONLY in the isolated compiled Next QA process. Never application code. */
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import dns from "node:dns";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
assert.equal(process.env.MAIL_PROVIDER,"dev");assert.equal(process.env.MAIL_PROVIDERS,"dev");
assert.equal(process.env.QA_SITE_DIR,"/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");
const output=process.env.QA_OUTPUT_DIR;assert.ok(output?.startsWith("/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-delivery-compiled-"));
assert.equal(process.env.QA_ALLOWED_NET_PORTS,"54390,3077,3078");
const allowedPorts=new Set(process.env.QA_ALLOWED_NET_PORTS.split(",").map(Number)),local=new Set(["127.0.0.1","::1","[::1]","localhost"]),log=output+"/next-network-guard.jsonl";
const record=(kind,extra={})=>appendFileSync(log,JSON.stringify({kind,pid:process.pid,...extra})+"\n",{mode:0o600});
const deny=kind=>{record("denied",{transport:kind});throw new Error("QA_EXTERNAL_NETWORK_FORBIDDEN:"+kind);};
for(const target of[dns,dns.promises])for(const key of Object.keys(target))if(key.startsWith("resolve")||key==="reverse"||key==="lookupService")target[key]=()=>deny("dns:"+key);
for(const target of[dns,dns.promises]){const lookup=target.lookup;target.lookup=function(host,...args){if(!local.has(String(host)))return deny("dns:lookup");return lookup.call(this,host,...args);};}
const resolverPrototypes=new Set();for(const Constructor of[dns.Resolver,dns.promises.Resolver])for(let prototype=Constructor.prototype;prototype&&prototype!==Object.prototype;prototype=Object.getPrototypeOf(prototype))resolverPrototypes.add(prototype);
for(const prototype of resolverPrototypes)for(const key of Object.getOwnPropertyNames(prototype))if(key.startsWith("resolve")||key==="reverse")prototype[key]=()=>deny("dns:resolver:"+key);
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let options=args[0];if(Array.isArray(options))options=options[0];const port=Number(options&&typeof options==="object"?options.port:options),host=String(options&&typeof options==="object"?options.host??"localhost":typeof args[1]==="string"?args[1]:"localhost");if(!local.has(host)||!allowedPorts.has(port))return deny("tcp");return connect.apply(this,args);};
const request=globalThis.fetch;
globalThis.fetch=function(input,init){const url=new URL(typeof input==="string"||input instanceof URL?input:input.url);if(["data:","blob:"].includes(url.protocol))return request.call(this,input,init);if(!["http:","https:"].includes(url.protocol)||!local.has(url.hostname)||!allowedPorts.has(Number(url.port|| (url.protocol==="https:"?443:80))))return deny("fetch");return request.call(this,input,init);};
syncBuiltinESMExports();record("installed",{allowedPorts:[...allowedPorts],blocksExternalFetch:true,blocksDnsResolvers:true,blocksOtherTcp:true});
