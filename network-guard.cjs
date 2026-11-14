const net=require('node:net'),dns=require('node:dns'),fs=require('node:fs');
const root='/mnt/apps/peticao-final/.qt1';
const allowed=h=>['127.0.0.1','localhost','::1','[::1]'].includes(String(h));
function deny(kind){fs.appendFileSync(root+'/network-denials.jsonl',JSON.stringify({kind,at:Date.now()})+'\n');throw new Error('QA_EXTERNAL_NETWORK_BLOCKED:'+kind);}
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let a=args;if(Array.isArray(a[0]))a=a[0];
 if(a[0]&&typeof a[0]==='object'){
  if(a[0].path){if(!require('node:path').resolve(String(a[0].path)).startsWith(root+'/t/'))deny('unix_socket');}
  else if(!allowed(a[0].host||'localhost'))deny('tcp');
 }else if(typeof a[1]==='string'&&!allowed(a[1]))deny('tcp');
 return connect.apply(this,args);
};
const lookup=dns.lookup;dns.lookup=function(host,...args){if(!allowed(host))deny('dns');return lookup.call(this,host,...args);};
if(globalThis.fetch){const fetch=globalThis.fetch;globalThis.fetch=function(input,...args){if(!allowed(new URL(typeof input==='string'||input instanceof URL?input:input.url).hostname))deny('fetch');return fetch.call(this,input,...args);};}
