import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync,readdirSync,readFileSync } from "node:fs";
import { _setMxResolverForTests } from "./email-check";
import { mockProvider, ProviderUnavailable } from "./cpf-check";
import { saveTrtEvidence,findEvidence,makeIntent,readIntent,readIntentFromTicket,intentStatus,enqueueCpf,consolidateEvidence } from "./ncpf-store";
import { claimJob,completeJob,heartbeatJob,seedConsolidation } from "./ncpf-jobs";
import { withSignupReceipt } from "./signup-idempotency";
import { extraValidator } from "./ncpf-validator";
import { hmac } from "./security";
import { encryptCpfCache } from "./cpf-cache-crypto";
import { handleSign } from "./sign-flow";
import { validate,confirmFull } from "./signatures";
import * as db from "./db";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.NCPF_ENABLED="1";process.env.NCPF_QUERY_ENABLED="1";
process.env.MAIL_PROVIDER="dev";process.env.TURNSTILE_SITE_KEY="";
process.env.MAIL_OUTBOX_DIR=join(tmpdir(),`ncpf-mail-${process.pid}`);
_setMxResolverForTests(async()=>"ok");
function cpfFrom(n:string) {const d=n.split('').map(Number);for(const len of [9,10]){const rem=d.slice(0,len).reduce((s,v,i)=>s+v*(len+1-i),0)*10%11;d.push(rem===10?0:rem);}return d.join('');}
const cpf=cpfFrom('200000021'),cpf2=cpfFrom('200000022');
const body=(extra:object={})=>({name:'Clara Silva',email:'clara@hotmail.com',cpf,category:'apoiador',city:'Porto Velho',uf:'RO',consent:true,...extra});
const ctx={ip:'9.9.5.1',visitorId:'ncpf-visitor'};
const provider=mockProvider({[cpf]:{nome:'CLARA SOUZA',mae:'MARIA ALVES',nasc:'01/02/1990'}});
const evidenceData=(extra:object={})=>({cpf,documentCpf:cpf,name:'CLARA SILVA',pdf:Buffer.from('%PDF-1.7\nfictional-unit-fixture'),fetchedAt:new Date().toISOString(),origin:'https://portal.trt3.jus.br/certidao',...extra});
const count=async(table:string)=>(await db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;

test('NCPF: fresh proof replaces nominal reference, keeps challenge and declared name; duplicate sends no new mail',async()=>{
 await db._openForTests('t_ncpf_fallback');
 try {
  const proof=await saveTrtEvidence(evidenceData());
  const first=await handleSign(body(),ctx,provider);
  assert.equal(first.json.identityRequired,true);assert.equal(await count('signatures'),0);assert.equal(await count('identity_attempts'),1);
  const continuation={ticket:first.json.ticket,ncpfToken:first.json.ncpfToken};
  assert.equal(typeof continuation.ncpfToken,'string');
  const validated=validate(body());assert(validated.ok);if(validated.ok)assert((await readIntentFromTicket(String(first.json.ticket),validated.value,ctx.visitorId))?.evidence_id===proof.id);
  if(validated.ok){
    const intent=await readIntent(first.json.ncpfToken,validated.value,ctx.visitorId);assert(intent);
    const changedApi=mockProvider({[cpf]:{nome:'CLARA SILVA',mae:'MARIA ALVES',nasc:'01/02/1990'}});
    const pinned=extraValidator(changedApi,{input:validated.value,intent,securityPassed:()=>false});
    assert.equal((await pinned.provider.lookup(cpf))?.nome,'CLARA SILVA');assert.equal(pinned.state.source,'trt3');
  }
  const wrong=await handleSign(body({...continuation,identity:{method:'nascimento',value:'02/02/1990'}}),ctx,provider);
  assert.equal(wrong.json.identityCode,'mismatch');assert.equal(await count('signatures'),0);
  const ok=await handleSign(body({...continuation,identity:{method:'nascimento',value:'01/02/1990'}}),ctx,provider);
  assert.equal(ok.json.ok,true);assert.equal(ok.json.mail,'sent');
  const row=(await db.query('SELECT id,name,declared_name,name_source,name_evidence_id FROM signatures')).rows[0];
  assert.equal(row.declared_name,'Clara Silva');assert.equal(row.name_source,'trt3');assert.equal(row.name_evidence_id,proof.id);
  const filesBefore=readdirSync(process.env.MAIL_OUTBOX_DIR!);
  const duplicate=await handleSign(body({...continuation,identity:{method:'nascimento',value:'01/02/1990'}}),ctx,provider);
  assert.equal(duplicate.json.submission,'already_received');assert.equal(duplicate.json.mail,'none');
  assert.equal(readdirSync(process.env.MAIL_OUTBOX_DIR!).length,filesBefore.length);
  await db.query("UPDATE signatures SET status='confirmed' WHERE id=$1",[row.id]);
  await consolidateEvidence(proof);
  const changed=(await db.query('SELECT name,declared_name FROM signatures')).rows[0];assert.equal(changed.name,'CLARA SILVA');assert.equal(changed.declared_name,'Clara Silva');
  await consolidateEvidence(proof);assert.equal(await count('signature_name_history'),1);
  await db.query("UPDATE ncpf_evidence SET expires_at=now()-interval '1 second',fetched_at=now()-interval '31 days'");
  await seedConsolidation();assert.equal(await count('ncpf_jobs'),0); // TTL does not turn resolved signatures into a monthly backlog
 } finally {await db._closeDbForTests();rmSync(process.env.MAIL_OUTBOX_DIR!,{recursive:true,force:true});}
});

test('NCPF: expired evidence, token binding, shared queue and stale lease protection',async()=>{
 await db._openForTests('t_ncpf_queue');
 try {
  const v=validate(body());assert(v.ok);if(!v.ok)return;
  const pending=await handleSign(body(),ctx,provider);assert.equal(pending.status,202);assert.equal(await count('identity_attempts'),0);
  const token=pending.json.ncpfToken as string;
  assert(await readIntent(token,v.value,ctx.visitorId));
  assert.equal(await readIntent(token,{...v.value,name:'Clara Souza'},ctx.visitorId),null);
  assert.equal(await readIntent(token,v.value,'other-visitor'),null);
  assert.equal((await intentStatus(token,ctx.visitorId)).state,'pending');
  await enqueueCpf(cpf,'consolidation');assert.equal(await count('ncpf_jobs'),1);
  const job=await claimJob();assert(job);if(!job)return;
  assert.equal(await claimJob(),null);
  await assert.rejects(()=>completeJob(job.id,randomUUID(),evidenceData()),/stale/);
  await assert.rejects(()=>completeJob(job.id,job.leaseToken,evidenceData({cpf:cpf2,documentCpf:cpf2})),/stale/);
  assert.equal(await heartbeatJob(job.id,job.leaseToken),true);
  await completeJob(job.id,job.leaseToken,evidenceData());
  assert.equal((await intentStatus(token,ctx.visitorId)).state,'ready');
  assert.equal(await heartbeatJob(job.id,job.leaseToken),false);
  const resumed=await handleSign(body({ncpfToken:token}),ctx,provider);assert.equal(resumed.json.identityRequired,true);
  await db.query("UPDATE ncpf_evidence SET expires_at=now()-interval '1 second',fetched_at=now()-interval '31 days'");
  assert.equal(await findEvidence(cpf),null);
  // A proof already selected for this live intent survives the cache boundary.
  const valid=await readIntent(token,v.value,ctx.visitorId);assert(valid?.evidence_id);
  await db.query("UPDATE ncpf_intents SET expires_at=now()-interval '1 second'");
  assert.equal(await readIntent(token,v.value,ctx.visitorId),null);
  assert.equal((await handleSign(body({ncpfToken:token}),ctx,provider)).status,400);
 }finally{await db._closeDbForTests();}
});

test('NCPF: genuine divergence rejects, malformed evidence is refused, unavailable API never bypassed',async()=>{
 await db._openForTests('t_ncpf_reject');
 try{
  await assert.rejects(()=>saveTrtEvidence(evidenceData({documentCpf:cpf2})),/invalid/);
  await assert.rejects(()=>saveTrtEvidence(evidenceData({origin:'https://not-trt3.example.test/a'})),/invalid/);
  await assert.rejects(()=>saveTrtEvidence(evidenceData({pdf:Buffer.from('not-a-pdf')})),/invalid/);
  await assert.rejects(()=>saveTrtEvidence(evidenceData({fetchedAt:new Date(Date.now()-31*86400_000).toISOString()})),/invalid/);
  await saveTrtEvidence(evidenceData({name:'OUTRA PESSOA'}));
  const rejected=await handleSign(body(),ctx,provider);assert.equal(rejected.json.errors && (rejected.json.errors as any).name,'name_cpf_mismatch');assert.equal(await count('signatures'),0);assert.equal(await count('ncpf_jobs'),0);
  const unavailable=await handleSign(body(),ctx,{name:'fixture',lookup:async()=>{throw new ProviderUnavailable('NETWORK')}});
  assert.equal(unavailable.status,503);assert.equal(await count('ncpf_jobs'),0);
 }finally{await db._closeDbForTests();}
});

test('NCPF: API match stays on main path; partial TRT match still challenges server; failed-attempt lock remains',async()=>{
 await db._openForTests('t_ncpf_partial');
 try{
  const main=await handleSign(body(),ctx,mockProvider({[cpf]:{nome:'CLARA SILVA',nasc:'01/02/1990'}}));
  assert.equal(main.json.identityRequired,true);assert.equal(await count('ncpf_jobs'),0);assert.equal(main.json.ncpfToken,undefined);
  await saveTrtEvidence(evidenceData({name:'CLARA MARIA SILVA'}));
  const server=body({category:'servidor',email:'clara@unir.br',institution:'UNIR',role:'docente',campus:'Ji-Paraná',regionDeclared:true});
  const partial=await handleSign(server,ctx,provider);assert.equal(partial.json.identityRequired,true);
  await db.query("INSERT INTO identity_attempts(cpf_hash,method,ok,ts) SELECT $1,'nome',false,now()::text FROM generate_series(1,5)",[hmac(cpf)]);
  assert.equal((await handleSign(server,ctx,provider)).status,429);
 }finally{await db._closeDbForTests();}
});

test('signup receipt recovers exact result, refuses changed data, never replays uncertain work',async()=>{
 await db._openForTests('t_ncpf_receipts');
 try{
  const key=randomUUID();let calls=0;const run=async()=>{calls++;return {status:200,json:{ok:true,mail:'queued'}}};
  assert.equal((await withSignupReceipt(key,'visitor',{a:1},run)).json.ok,true);
  assert.equal((await withSignupReceipt(key,'visitor',{a:1},run)).json.mail,'queued');assert.equal(calls,1);
  assert.equal((await withSignupReceipt(key,'visitor',{a:2},run)).status,409);
  const uncertain=randomUUID();const fail=async()=>{calls++;throw new Error('lost-after-commit')};
  assert.equal((await withSignupReceipt(uncertain,'visitor',{},fail)).json.resultUnknown,true);
  assert.equal((await withSignupReceipt(uncertain,'visitor',{},fail)).status,202);assert.equal(calls,2);
 }finally{await db._closeDbForTests();}
});

test('worker completion commits evidence/projection/history/job atomically and rejects stale proof rollback',async()=>{
 await db._openForTests('t_ncpf_atomic');
 try{
  const id=(await db.query("INSERT INTO signatures(name,declared_name,email,email_hash,cpf_hash,category,text_version,consent_at,status) VALUES('Clara Silva','Clara Silva','atomic@example.invalid','atomic',$1,'apoiador','fixture',now()::text,'confirmed') RETURNING id",[hmac(cpf)])).rows[0].id;
  await enqueueCpf(cpf,'consolidation');const job=await claimJob();assert(job);if(!job)return;
  await db.query("CREATE FUNCTION fail_name_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_history_failure';END $$;CREATE TRIGGER fail_name_history BEFORE INSERT ON signature_name_history FOR EACH ROW EXECUTE FUNCTION fail_name_history()");
  await assert.rejects(()=>completeJob(job.id,job.leaseToken,evidenceData()),/fixture_history_failure/);
  assert.equal(await count('ncpf_evidence'),0);assert.equal(await count('signature_name_history'),0);
  assert.equal((await db.query('SELECT state FROM ncpf_jobs')).rows[0].state,'running');
  assert.equal((await db.query('SELECT name FROM signatures WHERE id=$1',[id])).rows[0].name,'Clara Silva');
  await db.query('DROP TRIGGER fail_name_history ON signature_name_history');
  await completeJob(job.id,job.leaseToken,evidenceData());
  assert.equal(await count('ncpf_evidence'),1);assert.equal(await count('signature_name_history'),1);
  assert.equal((await db.query('SELECT name FROM signatures WHERE id=$1',[id])).rows[0].name,'CLARA SILVA');
  const old=await saveTrtEvidence(evidenceData({name:'OLDER SOURCE NAME',pdf:Buffer.from('%PDF-1.7\nolder-fictional-document'),fetchedAt:new Date(Date.now()-86400_000).toISOString()}));
  assert.equal(await consolidateEvidence(old),0);
  assert.equal((await db.query('SELECT name FROM signatures WHERE id=$1',[id])).rows[0].name,'CLARA SILVA');
 }finally{await db._closeDbForTests();}
});

test('cache-only reconciliation recovers a committed confirmation whose post-commit hook was lost',async()=>{
 await db._openForTests('t_ncpf_reconcile');
 const previous=process.env.NCPF_QUERY_ENABLED;
 try{
  const id=(await db.query("INSERT INTO signatures(name,declared_name,email,email_hash,cpf_hash,category,text_version,consent_at,status) VALUES('Clara Silva','Clara Silva','recover@example.invalid','recover',$1,'apoiador','fixture',now()::text,'confirmed') RETURNING id",[hmac(cpf)])).rows[0].id;
  await db.query('INSERT INTO ncpf_candidates(signature_id,cpf_hash,payload) VALUES($1,$2,$3)',[id,hmac(cpf),encryptCpfCache(cpf,`ncpf-candidate:${id}`)]);
  await enqueueCpf(cpf,'consolidation');await saveTrtEvidence(evidenceData());
  process.env.NCPF_QUERY_ENABLED='0';await seedConsolidation();
  assert.equal((await db.query('SELECT name,name_source FROM signatures WHERE id=$1',[id])).rows[0].name,'CLARA SILVA');
  assert.equal((await db.query('SELECT state FROM ncpf_jobs')).rows[0].state,'done');
  assert.equal(await count('signature_name_history'),1);
 }finally{process.env.NCPF_QUERY_ENABLED=previous;await db._closeDbForTests();}
});
