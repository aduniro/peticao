const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=__dirname,SOURCE='/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111',COMMIT='3f96a06a8e3557099c94df19e1b95a3496496bfe';
const ts=require('/mnt/dev/peticao/site/node_modules/typescript');assert.equal(ts.version,'5.9.3');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),files={};
for(const name of ['materials-contract.ts','materials-render.ts','materials-layout.ts','materials-dom-collector.ts']){
 const relative='site/src/lib/'+name,bytes=cp.execFileSync('/usr/bin/git',['-C',SOURCE,'show',COMMIT+':'+relative]);assert.ok(bytes.equals(fs.readFileSync(SOURCE+'/'+relative)));
 const result=ts.transpileModule(bytes.toString('utf8'),{fileName:name,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,strict:true,esModuleInterop:true}});assert.equal(result.diagnostics.length,0);
 fs.writeFileSync(ROOT+'/compiled/'+name.replace(/\.ts$/,'.js'),result.outputText);files[relative]={sourceSha256:sha(bytes),compiledSha256:sha(Buffer.from(result.outputText))};
}
fs.writeFileSync(ROOT+'/source-manifest.json',JSON.stringify({source:SOURCE,commit:COMMIT,compilerVersion:ts.version,compilerSha256:sha(fs.readFileSync('/mnt/dev/peticao/site/node_modules/typescript/lib/typescript.js')),files},null,2));
console.log(JSON.stringify({sources:Object.keys(files).length,applicationExecuted:false}));
