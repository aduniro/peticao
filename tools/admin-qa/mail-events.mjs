// Compiled read/auth HTTP + authenticated source fixture. No real SNS publication or provider call.
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
const base=new URL(process.env.QA_BASE_URL??"http://127.0.0.1:3032"),url=new URL(process.env.DATABASE_URL??"http://missing");
assert.equal(base.hostname,"127.0.0.1");assert.equal(base.port,"3032");assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"54345");assert.equal(url.pathname,"/peticao");
assert.equal(process.env.PREVIEW_MODE,"1");assert.equal(process.env.ADMIN_NO_PASSWORD,"0");assert.equal(process.env.MAIL_PROVIDER,"dev");
const topic=process.env.SES_SNS_TOPIC_ARN,output=process.env.QA_OUTPUT_DIR;assert.ok(topic&&output);assert.match(topic,/^arn:aws:sns:sa-east-1:123456789012:qa-/);await mkdir(output,{recursive:true});
const boot=await fetch(new URL("/admin",base));assert.equal(boot.status,200);assert.ok((await boot.text()).includes("/dev/outbox"));
const dm=await import("../../site/src/lib/db.ts"),am=await import("../../site/src/lib/mail/archive.ts"),sm=await import("../../site/src/lib/mail/ses-events.ts"),um=await import("../../site/src/lib/admin-users.ts"),em=await import("../../site/src/lib/mail/event-scope.ts");
const db=dm.default??dm,A=am.default??am,S=sm.default??sm,U=um.default??um,E=em.default??em;
let token;
try{
 assert.equal((await db.query("SELECT count(*)::int n FROM signatures WHERE email NOT LIKE '%@example.test'")).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
 const recipient="qa-event-runtime@example.test",copy="qa-event-copy@example.test",at="2026-11-07T01:00:00.123456Z",id="0100017352b73695-a103f18d-f0a3-4a48-9d86-db1df264a3fe-000000";
 const signatureSnapshot=async()=>(await db.query("SELECT id,name,cpf_hash,email_hash,status,seq,created_at,confirmed_at,consent_at FROM signatures ORDER BY id")).rows;
 const before=await signatureSnapshot();
 const message=await A.prepareMessage({to:recipient,subject:"QA",text:"QA"},"confirmacao","transactional"),attempt=await A.beginAttempt(message.id,"ses","qa-sender@example.test");assert.ok(attempt.ok);
 assert.ok((await A.finishAttempt(attempt.id,"accepted",{providerId:id,accountScope:E.snsScope(topic)})).ok);
 const actor="qa-event-editor@example.test",created=await U.criarUsuario({email:actor,nome:"QA Eventos",nivel:"edicao",senha:"QA-Local-Evento-2026-Ficticia"});assert.ok(created.ok);token=(await U.abrirSessao(created.usuario.id,"127.0.0.1")).token;
 const detailPath=`/api/admin/emails/mensagens?id=message:${message.id}`;
 const read=async(auth=token)=>{const r=await fetch(new URL(detailPath,base),{headers:{origin:base.origin,cookie:auth?`adm=${auth}`:""}});return{status:r.status,data:await r.json()};};
 assert.equal((await read("")).status,401);assert.equal((await read()).status,200);assert.deepEqual((await read()).data.events,[]);
 const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048}),pem=publicKey.export({type:"spki",format:"pem"});
 const envelope=body=>{const m={Type:"Notification",MessageId:"qa-runtime-sns",TopicArn:topic,Timestamp:at,Message:JSON.stringify(body),SignatureVersion:"2",SigningCertURL:"https://sns.sa-east-1.amazonaws.com/SimpleNotificationService-qa.pem"};const sign=createSign("RSA-SHA256");sign.update(S.stringToSign(m));return{...m,Signature:sign.sign(privateKey,"base64")};};
 const body=recipients=>({eventType:"Delivery",mail:{messageId:id,sendingAccountId:"123456789012",destination:[recipient,copy],headers:[{name:"private",value:"NEVER_STORE_EVENT_PAYLOAD"}]},delivery:{timestamp:at,recipients}});
 const post=payload=>fetch(new URL("/api/ses/eventos",base),{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify(payload)});
 assert.equal((await post({...envelope(body([recipient])),TopicArn:topic+"-wrong"})).status,403);
 // Invalid certificate host is rejected before any certificate fetch or event processing.
 assert.equal((await post({...envelope(body([recipient])),SigningCertURL:"https://not-aws.example.test/cert.pem"})).status,403);
 assert.equal((await db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
 // Positive provider signature is a local fixture passed through the real source helper, not an HTTP bypass.
 assert.equal((await S.handleSns(envelope(body([copy])),{getCert:async()=>pem,topic})).status,200);assert.deepEqual((await read()).data.events,[]);
 const valid=envelope(body([recipient]));assert.equal((await S.handleSns(valid,{getCert:async()=>pem,topic})).status,200);assert.equal((await S.handleSns(valid,{getCert:async()=>pem,topic})).status,200);
 const response=await read();assert.equal(response.status,200);assert.equal(response.data.events.length,1);assert.equal(response.data.events[0].occurred_at,at);assert.equal(response.data.events[0].event_type,"delivered");assert.equal(response.data.record.status,"accepted");
 const text=JSON.stringify(response.data);for(const bad of ["NEVER_STORE_EVENT_PAYLOAD","account_scope","fingerprint"])assert.ok(!text.includes(bad));
 const rows=(await db.query("SELECT association_state,recipient FROM mail_message_events ORDER BY id")).rows;assert.deepEqual(rows,[{association_state:"unlinked",recipient:copy},{association_state:"linked",recipient}]);assert.deepEqual(await signatureSnapshot(),before);
 assert.equal((await db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n,0);assert.ok((await db.verifyAuditChain()).ok);
 const report={ok:true,compiledMetadataAuth:true,compiledSnsRejectsUntrusted:true,positiveSourceUsesFixtureCertificate:true,actualRecipientRequired:true,duplicateIdempotent:true,microsecondsPreserved:true,noScopeOrPayloadExposed:true,noSignerWrites:true,noMailSent:true};
 await writeFile(`${output}/mail-events.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(token)await U.encerrarSessao(token);await db._closeDbForTests();}
