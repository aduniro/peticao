import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const script=fileURLToPath(new URL("./prepare-pdfjs-assets.mjs",import.meta.url));
const lock=JSON.parse(readFileSync(new URL("./pdfjs-assets.lock.json",import.meta.url),"utf8"));
function fixture() {
  const root=mkdtempSync('/mnt/apps/peticao-final/_qa/pdfjs-prepare-'),cache=join(root,'cache'),destination=join(root,'public');mkdirSync(cache);
  const trap=join(root,'network-trap.mjs'),marker=join(root,'fetch-called');
  writeFileSync(trap,`import {writeFileSync} from 'node:fs';globalThis.fetch=()=>{writeFileSync(${JSON.stringify(marker)},'unexpected');throw Error('Network forbidden in this QA');};`);
  const run=(...extra)=>spawnSync(process.execPath,['--import',trap,script,'--offline','--cache-dir',cache,'--destination',destination,...extra],{encoding:'utf8'});
  return{root,cache,destination,marker,run,close:()=>rmSync(root,{recursive:true,force:true})};
}
test("offline mode refuses a missing cache without calling fetch or creating runtime output",()=>{
 const f=fixture();try{const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/cache missing in offline mode/);assert.equal(existsSync(f.marker),false);assert.equal(existsSync(f.destination),false);}finally{f.close();}
});
test("corrupt cached archive fails length and SRI checks without fetching or extracting",()=>{
 const f=fixture();try{
  writeFileSync(join(f.cache,'package.tgz'),'not an archive');let r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/length mismatch/);
  writeFileSync(join(f.cache,'package.tgz'),Buffer.alloc(lock.archiveSize));r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/integrity mismatch/);
  assert.equal(existsSync(f.marker),false);assert.equal(existsSync(f.destination),false);
 }finally{f.close();}
});
test("cache symlinks and duplicate/relative CLI options fail closed",()=>{
 const f=fixture();try{
  const unrelated=join(f.root,'unrelated');writeFileSync(unrelated,'fictitious');symlinkSync(unrelated,join(f.cache,'package.tgz'));
  const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/symbolic link/);assert.equal(readFileSync(unrelated,'utf8'),'fictitious');
  const duplicate=f.run('--offline');assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/Duplicate offline/);
  const relative=spawnSync(process.execPath,[script,'--destination','relative-path'],{encoding:'utf8'});assert.notEqual(relative.status,0);assert.match(relative.stderr,/absolute/);
  assert.equal(existsSync(f.marker),false);
 }finally{f.close();}
});
