import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readdirSync, rmSync } from "node:fs";
import * as db from "./db";
import { handleSign } from "./sign-flow";
import { mockProvider } from "./cpf-check";
import { _setMxResolverForTests } from "./email-check";
import { hmac } from "./security";
import { decryptCpfCache } from "./cpf-cache-crypto";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.NCPF_ENABLED="1";process.env.NCPF_QUERY_ENABLED="0";
process.env.MAIL_PROVIDER="dev";process.env.MAIL_PROVIDERS="dev";process.env.TURNSTILE_SITE_KEY="";
process.env.MAIL_OUTBOX_DIR=join(tmpdir(),`ncpf-legacy-mail-${process.pid}`);
_setMxResolverForTests(async()=>"ok");
const cpf="80000000167", otherCpf="80000000248";
const provider=mockProvider({[cpf]:{nome:"Pessoa Sintetica Alfa",nasc:"1980-01-02",mae:"Mae Sintetica Alfa"},[otherCpf]:{nome:"Pessoa Sintetica Alfa",nasc:"1980-01-02",mae:"Mae Sintetica Alfa"}});
const ctx={ip:"127.0.0.91",visitorId:"legacy-fixture-visitor",userAgent:"legacy-fixture"};
function body(category:"servidor"|"apoiador",extra:Record<string,unknown>={}){
 return {name:'Pessoa Sintetica Alfa',email:category==="servidor"?"ncpflegacy@unir.br":"ncpflegacy@gmail.com",cpf,category,consent:true,...(category==="servidor"?{institution:"UNIR",role:"docente",campus:"Ji-Paraná",regionDeclared:true}:{uf:"SP",city:"São Paulo"}),...extra};
}
async function attempt(data:ReturnType<typeof body>){
 const first=await handleSign(data,ctx,provider);
 return first.json.identityRequired?handleSign({...data,ticket:first.json.ticket,identity:{method:'nascimento',value:'02/01/1980'}},ctx,provider):first;
}
const mails=()=>existsSync(process.env.MAIL_OUTBOX_DIR!)?readdirSync(process.env.MAIL_OUTBOX_DIR!).length:0;
async function seed(category:"servidor"|"apoiador",status:string){
 const data=body(category);
 const r=await db.query<{id:number}>(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status)
 VALUES($1,$2,$3,$4,$5,'fixture',now()::text,$6) RETURNING id`,[data.name,data.email,hmac(data.email),hmac(cpf),category,status]);
 return r.rows[0].id;
}
for(const category of ["servidor","apoiador"] as const)for(const status of ["pending","confirmed"]){
 test(`legacy CPF: ${category}/${status} valid retry preserves record and sends no email`,async()=>{
  await db._openForTests(`t_legacy_${category}_${status}`);
  try{
   const id=await seed(category,status);const before=(await db.query('SELECT row_to_json(s) value FROM signatures s')).rows;
   const emailsBefore=mails();const result=await attempt(body(category));
   assert.equal(result.json.submission,"already_received");assert.equal(result.json.mail,"none");assert.equal(mails(),emailsBefore);
   assert.deepEqual((await db.query('SELECT row_to_json(s) value FROM signatures s')).rows,before);
   const candidates=(await db.query('SELECT signature_id,cpf_hash,payload FROM ncpf_candidates')).rows;assert.equal(candidates.length,1);assert.equal(candidates[0].signature_id,id);assert.equal(candidates[0].cpf_hash,hmac(cpf));
   assert.equal(decryptCpfCache(candidates[0].payload,`ncpf-candidate:${id}`),cpf);
   await attempt(body(category));assert.equal((await db.query('SELECT count(*)::int n FROM ncpf_candidates')).rows[0].n,1);assert.equal(mails(),emailsBefore);
  }finally{await db._closeDbForTests();rmSync(process.env.MAIL_OUTBOX_DIR!,{recursive:true,force:true});}
 });
}
test('legacy CPF: same email with another validated CPF never attaches to the old signature',async()=>{
 await db._openForTests('t_legacy_different_cpf');
 try{
  await seed('apoiador','confirmed');const result=await attempt(body('apoiador',{cpf:otherCpf}));
  assert.equal(result.json.submission,'already_received');assert.equal(result.json.mail,'none');assert.equal((await db.query('SELECT count(*)::int n FROM ncpf_candidates')).rows[0].n,0);assert.equal(mails(),0);
 }finally{await db._closeDbForTests();rmSync(process.env.MAIL_OUTBOX_DIR!,{recursive:true,force:true});}
});
test('legacy CPF: name mismatch cannot capture a candidate before validation',async()=>{
 await db._openForTests('t_legacy_unvalidated');
 try{
  await seed('apoiador','confirmed');const result=await handleSign(body('apoiador',{name:'Divergencia Sintetica'}),ctx,provider);
  assert.equal(result.json.submission,undefined);assert.equal((await db.query('SELECT count(*)::int n FROM ncpf_candidates')).rows[0].n,0);assert.equal(mails(),0);
 }finally{await db._closeDbForTests();rmSync(process.env.MAIL_OUTBOX_DIR!,{recursive:true,force:true});}
});
test('legacy CPF: feature disabled preserves the old duplicate behavior',async()=>{
 await db._openForTests('t_legacy_disabled');
 try{
  await seed('apoiador','confirmed');process.env.NCPF_ENABLED='0';const result=await attempt(body('apoiador'));
  assert.equal(result.json.submission,'already_received');assert.equal(result.json.mail,'none');assert.equal((await db.query('SELECT count(*)::int n FROM ncpf_candidates')).rows[0].n,0);assert.equal(mails(),0);
 }finally{process.env.NCPF_ENABLED='1';await db._closeDbForTests();rmSync(process.env.MAIL_OUTBOX_DIR!,{recursive:true,force:true});}
});
test('legacy CPF: concurrent submissions keep one signature, one candidate and one email',async()=>{
 await db._openForTests('t_legacy_concurrent');
 try{
  const {validate,submit}=await import('./signatures');const v=validate(body('apoiador'));assert(v.ok);if(!v.ok)return;
  const results=await Promise.all([submit(v.value,ctx),submit(v.value,ctx)]);
  assert.deepEqual(results.map(r=>r.submission).sort(),['already_received','created']);
  assert.equal((await db.query('SELECT count(*)::int n FROM signatures')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM ncpf_candidates')).rows[0].n,1);assert.equal(mails(),1);
 }finally{await db._closeDbForTests();rmSync(process.env.MAIL_OUTBOX_DIR!,{recursive:true,force:true});}
});
test('legacy CPF: capture failure is observable and retryable without claiming an email failure',async()=>{
 await db._openForTests('t_legacy_capture_failure');
 try{
  await seed('apoiador','confirmed');
  await db.query("CREATE FUNCTION refuse_candidate_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture candidate unavailable'; END $$");
  await db.query('CREATE TRIGGER refuse_candidate_fixture BEFORE INSERT ON ncpf_candidates FOR EACH ROW EXECUTE FUNCTION refuse_candidate_fixture()');
  const before=(await db.query('SELECT row_to_json(s) value FROM signatures s')).rows;
  const result=await attempt(body('apoiador'));assert.equal(result.status,503);assert.equal(result.json.verificationUnavailable,true);assert.equal(result.json.errorCode,'verification_unavailable');assert.equal(result.json.mail,undefined);assert.equal(result.json.submission,undefined);assert.equal(mails(),0);
  assert.deepEqual((await db.query('SELECT row_to_json(s) value FROM signatures s')).rows,before);
  await db.query('DROP TRIGGER refuse_candidate_fixture ON ncpf_candidates');
  const retried=await attempt(body('apoiador'));assert.equal(retried.json.submission,'already_received');assert.equal(retried.json.mail,'none');assert.equal(mails(),0);assert.equal((await db.query('SELECT count(*)::int n FROM ncpf_candidates')).rows[0].n,1);
 }finally{await db._closeDbForTests();rmSync(process.env.MAIL_OUTBOX_DIR!,{recursive:true,force:true});}
});
