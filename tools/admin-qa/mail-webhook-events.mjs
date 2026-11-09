// Authenticated provider fixture requests against compiled loopback HTTP. No real provider call/email.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
const base=new URL(process.env.QA_BASE_URL??"http://127.0.0.1:3032"),dburl=new URL(process.env.DATABASE_URL??"http://missing");
assert.equal(base.hostname,"127.0.0.1");assert.equal(base.port,"3032");assert.equal(dburl.hostname,"127.0.0.1");assert.equal(dburl.port,"54345");assert.equal(dburl.pathname,"/peticao");
assert.equal(process.env.PREVIEW_MODE,"1");assert.equal(process.env.ADMIN_NO_PASSWORD,"0");assert.equal(process.env.MAIL_PROVIDER,"dev");
const output=process.env.QA_OUTPUT_DIR;assert.ok(output);await mkdir(output,{recursive:true});assert.equal((await fetch(new URL("/admin",base))).status,200);
const [db,A,U]=await Promise.all([import("../../site/src/lib/db.ts"),import("../../site/src/lib/mail/archive.ts"),import("../../site/src/lib/admin-users.ts")]).then(ms=>ms.map(m=>m.default??m));
let session;
try{
 assert.equal((await db.query("SELECT count(*)::int n FROM signatures WHERE email NOT LIKE '%@example.test'")).rows[0].n,0);
 await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,confirmed_at,created_at,seq) VALUES('QA Fictício','qa-webhook-preserve@example.test','qa-webhook-email-hash','qa-webhook-cpf-hash','apoiador','QA','2026-01-01T00:00:00Z','confirmed','2026-01-02T00:00:00Z','2026-01-01T00:00:00Z',77)");
 await db.query("INSERT INTO mail_outbox(kind,to_addr,payload,status,attempts,created_at,next_attempt_at) VALUES('QA','qa-webhook-preserve@example.test',$1,'failed',2,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",[JSON.stringify({to:'qa-webhook-preserve@example.test',subject:'QA original',text:'QA original'})]);
 const snapshot=async()=>({signers:(await db.query("SELECT * FROM signatures ORDER BY id")).rows,queue:(await db.query("SELECT * FROM mail_outbox ORDER BY id")).rows});const before=await snapshot();
 const user=await U.criarUsuario({email:"qa-webhook-editor@example.test",nome:"QA Webhooks",nivel:"edicao",senha:"QA-Local-Webhook-2026-Ficticia"});assert.ok(user.ok);session=(await U.abrirSessao(user.usuario.id,"127.0.0.1")).token;
 const to="qa-webhook-runtime@example.test",at="2026-11-07T12:00:00.123456Z",epoch=1794052800,records=[];
 const send=async(provider,body,options={})=>{
   const raw=JSON.stringify(body),secret=process.env[provider==="brevo"?"BREVO_WEBHOOK_TOKEN":`${provider.toUpperCase()}_WEBHOOK_SIGNING_SECRET`];assert.ok(secret?.startsWith("QA_"));
   const headers=provider==="brevo"?{authorization:`Bearer ${secret}`} : provider==="sendpulse"?{"x-signature":`sha256=${createHmac("sha256",secret).update(raw).digest("hex")}`}:{signature:createHmac("sha256",options.secret??secret).update(raw).digest("hex")};
   const target=new URL(`/api/mail/eventos/${provider}`,base);target.searchParams.set('s',process.env.MAIL_WEBHOOK_SECRET);
   return fetch(target,{method:"POST",headers,body:options.tamper?raw+" ":raw});
 };
 const read=async(id,auth=session)=>{
   const r=await fetch(new URL(`/api/admin/emails/mensagens?id=message:${id}`,base),{headers:{origin:base.origin,cookie:auth?`adm=${auth}`:""}});return{status:r.status,data:await r.json()};
 };
 for(const provider of ["brevo","mailersend","sendpulse"]){
   const id=provider==="sendpulse"?"123":"qa-webhook-id",scope=process.env[`${provider.toUpperCase()}_WEBHOOK_ACCOUNT_SCOPE`];assert.match(scope,/^[a-f0-9]{64}$/);
   const message=await A.prepareMessage({to,subject:"QA",text:"QA"},"confirmacao","transactional"),attempt=await A.beginAttempt(message.id,provider,"qa-sender@example.test");assert.ok(attempt.ok);assert.ok((await A.finishAttempt(attempt.id,"accepted",{providerId:id,accountScope:scope})).ok);
   assert.equal((await read(message.id,"")).status,401);
   const payload=provider==="brevo"?{event:"delivered",email:to,"message-id":id,ts_event:epoch}:provider==="sendpulse"?{event:"delivered",recipient:to,message_id:123,timestamp:epoch}:{type:"activity.delivered",created_at:at,data:{id:"not-message",email_id:"not-message-either",message_id:id,recipient:to,meta:{url:"NEVER_STORE_WEBHOOK_LINK"}}};
   if(provider!=="brevo")assert.equal((await send(provider,payload,{tamper:true})).status,401);
   assert.equal((await send(provider,payload)).status,200);assert.equal((await send(provider,payload)).status,200);
   const detail=await read(message.id);assert.equal(detail.status,200);assert.equal(detail.data.events.length,1);assert.equal(detail.data.events[0].event_type,"delivered");assert.equal(detail.data.record.status,"accepted");
   if(provider==="mailersend")assert.equal(detail.data.events[0].occurred_at,at);
   for(const forbidden of ["account_scope","fingerprint","NEVER_STORE_WEBHOOK_LINK"])assert.ok(!JSON.stringify(detail.data).includes(forbidden));
   const missing = provider === "brevo" ? {...payload,email:undefined} : provider === "sendpulse" ? {...payload,recipient:undefined} : {...payload,data:{...payload.data,recipient:undefined}};
   assert.equal((await send(provider,missing)).status,200);
   records.push({provider,id:message.id,payload});
 }
 const ms=records.find(r=>r.provider==="mailersend");const copy={...ms.payload,data:{...ms.payload.data,recipient:"qa-webhook-copy@example.test"}};assert.equal((await send("mailersend",copy)).status,200);assert.equal((await read(ms.id)).data.events.length,1);
 const ping={type:"webhook.test",message:"QA inert",created_at:at};assert.equal((await send("mailersend",ping,{secret:"test_Am3L1GuOIc4blLUuHqAPxxwkZaJyEk8G"})).status,200);
 assert.equal((await send("mailersend",ms.payload,{secret:"test_Am3L1GuOIc4blLUuHqAPxxwkZaJyEk8G"})).status,401);
 const facts=(await db.query("SELECT association_state FROM mail_message_events")).rows;assert.equal(facts.length,4);assert.equal(facts.filter(r=>r.association_state==="linked").length,3);assert.equal(facts.filter(r=>r.association_state==="unlinked").length,1);
 assert.deepEqual(await snapshot(),before);assert.ok((await db.verifyAuditChain()).ok);
 const report={ok:true,compiledWebhookAuthentication:true,invalidRecipientDiscarded:true,mailersendVersion2:true,sendpulseHmac:true,brevoBearer:true,publicPingDoesNotAuthorizeEvents:true,recipientRequired:true,duplicateIdempotent:true,noScopeOrPayloadExposed:true,noSignerWrites:true,noQueueWrites:true,noMailSent:true,realProviderRequests:0};
 await writeFile(`${output}/mail-webhook-events.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(session)await U.encerrarSessao(session);await db._closeDbForTests();}
