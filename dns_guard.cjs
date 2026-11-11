'use strict';
// Enumerate actual builtin surfaces and inherited Resolver methods; never call a resolver.
const guarded=new WeakSet();
const selected=name=>/^(?:lookup|resolve)/.test(name)||name==='reverse'||name==='setServers';
function installDns(dns,block){
 const installed=[],visited=new WeakSet();
 function deny(label,promise){
  if(!promise)return block(label);
  try{block(label);}catch(error){return Promise.reject(error);}
  return Promise.reject(Error('QA_DNS_DENY_MUST_THROW'));
 }
 function walk(target,promise,label){
  for(let object=target;object&&object!==Object.prototype;object=Object.getPrototypeOf(object)){
   if(visited.has(object))continue;visited.add(object);
   for(const name of Object.getOwnPropertyNames(object)){
    const desc=Object.getOwnPropertyDescriptor(object,name);
    if(!selected(name)||!desc||typeof desc.value!=='function')continue;
    const asyncResult=promise&&name!=='setServers';
    const fn=function(...args){
     if(name==='lookup'&&args[0]==='127.0.0.1'){
      let opts=args[1];const cb=typeof opts==='function'?opts:args[2];if(typeof opts==='function'||opts===undefined)opts={};
      const family=typeof opts==='number'?opts:opts?.family;
      if(family!==undefined&&family!==0&&family!==4)return deny(label+'-'+name,asyncResult);
      const answer=opts?.all?[{address:'127.0.0.1',family:4}]:{address:'127.0.0.1',family:4};
      if(promise)return Promise.resolve(answer);
      if(typeof cb!=='function')return deny(label+'-'+name,false);
      process.nextTick(()=>opts?.all?cb(null,answer):cb(null,answer.address,answer.family));return;
     }
     return deny(label+'-'+name,asyncResult);
    };
    guarded.add(fn);Object.defineProperty(object,name,{...desc,value:fn});installed.push(label+'.'+name);
   }
  }
 }
 walk(dns,false,'dns');walk(dns.promises,true,'dns.promises');
 if(dns.Resolver)walk(dns.Resolver.prototype,false,'dns.Resolver');
 if(dns.promises?.Resolver)walk(dns.promises.Resolver.prototype,true,'dns.promises.Resolver');
 return installed;
}
module.exports={installDns,isGuarded:fn=>guarded.has(fn),selected};
