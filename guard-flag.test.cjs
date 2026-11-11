"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const guard=fs.readFileSync(__dirname+'/functional-guard.mjs','utf8'),runner=fs.readFileSync(__dirname+'/functional_smoke.py','utf8');
function predicate(text){const lines=text.match(/^assert\.equal\(process\.env\.PRESIDENT_OWN_ENABLED,"[01]"\);$/gm);assert.equal(lines?.length,1);return lines[0];}
function checkFlag(line,value){return vm.runInNewContext(line,{assert,process:Object.freeze({env:Object.freeze({PRESIDENT_OWN_ENABLED:value})})},{timeout:100,contextCodeGeneration:{strings:false,wasm:false}});}
test('exact isolated guard predicate admits0 and rejects1',()=>{const line=predicate(guard);assert.doesNotThrow(()=>checkFlag(line,'0'));assert.throws(()=>checkFlag(line,'1'));});
test('runner original-only literal couples to exact guard predicate',()=>{const values=[...runner.matchAll(/'PRESIDENT_OWN_ENABLED':'([01])'/g)].map(x=>x[1]);assert.deepEqual(values,['0']);assert.doesNotThrow(()=>checkFlag(predicate(guard),values[0]));});
test('old guard1 demonstrates the regression without network or app import',()=>{const old='assert.equal(process.env.PRESIDENT_OWN_ENABLED,"1");';assert.throws(()=>checkFlag(predicate(old),'0'));assert.doesNotThrow(()=>checkFlag(predicate(old),'1'));assert.notEqual(predicate(guard),predicate(old));});
