'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),test=require('node:test');
const ROOT=__dirname;
function setup(overrides={}){
 const run=ROOT+'/runs/012345abcdef',records=[],calls=[];
 const env={RUNTIME_SMOKE_RUN:run,NODE_ENV:'production',DATABASE_URL:'postgres://fixture_only:fixture_only@127.0.0.1:55498/fixture_only',FUNCTIONAL_PGDATA:'/var/lib/postgresql/data',MAIL_PROVIDER:'dev',MAIL_PROVIDERS:'dev',CRON_SECRET:'',WHATSAPP_ENABLED:'0',RECIPIENTS:'',APPROVER_EMAIL:'',SIGNER:'none',GOVBR_BASE_ENABLED:'0',GOVBR_BASE_VALIDATION_ENABLED:'0',GOVBR_BASE_VALIDATOR_URL:'',BATCH_PACKAGE_ENABLED:'0',DOCUMENT_REFERENCE_ENABLED:'0',DOCUMENT_REFERENCE_ORIGIN:'',DOCUMENT_VERIFICATION_PUBLIC:'0',BATCH_A1_ENABLED:'0',MAIL_OUTBOX_DIR:run+'/mail-outbox',RUNTIME_SMOKE_PORT:'31398',PRESIDENT_OWN_ENABLED:'0',MATERIALS_LIBRARY_ENABLED:'1',...overrides};
 for(const key of ['HOME','SECRETS_DIR','PETICAO_CONFIG_DIR','CREDENTIALS_DIRECTORY','GEO_DIR'])env[key]=run+'/empty';
 class Socket{};Socket.prototype.connect=function(...a){calls.push(['connect',...a]);return 'allowed';};class Server{};Server.prototype.listen=function(...a){calls.push(['listen',...a]);return 'allowed';};
 class Datagram{};Datagram.prototype.send=()=>calls.push('udp');Datagram.prototype.bind=()=>calls.push('bind');
 class Resolver{};Resolver.prototype.resolve=()=>calls.push('dns');
 const dns={resolve:()=>calls.push('dns'),lookup:()=>calls.push('dns'),promises:{resolve:()=>calls.push('dns'),Resolver},Resolver};
 const net={Socket,Server},cp=Object.fromEntries(['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'].map(k=>[k,()=>calls.push('child')]));
 const context={assert,process:{env,getuid:()=>1000,pid:123,nextTick:fn=>fn()},realpathSync:p=>p,statSync:()=>({uid:1000,mode:0o700}),appendFileSync:(p,s)=>records.push(JSON.parse(s)),net,dns,tls:{connect:()=>calls.push('tls')},dgram:{Socket:Datagram},cp,syncBuiltinESMExports:()=>{},globalThis:{fetch:()=>calls.push('fetch')}};
 const source=fs.readFileSync(ROOT+'/runtime-guard.mjs','utf8').replace(/^import .*;\n/gm,'').replace(/^const root = .*;$/m,'const root = '+JSON.stringify(ROOT)+';');
 vm.runInNewContext(source,context,{timeout:1000});return {context,records,calls};
}
test('guard accepts own0 and Materials1 environment',()=>{const x=setup();assert.equal(x.records.filter(v=>v.kind==='installed').length,1);assert.equal(x.calls.length,0);});
test('guard rejects accidental own1 and disabled Materials',()=>{assert.throws(()=>setup({PRESIDENT_OWN_ENABLED:'1'}));assert.throws(()=>setup({MATERIALS_LIBRARY_ENABLED:'0'}));});
test('guard allows only fake PG TCP and reserved listener',()=>{const x=setup();assert.equal(new x.context.net.Socket().connect({host:'127.0.0.1',port:55498}),'allowed');assert.equal(new x.context.net.Server().listen(31398,'127.0.0.1'),'allowed');assert.throws(()=>new x.context.net.Socket().connect({host:'127.0.0.1',port:1}));assert.throws(()=>new x.context.net.Server().listen(31398,'0.0.0.0'));assert.equal(x.calls.length,2);});
test('guard denies external DNS TLS UDP fetch and child processes without invoking originals',()=>{const x=setup();assert.throws(()=>x.context.dns.resolve('example.invalid'));assert.throws(()=>x.context.dns.promises.resolve('example.invalid'));assert.throws(()=>new x.context.dns.Resolver().resolve('example.invalid'));assert.throws(()=>x.context.tls.connect());assert.throws(()=>new x.context.dgram.Socket().send());assert.throws(()=>x.context.globalThis.fetch('https://example.invalid'));assert.throws(()=>x.context.cp.spawn());assert.equal(x.calls.length,0);});
