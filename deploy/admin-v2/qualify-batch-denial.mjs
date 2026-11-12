// Admission rejection only; never calls a validator, signer or transport.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const fixture=JSON.parse(readFileSync(process.argv[2],"utf8"));
const root="/mnt/apps/peticao-final/_ops/releases-admin-publico/integracao-20261112/";
assert.ok(realpathSync(process.argv[2]).startsWith(root));
assert.ok(realpathSync(fixture.socket).startsWith(root));
assert.match(fixture.database,/^fixture_batch_[0-9]+$/);
assert.equal(process.env.PETICAO_RUNTIME,"admin-v2");
assert.equal(process.env.DB_BOOTSTRAP_MODE,"verify");
const load=async name=>{const value=await import(resolve(fixture.current,"site/src/lib/"+name+".ts"));return value.default??value;};
const evidence={scope:"foreign batch rejection before PDF/certificate processing",checks:[],errors:[],providerCalls:0,productionTouched:false};
const files=["site/src/lib/batches.ts","site/src/lib/db.ts","site/src/lib/db-schema-readiness.ts","deploy/admin-v2/qualify-batch-denial.mjs"];
const fingerprint=()=>Object.fromEntries(files.map(name=>[name,createHash("sha256").update(readFileSync(resolve(fixture.current,name))).digest("hex")]));
evidence.inputHashes=fingerprint();evidence.sourceCommit=execFileSync("git",["-C",fixture.current,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{evidence.providerCalls++;throw new Error("fixture forbids network fetch");};
let db;
try{
 db=await load("db");const batches=await load("batches");
 const original=(await db.query("SELECT pdf,pdf_sha256,approved_at,runtime_owner FROM batches WHERE id=1")).rows[0];
 const messages=(await db.query("SELECT count(*)::int n FROM mail_messages")).rows[0].n;
 const old=await batches.getBatch(1);assert.equal(old.runtime_owner,"legacy");assert.equal(batches.batchWritableHere(old),false);
 const result=await batches.attachSignedPdf(1,Buffer.from("not-a-pdf-and-must-never-be-processed"),"Fixture actor",{userId:999999,email:"nobody@fixture.invalid",sessaoId:null});
 assert.deepEqual(result,{ok:false,kind:"none",notes:[batches.LEGACY_BATCH_NOTICE]});
 assert.equal(evidence.providerCalls,0);assert.equal((await db.query("SELECT count(*)::int n FROM mail_messages")).rows[0].n,messages);
 assert.deepEqual((await db.query("SELECT pdf,pdf_sha256,approved_at,runtime_owner FROM batches WHERE id=1")).rows[0],original);
 assert.deepEqual(fingerprint(),evidence.inputHashes);
 evidence.checks.push("legacy-owner-visible-in-batch-projection","foreign-upload-rejected-before-pdf-or-certificate-check","no-mail-intent-no-provider-call","original-batch-bytes-and-state-unchanged","executed-input-hashes-unchanged");evidence.exit=0;
}catch(error){evidence.errors.push(String(error.stack??error));evidence.exit=1;process.exitCode=1;}
finally{globalThis.fetch=previousFetch;if(db)await db._closeDbForTests();writeFileSync(resolve(fixture.output,"batch-denial-result.json"),JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify({exit:evidence.exit,checks:evidence.checks.length,result:resolve(fixture.output,"batch-denial-result.json")}));}
