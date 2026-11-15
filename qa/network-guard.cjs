/** Approved --require preload only. Known guards complement PrivateNetwork. */
function install(){
 const net=require('node:net'),dns=require('node:dns'),tls=require('node:tls'),dgram=require('node:dgram'),fs=require('node:fs'),path=require('node:path');
 const tmp=process.env.TMPDIR;if(!tmp||path.isAbsolute(tmp))throw Error('Relative private TMPDIR required');
 const target=path.join(process.cwd(),tmp),i=fs.lstatSync(target);if(!i.isDirectory()||i.isSymbolicLink()||(i.mode&0o777)!==0o700||i.uid!==process.getuid())throw Error('Owned private TMPDIR required');
 const log=path.join(target,'..','network-denials.jsonl'),allowed=h=>['127.0.0.1','localhost','::1','[::1]'].includes(String(h));
 const deny=kind=>{if(fs.existsSync(log)&&fs.statSync(log).size>1048576)throw Error('Private network denial budget exceeded');fs.appendFileSync(log,JSON.stringify({kind})+'\n',{mode:0o600});throw Error('QA_EXTERNAL_NETWORK_BLOCKED');};
 const prototypes=new Set();for(const C of [dns.Resolver,dns.promises.Resolver])for(let p=C.prototype;p&&p!==Object.prototype;p=Object.getPrototypeOf(p))prototypes.add(p);for(const p of prototypes)for(const k of Object.getOwnPropertyNames(p))if(k.startsWith('resolve')||k==='reverse')p[k]=()=>deny('dns');
 const connect=net.Socket.prototype.connect;
 net.Socket.prototype.connect=function(...args){let a=args;if(Array.isArray(a[0]))a=a[0];const first=a[0];if(first&&typeof first==='object'){if(first.path){const v=path.resolve(String(first.path));if(!(v.startsWith(target+path.sep)&&fs.realpathSync(path.dirname(v))===path.dirname(v)))return deny('unix');}else if(!allowed(first.host||'localhost'))return deny('tcp');}else if(typeof first==='string'&&!/^\d+$/.test(first)){const v=path.resolve(first);if(!v.startsWith(target+path.sep))return deny('unix');}else if(typeof a[1]==='string'&&!allowed(a[1]))return deny('tcp');return connect.apply(this,args);};
 const lookup=dns.lookup;dns.lookup=function(host,...args){if(!allowed(host))return deny('dns');return lookup.call(this,host,...args);};
 for(const v of [dns,dns.promises])for(const k of Object.keys(v))if(k.startsWith('resolve')||['reverse','lookupService'].includes(k))v[k]=()=>deny('dns');
 tls.connect=()=>deny('tls');dgram.Socket.prototype.send=()=>deny('udp');
 if(globalThis.fetch){const original=globalThis.fetch;globalThis.fetch=function(input,...args){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!allowed(u.hostname))return deny('fetch');return original.call(this,input,...args);};}
 require('node:module').syncBuiltinESMExports();
}
module.exports={install};
if((process.env.NODE_OPTIONS||'').split(/\s+/).includes('--require=/opt/peticao-dev-profile-tools-v1/qa/network-guard.cjs'))install();
