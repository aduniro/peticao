import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { authenticateWebhook, mailersendTestPing, webhookBody } from "./mail/webhook-auth";
import { webhookMessageEvents } from "./mail/webhook-message-events";
import { credentialScope, sendpulseScope } from "./mail/event-scope";
(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
const URL_SECRET="QA_URL_ONLY_NOT_PROVIDER_SECRET_12345", SECRET="QA_WEBHOOK_SIGNATURE_SECRET_123456789", KEY="QA_API_KEY", TO="qa-webhooks@example.test", AT="2026-11-07T10:00:00.123456Z";
const cfg = (provider:string) => ({scope:provider==="sendpulse"?sendpulseScope("qa-id","qa-secret")!:credentialScope(provider,KEY)!,secret:SECRET});
const ms = (over:Record<string,unknown>={}) => ({type:"activity.delivered",created_at:AT,data:{id:"activity-id",email_id:"email-id",message_id:"qa-message-id",recipient:TO,meta:{url:"NEVER_STORE_LINK",ip:"NEVER_STORE_IP"}},...over});
const headers = (provider:string, raw:string, secret=SECRET) => new Headers(provider==="brevo"?{authorization:`Bearer ${secret}`} : provider==="sendpulse"?{"x-signature":`sha256=${createHmac("sha256",secret).update(raw).digest("hex")}`}:{signature:createHmac("sha256",secret).update(raw).digest("hex")});
async function setup(){
 const db=await import("./db");await db._openForTests("t_mail_webhooks");const saved=new Map<string,string|undefined>();
 for(const k of ["MAIL_WEBHOOK_SECRET","SECRETS_DIR","BREVO_WEBHOOK_TOKEN","MAILERSEND_WEBHOOK_SIGNING_SECRET","SENDPULSE_WEBHOOK_SIGNING_SECRET","BREVO_WEBHOOK_ACCOUNT_SCOPE","MAILERSEND_WEBHOOK_ACCOUNT_SCOPE","SENDPULSE_WEBHOOK_ACCOUNT_SCOPE"]){saved.set(k,process.env[k]);delete process.env[k];}
 process.env.MAIL_WEBHOOK_SECRET=URL_SECRET;process.env.SECRETS_DIR="/mnt/dev/peticao/.cache/admin-integration/preview-runtime/config-empty";
 const R=await import("../app/api/mail/eventos/[provedor]/route");
 return {db,A:await import("./mail/archive"),post:async(provider:string,body:unknown,over:{raw?:string;secret?:string;sign?:boolean;urlSecret?:string;extraHeaders?:Record<string,string>}={})=>{
   const raw=over.raw??JSON.stringify(body), h=over.sign===false?new Headers():headers(provider,raw,over.secret);for(const[k,v]of Object.entries(over.extraHeaders??{}))h.set(k,v);
   return R.POST(new NextRequest(`http://localhost/api/mail/eventos/${provider}?s=${over.urlSecret??URL_SECRET}`,{method:"POST",headers:h,body:raw}),{params:{provedor:provider}});
 },bind:(provider:string)=>{
   const prefix=provider.toUpperCase();process.env[`${prefix}_WEBHOOK_ACCOUNT_SCOPE`]=cfg(provider).scope;process.env[provider==="brevo"?"BREVO_WEBHOOK_TOKEN":`${prefix}_WEBHOOK_SIGNING_SECRET`]=SECRET;
 },close:async()=>{await db._closeDbForTests();for(const[k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}}};
}
async function receipt(c:Awaited<ReturnType<typeof setup>>,provider:string,id="qa-message-id",to=TO){
 const m=await c.A.prepareMessage({to,subject:"QA",text:"QA"},"confirmacao","transactional"),a=await c.A.beginAttempt(m.id,provider,"qa-sender@example.test");assert.ok(a.ok);assert.ok((await c.A.finishAttempt(a.id,"accepted",{providerId:id,accountScope:cfg(provider).scope})).ok);return m.id;
}

test("autenticação específica usa corpo original; vínculo incompleto não usa a chave atual por inferência",()=>{
 const raw='{"test":"á"}';
 for(const provider of ["brevo","mailersend","sendpulse"]){
  assert.deepEqual(authenticateWebhook(provider,raw,headers(provider,raw),cfg(provider),URL_SECRET),{status:200,scope:cfg(provider).scope});
  assert.equal(authenticateWebhook(provider,raw,new Headers(),cfg(provider),URL_SECRET).status,401);
  if(provider!=="brevo")assert.equal(authenticateWebhook(provider,raw+" ",headers(provider,raw),cfg(provider),URL_SECRET).status,401);
  for(const config of [{scope:"forged",secret:SECRET},{scope:cfg(provider).scope},{scope:cfg(provider).scope,secret:URL_SECRET},{scope:cfg(provider).scope,secret:"short"}])assert.equal(authenticateWebhook(provider,raw,headers(provider,raw),config,URL_SECRET).status,503);
  assert.deepEqual(authenticateWebhook(provider,raw,new Headers(),{},URL_SECRET),{status:200});
 }
});

test("corpo tem limite em bytes, valida UTF-8 e não depende de Content-Length",async()=>{
 assert.deepEqual(await webhookBody(new Request("http://localhost",{method:"POST",body:"ééé"}),5),{ok:false,status:413});
 assert.deepEqual(await webhookBody(new Request("http://localhost",{method:"POST",body:new Uint8Array([255])})),{ok:false,status:400});
 assert.deepEqual(await webhookBody(new Request("http://localhost",{method:"POST",body:"éé",headers:{"content-length":"1"}}),4),{ok:true,raw:"éé"});
});

test("parsers usam IDs documentados e horário do evento; conta alegada e payload livre são descartados",()=>{
 const fact=webhookMessageEvents("mailersend",ms({accountScope:"forged"}),cfg("mailersend").scope);assert.equal(fact.length,1);assert.equal(fact[0].providerId,"qa-message-id");assert.equal(fact[0].timestamp,AT);assert.equal(fact[0].accountScope,cfg("mailersend").scope);
 for(const bad of ["activity-id","email-id","NEVER_STORE_LINK","NEVER_STORE_IP","forged"])assert.ok(!JSON.stringify(fact).includes(bad));
 const epoch=1794045600;
 const b=webhookMessageEvents("brevo",{event:"delivered",email:TO,"message-id":"qa-message-id",ts_event:epoch,ts_epoch:1,date:"bad"},cfg("brevo").scope);assert.equal(b[0].timestamp,new Date(epoch*1000).toISOString().replace(".000Z",".000000Z"));
 const sp=webhookMessageEvents("sendpulse",{event:"spam_by_user",message_id:123,recipient:TO,timestamp:epoch},cfg("sendpulse").scope);assert.equal(sp[0].providerId,"123");assert.equal(sp[0].type,"complaint");
 for(const payload of [ms({created_at:"2026-11-07 10:00:00"}),ms({data:{id:"activity-id",email_id:"email-id",recipient:TO}}),ms({type:"activity.constructor"}),null])assert.deepEqual(webhookMessageEvents("mailersend",payload,cfg("mailersend").scope),[]);
 assert.deepEqual(webhookMessageEvents("sendpulse",{event:"delivered",message_id:123,recipient:TO,timestamp:epoch*1000},cfg("sendpulse").scope),[]);
 assert.deepEqual(webhookMessageEvents("brevo",{event:"delivered",email:TO,"message-id":"id",ts_epoch:epoch*1000},cfg("brevo").scope),[]);
});

test("rota valida URL, formato, tamanho e vínculo antes de gravar qualquer evento",async()=>{
 const c=await setup();try{
  assert.equal((await c.post("unknown",ms())).status,404);assert.equal((await c.post("mailersend",ms(),{urlSecret:"wrong"})).status,401);
  assert.equal((await c.post("mailersend",null,{raw:"{"})).status,400);assert.equal((await c.post("mailersend",null)).status,400);
  assert.equal((await c.post("mailersend",Array.from({length:501},()=>({})))).status,413);
  assert.equal((await c.post("mailersend",null,{raw:JSON.stringify({padding:"é".repeat(110000)})})).status,413);
  process.env.MAILERSEND_WEBHOOK_ACCOUNT_SCOPE=cfg("mailersend").scope;
  assert.equal((await c.post("mailersend",ms())).status,503);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_engagement")).rows[0].n,0);
 }finally{await c.close();}
});

test("MailerSend v2 assinado vincula e repete sem duplicar; mesmo ID na cópia não marca principal",async()=>{
 const c=await setup();try{
  c.bind("mailersend");const id=await receipt(c,"mailersend");
  const before=(await c.db.query("SELECT * FROM mail_message_attempts ORDER BY id")).rows;
  assert.equal((await c.post("mailersend",ms(),{sign:false})).status,401);
  assert.equal((await c.post("mailersend",ms())).status,200);assert.equal((await c.post("mailersend",ms())).status,200);
  const copy=ms({data:{message_id:"qa-message-id",recipient:"qa-copy@example.test"}});assert.equal((await c.post("mailersend",copy)).status,200);
  const rows=(await c.db.query("SELECT association_state,message_id,recipient FROM mail_message_events ORDER BY recipient")).rows;
  assert.equal(rows.length,2);assert.equal(rows.find(r=>r.recipient===TO).message_id,id);assert.equal(rows.find(r=>r.recipient!==TO).association_state,"unlinked");
  assert.deepEqual((await c.db.query("SELECT * FROM mail_message_attempts ORDER BY id")).rows,before);assert.ok((await c.db.verifyAuditChain()).ok);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_engagement")).rows[0].n,2);
 }finally{await c.close();}
});

test("Brevo bearer e SendPulse X-Signature vinculam só ao escopo configurado no servidor",async()=>{
 const c=await setup();try{
  for(const provider of ["brevo","sendpulse"]){
   c.bind(provider);const id=await receipt(c,provider,provider==="brevo"?"qa-message-id":"123");
   const body=provider==="brevo"?{event:"opened",email:TO,"message-id":"qa-message-id",ts_event:1794045600,accountScope:"forged"}:{event:"opened",recipient:TO,message_id:123,timestamp:1794045600,accountScope:"forged"};
   assert.equal((await c.post(provider,body,{secret:"other"})).status,401);assert.equal((await c.post(provider,body)).status,200);
   const row=(await c.db.query("SELECT * FROM mail_message_events WHERE provider=$1",[provider])).rows[0];assert.equal(row.message_id,id);assert.equal(row.account_scope,cfg(provider).scope);
  }
 }finally{await c.close();}
});

test("chave pública de teste MailerSend só reconhece ping inerte e não autentica atividade",async()=>{
 const c=await setup();try{
  c.bind("mailersend");const publicKey="test_Am3L1GuOIc4blLUuHqAPxxwkZaJyEk8G",ping={type:"webhook.test",message:"QA ping",created_at:AT};
  const raw=JSON.stringify(ping);assert.equal(mailersendTestPing(ping,raw,headers("mailersend",raw,publicKey)),true);
  assert.equal((await c.post("mailersend",ping,{secret:publicKey})).status,200);assert.equal((await c.post("mailersend",ms(),{secret:publicKey})).status,401);
  assert.equal((await c.post("mailersend",ping,{secret:publicKey,urlSecret:"wrong"})).status,401);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_engagement")).rows[0].n,0);
 }finally{await c.close();}
});

test("falha do journal responde retry e preserva supressão; repetição recupera um único fato",async()=>{
 const c=await setup();try{
  c.bind("mailersend");await receipt(c,"mailersend");
  await c.db.query("CREATE FUNCTION fail_webhook_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_message_events_received' THEN RAISE EXCEPTION 'qa_fail'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_webhook_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_webhook_audit()");
  const payload=ms({type:"activity.hard_bounced"});assert.equal((await c.post("mailersend",payload)).status,503);
  const {isSuppressed}=await import("./mail/suppression");assert.equal(await isSuppressed(TO),true);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_events")).rows[0].n,1);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
  await c.db.query("DROP TRIGGER fail_webhook_audit ON audit_log; DROP FUNCTION fail_webhook_audit()");
  assert.equal((await c.post("mailersend",payload)).status,200);assert.equal((await c.post("mailersend",payload)).status,200);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,1);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.close();}
});

test("modo legado mantém agregados sem inventar conta e aceita formatos anteriores",async()=>{
 const c=await setup();try{
  const legacy={type:"activity.opened",data:{created_at:AT,email:{recipient:{email:TO}}}};
  assert.equal((await c.post("mailersend",legacy,{sign:false})).status,200);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_engagement")).rows[0].n,1);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
  assert.equal((await c.post("mailersend",ms(),{sign:false})).status,200);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
 }finally{await c.close();}
});

test("falha do agregado em modo vinculado pede retry; assinatura confirmada e fila anteriores ficam intactas",async()=>{
 const c=await setup();try{
  c.bind("mailersend");await receipt(c,"mailersend");
  await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at,seq) VALUES('QA Fictício','qa-preserve@example.test','qa-preserve-email-hash','qa-preserve-cpf-hash','apoiador','QA','2026-01-01T00:00:00Z','confirmed','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z',77)");
  await c.db.query("INSERT INTO mail_outbox(kind,to_addr,payload,status,attempts,created_at,next_attempt_at) VALUES('QA','qa-preserve@example.test',$1,'failed',2,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",[JSON.stringify({to:'qa-preserve@example.test',subject:'QA original',text:'QA original'})]);
  const snapshot=async()=>({signers:(await c.db.query("SELECT * FROM signatures ORDER BY id")).rows,queue:(await c.db.query("SELECT * FROM mail_outbox ORDER BY id")).rows});const before=await snapshot();
  await c.db.query("CREATE FUNCTION fail_webhook_aggregate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa_aggregate_fail'; END $$; CREATE TRIGGER fail_webhook_aggregate BEFORE INSERT ON mail_engagement FOR EACH ROW EXECUTE FUNCTION fail_webhook_aggregate()");
  assert.equal((await c.post("mailersend",ms())).status,503);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
  await c.db.query("DROP TRIGGER fail_webhook_aggregate ON mail_engagement; DROP FUNCTION fail_webhook_aggregate()");
  assert.equal((await c.post("mailersend",[ms(),ms()])).status,200);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,1);assert.deepEqual(await snapshot(),before);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.close();}
});


test("destinatário ausente ou malformado não polui agregados, supressão ou journal",async()=>{
 const c=await setup();try{
  for(const provider of ["brevo","mailersend","sendpulse"]){
   c.bind(provider);
   for(const to of [undefined,null,"bad",{},"undefined", "qa@example.test\nInjected"]){
    const payload=provider==="brevo"?{event:"hard_bounce",email:to,"message-id":"qa-message-id",ts_event:1794045600}:provider==="sendpulse"?{event:"hard_bounced",recipient:to,message_id:123,timestamp:1794045600}:ms({type:"activity.hard_bounced",data:{message_id:"qa-message-id",recipient:to}});
    assert.equal((await c.post(provider,payload)).status,200);
   }
  }
  for(const table of ["mail_engagement","mail_events","email_suppressions","mail_message_events"])assert.equal((await c.db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 }finally{await c.close();}
});
