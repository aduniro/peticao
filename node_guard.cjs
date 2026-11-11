'use strict';
// Application QA only: cooperative Node API guard, not an OS sandbox.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const net=require('node:net'),cp=require('node:child_process'),moduleApi=require('node:module');
const policy=require('./guard_policy.cjs');
function canonical(p){if(!path.isAbsolute(p))return false;let cur=path.parse(p).root;for(const part of p.slice(cur.length).split('/')){cur=path.join(cur,part);try{if(fs.lstatSync(cur).isSymbolicLink())return false;}catch(e){if(e.code!=='ENOENT')throw e;}}return path.normalize(p)===p;}
const location=process.env.QA_GUARD_CONFIG;
if(!location||!canonical(location))throw Error('QA_CONFIG_PATH');
const st=fs.statSync(location);if(st.uid!==process.getuid()||(st.mode&0o777)!==0o600)throw Error('QA_CONFIG_METADATA');
const config=JSON.parse(fs.readFileSync(location,'utf8'));
if(config.schema!==1||config.sourceCommit!=='93557bfba931f8f731807fc9f30f1d88dbafedf1'||config.dbPort!==55487||config.tsxVersion!=='4.23.15'||config.esbuildVersion!=='0.28.2'||!/^[a-f0-9]{12}$/.test(config.nonce)||!/^[a-f0-9]{32}$/.test(config.job))throw Error('QA_FIXED_CONFIG');
if(process.version!=='v20.19.2'||process.execPath!==config.node||process.env.NODE_ENV!=='test'||process.env.MAIL_PROVIDER!=='dev'||process.env.MAIL_PROVIDERS!=='dev'||process.env.DATABASE_URL!=='postgres://fixture_only:fixture_only@127.0.0.1:55487/fixture_only'||process.env.TMPDIR!==config.tmpdir)throw Error('QA_FIXED_ENV');
if(!canonical(config.site)||!canonical(config.tmpdir)||!canonical(config.log)||!config.log.startsWith(path.dirname(location)+'/'))throw Error('QA_PRIVATE_PATH');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const pinnedFile=p=>canonical(p)&&Object.hasOwn(config.pins,p)&&hash(p)===config.pins[p];
if(!pinnedFile(config.node)||!pinnedFile(config.loader)||!config.esbuildBinaries.every(pinnedFile))throw Error('QA_PIN_DRIFT');
const {threadId}=require('node:worker_threads');
function record(event){fs.appendFileSync(config.log,JSON.stringify({...event,pid:process.pid,ppid:process.ppid,threadId,job:config.job,nonce:config.nonce})+'\n',{mode:0o600});}
const context={uid:process.getuid(),ppid:process.ppid,environment:{...process.env},providerPorts:new Set(),pathHasSymlink:p=>!canonical(p),pinnedFile};
policy.install(config,{net,childProcess:cp,context,record});
const block=transport=>{record({kind:'denial',category:'unexpected-denial',transport});throw Error('QA_NETWORK_BLOCKED_'+transport);};
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){const v=args[0];const opts=typeof v==='object'&&v!==null?v:{port:v,host:args[1]};if(opts.port!==0||opts.host!=='127.0.0.1'||opts.path!==undefined||context.providerPorts.size>=5)return block('listener');
 this.once('listening',()=>{const a=this.address();if(!a||typeof a==='string'||a.address!=='127.0.0.1')return block('listener-address');context.providerPorts.add(a.port);record({kind:'allowed',transport:'synthetic-listener',port:a.port});});return listen.apply(this,args);};
const dns=require('node:dns');dns.lookup=function(host,opts,cb){if(typeof opts==='function'){cb=opts;opts={};}if(host!=='127.0.0.1'||typeof cb!=='function')return block('dns');process.nextTick(()=>cb(null,...(opts?.all?[[{address:host,family:4}]]:[host,4])));};
for(const key of Object.keys(dns)){if(typeof dns[key]==='function'&&key!=='lookup'&&/^(resolve|reverse|lookupService|setServers)/.test(key))dns[key]=()=>block('dns-'+key);}
for(const key of ['lookup','resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveTxt','resolveSrv','reverse','setServers'])if(typeof dns.promises[key]==='function')dns.promises[key]=()=>Promise.reject((()=>{try{block('dns-promise-'+key);}catch(e){return e;}})());
for(const Klass of[dns.Resolver,dns.promises.Resolver])if(Klass)for(const key of Object.getOwnPropertyNames(Klass.prototype))if(/^(resolve|reverse|setServers)/.test(key)&&typeof Klass.prototype[key]==='function')Klass.prototype[key]=()=>block('dns-resolver-'+key);
const tls=require('node:tls');tls.connect=()=>block('tls');const dgram=require('node:dgram');dgram.createSocket=()=>block('udp');
const originalFetch=globalThis.fetch;globalThis.fetch=function(input,init){let u;try{u=new URL(typeof input==='string'||input instanceof URL?input:input.url);}catch{return block('fetch-url');}if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!context.providerPorts.has(Number(u.port))||u.username||u.password)return block('fetch');return originalFetch.call(this,input,{...init,redirect:'error'});};
moduleApi.syncBuiltinESMExports();record({kind:'guard-installed',nodeVersion:process.version,nodeTestContext:process.env.NODE_TEST_CONTEXT||null,ipcPolicy:'all-blocked',cgroup:config.cgroup});
