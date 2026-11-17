import test from "node:test";
import type { SnsMessage } from "./mail/ses-events";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { credentialScope, snsScope, sendpulseScope, mailrelayScope } from "./mail/event-scope";
import { eventTimestamp } from "./mail/message-events";
import { sesMessageEvents } from "./mail/ses-message-events";
(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
const TOPIC="arn:aws:sns:sa-east-1:123456789012:qa-peticao-ses";
const OTHER="arn:aws:sns:sa-east-1:123456789012:qa-other-ses";
const SCOPE=()=>snsScope(TOPIC)!;
const ID="0100017352b73695-a103f18d-f0a3-4a48-9d86-db1df264a3fe-000000";
const AT="2026-11-07T00:00:00.123456Z", TO="qa-events@example.test", COPY="qa-copy@example.test";
async function setup(){const db=await import("./db");await db._openForTests("t_mail_message_events");return{db,A:await import("./mail/archive"),E:await import("./mail/message-events"),H:await import("./mail/history"),S:await import("./mail/ses-events")};}
function event(over:Record<string,unknown>={}){return{provider:"ses",accountScope:SCOPE(),providerId:ID,recipient:TO,type:"delivered",timestamp:AT,source:"sns" as const,...over};}
async function pair(c:Awaited<ReturnType<typeof setup>>,over:{scope?:string;id?:string;to?:string;provider?:string}={}){
 const m=await c.A.prepareMessage({to:over.to??TO,subject:"QA",text:"QA"},"confirmacao","transactional");const a=await c.A.beginAttempt(m.id,over.provider??"ses","qa-sender@example.test");assert.ok(a.ok);
 assert.ok((await c.A.finishAttempt(a.id,"accepted",{providerId:over.id??ID,accountScope:over.scope??SCOPE()})).ok);return{messageId:m.id,attemptId:a.id};
}
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const PEM=publicKey.export({type:"spki",format:"pem"}) as string;
async function signed(body:unknown,topic=TOPIC){
 const {stringToSign}=await import("./mail/ses-events");const m:Record<string,string>={Type:"Notification",MessageId:"qa-sns-event",TopicArn:topic,Timestamp:AT,Message:JSON.stringify(body),SignatureVersion:"2",SigningCertURL:"https://sns.sa-east-1.amazonaws.com/SimpleNotificationService-qa.pem"};
 const sign=createSign("RSA-SHA256");sign.update(stringToSign(m as never)!);m.Signature=sign.sign(privateKey,"base64");return m as SnsMessage;
}
const delivery=(recipients=[TO])=>({eventType:"Delivery",mail:{messageId:ID,sendingAccountId:"123456789012",destination:[TO,COPY],headers:[{name:"private",value:"NEVER_STORE_PAYLOAD"}]},delivery:{recipients,timestamp:AT},accountScope:snsScope(OTHER)});

test("escopos não expõem credenciais e distinguem chave, provedor, conta e tópico; horários preservam microssegundos",()=>{
 const a=credentialScope("brevo","QA_PRIVATE_KEY")!;assert.match(a,/^[a-f0-9]{64}$/);assert.equal(a,credentialScope("brevo","QA_PRIVATE_KEY"));
 for(const other of [credentialScope("brevo","other"),credentialScope("mailersend","QA_PRIVATE_KEY"),snsScope(TOPIC)])assert.notEqual(a,other);
 assert.notEqual(snsScope(TOPIC),snsScope(OTHER));assert.equal(snsScope("forged"),undefined);assert.equal(credentialScope("unknown","secret"),undefined);
 assert.notEqual(sendpulseScope("a\nb","c"),sendpulseScope("a","b\nc"));assert.equal(mailrelayScope("mailrelay","QA.IPZMARKETING.COM","k"),mailrelayScope("mailrelay","qa.ipzmarketing.com","k"));
 assert.equal(eventTimestamp(AT),AT);assert.equal(eventTimestamp("2026-11-06T21:00:00.123456-03:00"),AT);
 for(const bad of ["",undefined,"2026-02-31T00:00:00Z","0000-01-01T00:00:00Z","2026-11-07", "2026-11-07T00:00:00.1234567Z"])assert.equal(eventTimestamp(bad),undefined);
});

test("evento e recibo inequívocos vinculam uma vez; repetição não altera fatos nem datas e consulta não expõe escopo",async()=>{
 const c=await setup();try{
  const p=await pair(c);const before=(await c.db.query("SELECT * FROM mail_messages")).rows;
  const results=await Promise.all(Array.from({length:4},()=>c.E.recordMessageEvents([event()])));assert.equal(results.reduce((n,r)=>n+r.inserted,0),1);
  const rows=(await c.db.query("SELECT * FROM mail_message_events")).rows;assert.equal(rows.length,1);assert.equal(rows[0].association_state,"linked");assert.equal(rows[0].message_id,p.messageId);assert.equal(rows[0].attempt_id,p.attemptId);
  await c.E.recordMessageEvents([event()]);assert.deepEqual((await c.db.query("SELECT * FROM mail_message_events")).rows,rows);assert.deepEqual((await c.db.query("SELECT * FROM mail_messages")).rows,before);
  const detail=await c.H.mailHistoryDetail(`message:${p.messageId}`);assert.ok(detail.ok);assert.equal(detail.events!.length,1);assert.equal(detail.events![0].occurred_at,AT);assert.equal(detail.events_truncated,false);
  assert.ok(!JSON.stringify(detail).includes("account_scope"));assert.ok(!JSON.stringify(detail).includes("fingerprint"));assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("evento antes do resultado espera recibo; finalização concilia sem reescrever horários do evento",async()=>{
 const c=await setup();try{
  const m=await c.A.prepareMessage({to:TO,subject:"QA",text:"QA"},"confirmacao","transactional"),a=await c.A.beginAttempt(m.id,"ses","qa@example.test");assert.ok(a.ok);
  await c.E.recordMessageEvents([event()]);const before=(await c.db.query("SELECT * FROM mail_message_events")).rows[0];assert.equal(before.association_state,"unlinked");
  await c.A.finishAttempt(a.id,"accepted",{providerId:ID,accountScope:SCOPE()});const after=(await c.db.query("SELECT * FROM mail_message_events")).rows[0];
  assert.equal(after.message_id,m.id);assert.equal(after.association_state,"linked");for(const key of ["id","fingerprint","occurred_at","received_at","provider_id","recipient"])assert.deepEqual(after[key],before[key]);
  assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("mesmo ID em outra conta/provedor/destinatário não associa; identidade insuficiente não vira fato novo",async()=>{
 const c=await setup();try{
  await pair(c);
  await c.E.recordMessageEvents([event({accountScope:snsScope(OTHER)}),event({provider:"brevo"}),event({recipient:COPY})]);
  assert.ok((await c.db.query("SELECT association_state FROM mail_message_events")).rows.every(r=>r.association_state==="unlinked"));
  const result=await c.E.recordMessageEvents([event({accountScope:undefined}),event({providerId:undefined}),event({timestamp:"bad"}),event({accountScope:"NEVER_STORE_KEY"}),event({type:"unknown"})]);assert.equal(result.skipped,5);assert.equal(result.inserted,0);
  const serialized=JSON.stringify((await c.db.query("SELECT * FROM mail_message_events")).rows);assert.ok(!serialized.includes("NEVER_STORE_KEY"));
 }finally{await c.db._closeDbForTests();}
});

test("colisão posterior revoga vínculo anterior em vez de escolher um cadastro por horário",async()=>{
 const c=await setup();try{
  const p=await pair(c);await c.E.recordMessageEvents([event(),event({timestamp:"2026-11-07T00:00:00.123457Z",type:"opened"})]);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events WHERE message_id=$1",[p.messageId])).rows[0].n,2);
  await pair(c);const rows=(await c.db.query("SELECT association_state,message_id,attempt_id FROM mail_message_events")).rows;assert.ok(rows.every(r=>r.association_state==="ambiguous"&&r.message_id===null&&r.attempt_id===null));
  const detail=await c.H.mailHistoryDetail(`message:${p.messageId}`);assert.ok(detail.ok);assert.deepEqual(detail.events,[]);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("parser SES usa ID do provedor e destinatário real, ignora headers, escopo alegado e aberturas ambíguas",async()=>{
 const {sesToEngajamento}=await import("./mail/engajamento");
 const d=delivery([COPY]);const events=sesMessageEvents(d,TOPIC);assert.equal(events.length,1);assert.equal(events[0].recipient,COPY);assert.equal(events[0].accountScope,SCOPE());assert.notEqual(sesMessageEvents({...d,mail:{...d.mail,sendingAccountId:"999999999999"}},TOPIC)[0].accountScope,SCOPE());assert.ok(!JSON.stringify(events).includes("NEVER_STORE_PAYLOAD"));
 assert.deepEqual(sesToEngajamento(d).map(e=>e.email),[COPY]);
 for(const kind of ["Open","Click"]){const ambiguous={...delivery(),eventType:kind,open:{timestamp:AT},click:{timestamp:AT,link:"NEVER_STORE_TRACKER"}};assert.deepEqual(sesMessageEvents(ambiguous,TOPIC),[]);assert.deepEqual(sesToEngajamento(ambiguous),[]);}
 assert.deepEqual(sesMessageEvents({...delivery(),delivery:{recipients:[TO]}},TOPIC),[]);
 assert.deepEqual(sesMessageEvents({...delivery(),mail:{destination:[TO],headers:[{name:"Message-ID",value:ID}]}},TOPIC),[]);
 assert.deepEqual(sesMessageEvents({...delivery(),eventType:"Bounce",bounce:{bouncedRecipients:{emailAddress:TO}}},TOPIC),[]);
 assert.equal(sesMessageEvents({...delivery(),notificationType:"Delivery",eventType:undefined},TOPIC)[0].type,"delivered");
});

test("SNS exige tópico/assinatura antes de qualquer vínculo; reentrega não duplica e não muda assinatura",async()=>{
 const c=await setup();try{
  const p=await pair(c);const body=delivery(),m=await signed(body),getCert=async()=>PEM;
  assert.equal((await c.S.handleSns(await signed(body,OTHER),{getCert,topic:TOPIC})).status,403);
  assert.equal((await c.S.handleSns({...m,Signature:"AAAA"},{getCert,topic:TOPIC})).status,403);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
  const before=(await c.db.query("SELECT * FROM signatures")).rows;
  assert.equal((await c.S.handleSns(m,{getCert,topic:TOPIC})).status,200);assert.equal((await c.S.handleSns(m,{getCert,topic:TOPIC})).status,200);
  const rows=(await c.db.query("SELECT * FROM mail_message_events")).rows;assert.equal(rows.length,1);assert.equal(rows[0].message_id,p.messageId);assert.ok(!JSON.stringify(rows).includes("NEVER_STORE_PAYLOAD"));
  assert.deepEqual((await c.db.query("SELECT * FROM signatures")).rows,before);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("falha de journal pede retry ao handler sem desfazer supressão já aplicada; retry recupera evento",async()=>{
 const c=await setup();try{
  const body={eventType:"Bounce",mail:{messageId:ID,sendingAccountId:"123456789012",destination:[TO]},bounce:{bounceType:"Permanent",timestamp:AT,bouncedRecipients:[{emailAddress:TO,diagnosticCode:"550 fake"}]}};
  const m=await signed(body),getCert=async()=>PEM;
  await c.db.query("CREATE FUNCTION fail_events_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_message_events_received' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_events_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_events_audit()");
  await assert.rejects(c.S.handleSns(m,{getCert,topic:TOPIC}));assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM email_suppressions WHERE email=$1",[TO])).rows[0].n,1);
  await c.db.query("DROP TRIGGER fail_events_audit ON audit_log");assert.equal((await c.S.handleSns(m,{getCert,topic:TOPIC})).status,200);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,1);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_events")).rows[0].n,1);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("falha de conciliação reverte recibo e vínculos atomicamente, mantendo bloqueio de tentativa preparada",async()=>{
 const c=await setup();try{
  const m=await c.A.prepareMessage({to:TO,subject:"QA",text:"QA"},"confirmacao","transactional"),a=await c.A.beginAttempt(m.id,"ses","qa@example.test");assert.ok(a.ok);
  await c.E.recordMessageEvents([event()]);const before=(await c.db.query("SELECT * FROM mail_message_events")).rows;
  await c.db.query("CREATE FUNCTION fail_link_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_message_events_reconciled' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_link_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_link_audit()");
  await assert.rejects(c.A.finishAttempt(a.id,"accepted",{providerId:ID,accountScope:SCOPE()}));assert.deepEqual((await c.db.query("SELECT * FROM mail_message_events")).rows,before);
  assert.equal((await c.db.query("SELECT state FROM mail_message_attempts WHERE id=$1",[a.id])).rows[0].state,"prepared");assert.equal((await c.A.beginAttempt(m.id,"ses","qa@example.test")).ok,false);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("upgrade aditivo preserva mensagens, tentativas antigas sem escopo, filas e datas",async()=>{
 const c=await setup();try{
  const m=await c.A.prepareMessage({to:TO,subject:"QA",text:"QA"},"confirmacao","transactional"),a=await c.A.beginAttempt(m.id,"ses","qa@example.test");assert.ok(a.ok);await c.A.finishAttempt(a.id,"accepted",{providerId:ID});
  await (await import("./mail/outbox")).enqueueMail({to:TO,subject:"QA legado",text:"QA fila preservada"},"confirmacao","fixture");
  await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,status,confirmed_at,seq,verify_code) VALUES('QA Migração',$1,'qa-email-hash','qa-cpf-hash','apoiador','qa','2026-11-01T10:00:00.000Z','2026-11-01T10:00:00.000Z','confirmed','2026-11-01T10:01:00.000Z',77,'ABCDEFGHJK')",[TO]);
  const snapshot=async()=>(await c.db.query("SELECT to_jsonb(m) data FROM mail_messages m UNION ALL SELECT to_jsonb(a)-'account_scope' FROM mail_message_attempts a UNION ALL SELECT to_jsonb(q) FROM mail_outbox q UNION ALL SELECT to_jsonb(a) FROM audit_log a UNION ALL SELECT to_jsonb(s) FROM signatures s")).rows;
  const before=await snapshot();await c.db.query("DROP TABLE mail_message_events; ALTER TABLE mail_message_attempts DROP COLUMN account_scope");
  const schema=process.env.DATABASE_SCHEMA!;delete process.env.DATABASE_SCHEMA;try{await c.db._closeDbForTests();}finally{process.env.DATABASE_SCHEMA=schema;}
  await c.db.query("SELECT 1");assert.deepEqual(await snapshot(),before);assert.equal((await c.db.query("SELECT account_scope FROM mail_message_attempts")).rows[0].account_scope,null);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});


test("envio SES captura escopo e SNS assinado associa o recibo real sem alterar inscrição/consentimento",async()=>{
 const c=await setup(),M=await import("./mail"),nodemailer=(await import("nodemailer")).default,original=nodemailer.createTransport;
 const keys=["MAIL_PROVIDER","MAIL_PROVIDERS","SMTP_URL","SES_SNS_TOPIC_ARN","PREVIEW_MODE","MAIL_ARCHIVE_RETENTION","SES_SENDING_ACCOUNT_ID"],saved=new Map(keys.map(k=>[k,process.env[k]]));
 try{
  await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,status,confirmed_at,seq,verify_code) VALUES('QA Evento Fictício',$1,'qa-email-hash','qa-cpf-hash','apoiador','qa','2026-11-01T10:00:00.000Z','2026-11-01T10:00:00.000Z','confirmed','2026-11-01T10:01:00.000Z',77,'ABCDEFGHJK')",[TO]);
  const before=(await c.db.query("SELECT * FROM signatures")).rows;
  process.env.MAIL_PROVIDER="ses";delete process.env.MAIL_PROVIDERS;delete process.env.PREVIEW_MODE;delete process.env.MAIL_ARCHIVE_RETENTION;process.env.SMTP_URL="smtps://qa:fake@email-smtp.sa-east-1.amazonaws.com:465";process.env.SES_SNS_TOPIC_ARN=TOPIC;delete process.env.SES_SENDING_ACCOUNT_ID;
  nodemailer.createTransport=(()=>({sendMail:async()=>({messageId:"LOCAL_NOT_PROVIDER",response:`250 Ok ${ID}`})})) as never;
  assert.equal(await M.sendMail({to:TO,bcc:[COPY],subject:"QA",text:"QA"},"confirmacao",{queue:false}),"sent");await M.waitForBackgroundMail();
  const a=(await c.db.query("SELECT * FROM mail_message_attempts")).rows[0];assert.equal(a.provider_id,ID);assert.equal(a.account_scope,SCOPE());
  assert.equal((await c.S.handleSns(await signed(delivery()),{getCert:async()=>PEM,topic:TOPIC})).status,200);
  const d=await c.H.mailHistoryDetail(`message:${a.message_id}`);assert.ok(d.ok);assert.equal(d.events!.length,1);assert.equal(d.record.status,"accepted");assert.deepEqual((await c.db.query("SELECT * FROM signatures")).rows,before);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{nodemailer.createTransport=original;await M.waitForBackgroundMail();for(const[k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}await c.db._closeDbForTests();}
});

test("cache OAuth do SendPulse é vinculado à credencial usada e não mistura contas após troca",async()=>{
 const M=await import("./mail");M._clearSendpulseToken();const seen:{auth:string;token:string}[]= [];let issued="";
 const fake=(async(url:string,init:RequestInit)=>{
  const body=JSON.parse(init.body as string);
  if(url.endsWith("access_token")){issued=`QA_TOKEN_${body.client_id}`;return new Response(JSON.stringify({access_token:issued,expires_in:3600}));}
  seen.push({auth:(init.headers as Record<string,string>).Authorization,token:issued});return new Response(JSON.stringify({result:true,id:"qa-id"}));
 }) as typeof fetch;
 const first=await M.sendSendpulseWith(fake,{id:"one",secret:"qa-one"},{to:TO,subject:"QA",text:"QA"},"QA <qa@example.test>");
 const second=await M.sendSendpulseWith(fake,{id:"two",secret:"qa-two"},{to:TO,subject:"QA",text:"QA"},"QA <qa@example.test>");
 assert.deepEqual(seen.map(x=>x.auth),["Bearer QA_TOKEN_one","Bearer QA_TOKEN_two"]);assert.notEqual(first.accountScope,second.accountScope);M._clearSendpulseToken();
});
