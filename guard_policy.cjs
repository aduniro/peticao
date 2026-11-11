'use strict';
const path=require('node:path');
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function classifyConnect(config,context,input){
 if(input.path!==undefined){
  const exact=path.join(config.tmpdir,'tsx-'+context.uid,String(context.ppid)+'.pipe');
  if(input.path===exact&&!context.pathHasSymlink(input.path))return 'expected-optional-cli-ipc-denial';
  return 'unexpected-denial';
 }
 if(input.host==='127.0.0.1'&&(Number(input.port)===config.dbPort||context.providerPorts.has(Number(input.port))))return 'allow';
 return 'unexpected-denial';
}
function nodeChildArgs(config){return ['--import',config.loader,'--test-concurrency=1','--test-name-pattern='+config.pattern,'--test-name-pattern='+config.pattern,config.testFile];}
function authorizeChild(config,context,method,command,args,options){
 if(options?.shell||options?.detached)return false;
 if(config.esbuildBinaries.includes(command)&&['spawn','execFileSync'].includes(method)){
  const expected=method==='spawn'?['--service='+config.esbuildVersion,'--ping']:['--service='+config.esbuildVersion];
  return equal(args,expected)&&context.pinnedFile(command)&&(!options?.cwd||options.cwd===config.site)&&options?.env===undefined&&options?.windowsHide===true&&(method!=='spawn'||equal(options?.stdio,['pipe','pipe','inherit']));
 }
 if(method==='spawn'&&command===config.node&&equal(args,nodeChildArgs(config))&&context.pinnedFile(command)){
  const expectedEnv={...context.environment,NODE_TEST_CONTEXT:'child-v8'};
  return equal(options?.env,expectedEnv)&&equal(options?.stdio,['pipe','pipe','pipe'])&&!options?.cwd;
 }
 return false;
}
function install(config,adapters){
 const records=adapters.record,net=adapters.net,cp=adapters.childProcess,context=adapters.context;
 const originalConnect=net.Socket.prototype.connect;
 net.Socket.prototype.connect=function(...args){let v=args[0];if(Array.isArray(v))v=v[0];const value=v&&typeof v==='object'?v:typeof v==='string'&&!/^\d+$/.test(v)?{path:v}:{port:v,host:args[1]};const category=classifyConnect(config,context,value);
  if(category!=='allow'){records({kind:'denial',category,transport:value.path?'ipc':'tcp'});const error=new Error('QA_GUARD_BLOCKED_'+category);error.code=category==='expected-optional-cli-ipc-denial'?'ENOENT':'EPERM';throw error;}
  records({kind:'allowed',transport:'fixture-tcp'});return originalConnect.apply(this,args);
 };
 for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']){
  const original=cp[method];if(typeof original!=='function')continue;
  cp[method]=function(command,args,options){if(!authorizeChild(config,context,method,command,args,options)){records({kind:'denial',category:'unexpected-denial',transport:'child-process'});throw Error('QA_CHILD_NOT_ALLOWED');}records({kind:'allowed',transport:'pinned-child',method});return original.call(this,command,args,options);};
 }
 return {nodeChildArgs:()=>nodeChildArgs(config)};
}
module.exports={classifyConnect,authorizeChild,nodeChildArgs,install};
