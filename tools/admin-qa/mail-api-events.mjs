// Local API fixtures + compiled metadata HTTP. No provider request or email delivery.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base=new URL(process.env.QA_BASE_URL??"http://127.0.0.1:3032"),url=new URL(process.env.DATABASE_URL??"http://missing");
assert.equal(base.hostname,"127.0.0.1");assert.equal(base.port,"3032");assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"54345");assert.equal(url.pathname,"/peticao");
assert.equal(process.env.PREVIEW_MODE,"1");assert.equal(process.env.ADMIN_NO_PASSWORD,"0");assert.equal(process.env.MAIL_PROVIDER,"dev");
const output=process.env.QA_OUTPUT_DIR;assert.ok(output);await mkdir(output,{recursive:true});
assert.equal((await fetch(new URL("/admin",base))).status,200);
const modules=await Promise.all([import("../../site/src/lib/db.ts"),import("../../site/src/lib/mail/archive.ts"),import("../../site/src/lib/mail/events.ts"),import("../../site/src/lib/mail/engajamento.ts"),import("../../site/src/lib/admin-users.ts"),import("../../site/src/lib/mail/event-scope.ts")]);
const [db,A,E,G,U,S]=modules.map(m=>m.default??m);
let token;
try {
 assert.equal((await db.query("SELECT count(*)::int n FROM signatures WHERE email NOT LIKE '%@example.test'")).rows[0].n,0);
 const snapshot=async()=>({signers:(await db.query("SELECT * FROM signatures ORDER BY id")).rows,outbox:(await db.query("SELECT * FROM mail_outbox ORDER BY id")).rows});
 await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,confirmed_at,created_at,seq) VALUES('QA Fictício','qa-api-preserved@example.test','qa-api-email-hash','qa-api-cpf-hash','apoiador','QA','2026-01-01T00:00:00Z','confirmed','2026-01-02T00:00:00Z','2026-01-01T00:00:00Z',77)");
 await db.query("INSERT INTO mail_outbox(kind,to_addr,payload,status,attempts,next_attempt_at,created_at,last_error) VALUES('QA','qa-api-preserved@example.test',$1,'failed',2,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','QA_PRESERVE')",[JSON.stringify({to:'qa-api-preserved@example.test',subject:'QA original',text:'QA original payload'})]);
 const before=await snapshot(),recipient="qa-api-runtime@example.test",key="QA_NOT_A_REAL_KEY",id="qa-api-runtime-id",at="2026-11-07T05:00:00.123456Z";
 const m=await A.prepareMessage({to:recipient,subject:"QA",text:"QA"},"confirmacao","transactional"),a=await A.beginAttempt(m.id,"brevo","qa-sender@example.test");assert.ok(a.ok);
 assert.ok((await A.finishAttempt(a.id,"accepted",{providerId:id,accountScope:S.credentialScope("brevo",key)})).ok);
 const actor=await U.criarUsuario({email:"qa-api-editor@example.test",nome:"QA API",nivel:"edicao",senha:"QA-Local-Api-2026-Ficticia"});assert.ok(actor.ok);token=(await U.abrirSessao(actor.usuario.id,"127.0.0.1")).token;
 const path=`/api/admin/emails/mensagens?id=message:${m.id}`;
 const read=async(auth=token)=>{const r=await fetch(new URL(path,base),{headers:{origin:base.origin,cookie:auth?`adm=${auth}`:""}});return{status:r.status,data:await r.json()};};
 assert.equal((await read("")).status,401);assert.equal((await read()).status,200);assert.deepEqual((await read()).data.events,[]);
 let providerReads=0;
 const fake=async address=>{
  assert.ok(address.startsWith("https://api.brevo.com/"));providerReads++;
  const match=address.includes("event=hardBounces")||address.includes("event=delivered");
  return new Response(JSON.stringify({events:match?[{email:recipient,messageId:id,date:at,html:"NEVER_STORE_CONTENT",url:"NEVER_STORE_LINK"}]:[]}),{status:200});
 };
 const config={brevo:key,mailersend:null,sendpulse:null,mailrelayP:null};
 assert.ok((await E.pollProviders(3,fake,config)).brevo.ok);assert.ok((await G.syncEngajamento(3,fake,config)).brevo.ok);
 const first=await read();assert.equal(first.status,200);assert.equal(first.data.events.length,2);assert.deepEqual(first.data.events.map(e=>e.event_type).sort(),["delivered","hard_bounce"]);assert.ok(first.data.events.every(e=>e.occurred_at===at));assert.equal(first.data.record.status,"accepted");
 const firstFacts=(await db.query("SELECT * FROM mail_message_events ORDER BY id")).rows;
 await E.pollProviders(3,fake,config);await G.syncEngajamento(3,fake,config);
 assert.deepEqual((await db.query("SELECT * FROM mail_message_events ORDER BY id")).rows,firstFacts);assert.equal((await read()).data.events.length,2);
 for(const bad of [key,"account_scope","fingerprint","NEVER_STORE_CONTENT","NEVER_STORE_LINK"])assert.ok(!JSON.stringify(first.data).includes(bad));
 assert.deepEqual(await snapshot(),before);assert.ok((await db.verifyAuditChain()).ok);
 const report={ok:true,compiledMetadataAuth:true,apiSourceUsesFixtures:true,fakeProviderReads:providerReads,realProviderReads:0,noMailSent:true,noSignerWrites:true,noQueueWrites:true,duplicateIdempotent:true,noScopeOrPayloadExposed:true,microsecondsPreserved:true};
 await writeFile(`${output}/mail-api-events.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {if(token)await U.encerrarSessao(token);await db._closeDbForTests();}
