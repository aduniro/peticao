"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const ROOT=path.resolve(__dirname,"../.."),OUT=ROOT+"/.cache/materials-export-tool",DEPS="/mnt/dev/peticao/site/node_modules",ts=require(DEPS+"/typescript"),sha=b=>crypto.createHash("sha256").update(b).digest("hex");
assert.equal(ts.version,"5.9.3");assert.equal(cp.execFileSync("/usr/bin/git",["-C",ROOT,"status","--porcelain"],{encoding:"utf8"}),"");
const commit=cp.execFileSync("/usr/bin/git",["-C",ROOT,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),files={};fs.mkdirSync(OUT+"/compiled",{recursive:true,mode:0o700});
for(const name of ["materials-contract","materials-render","materials-layout","materials-dom-collector","materials-export"]){
 const rel="site/src/lib/"+name+".ts",bytes=cp.execFileSync("/usr/bin/git",["-C",ROOT,"show",commit+":"+rel]);assert.ok(bytes.equals(fs.readFileSync(ROOT+"/"+rel)));
 const out=ts.transpileModule(bytes.toString(),{fileName:name+".ts",reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,strict:true,esModuleInterop:true}});assert.equal(out.diagnostics.length,0);const dest=OUT+"/compiled/"+name+".js";fs.writeFileSync(dest,out.outputText,{mode:0o600});files[dest]={bytes:Buffer.byteLength(out.outputText),sha256:sha(Buffer.from(out.outputText))};
}
const assets={};for(const name of ["adunir","adunir-andes","andes"]){const rel="/logos/"+name+".png";assets[rel]={file:ROOT+"/site/public"+rel,sha256:sha(fs.readFileSync(ROOT+"/site/public"+rel))};}
const manifest={schema:1,sourceCommit:commit,sourceRoot:ROOT,compilerVersion:ts.version,rendererSha256:sha(fs.readFileSync(ROOT+"/site/src/lib/materials-render.ts")),driverSha256:sha(fs.readFileSync(__dirname+"/run.cjs")),policySha256:sha(fs.readFileSync(__dirname+"/policy.cjs")),files,assets};fs.writeFileSync(OUT+"/manifest.json",JSON.stringify(manifest,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({manifest:OUT+"/manifest.json",sha256:sha(fs.readFileSync(OUT+"/manifest.json")),sourceCommit:commit,applicationOrBrowserExecuted:false}));
