// Metadata-only recovery through compiled HTTP. No transport/provider call.
import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
const base=new URL(process.env.QA_BASE_URL??"http://127.0.0.1:3032"),url=new URL(process.env.DATABASE_URL??"http://missing");
assert.equal(base.hostname,"127.0.0.1");assert.equal(url.hostname,"127.0.0.1");assert.ok(base.port==="3032"&&url.port==="54345"||base.port==="3033"&&url.port==="54349");assert.equal(process.env.PREVIEW_MODE,"1");assert.equal(process.env.ADMIN_NO_PASSWORD,"0");assert.equal(process.env.MAIL_PROVIDER,"dev");
const output=process.env.QA_OUTPUT_DIR;assert.ok(output);await mkdir(output,{recursive:true});assert.equal((await fetch(new URL("/admin",base))).status,200);
const [db,A,U]=await Promise.all([import("../../site/src/lib/db.ts"),import("../../site/src/lib/mail/archive.ts"),import("../../site/src/lib/admin-users.ts")]).then(ms=>ms.map(m=>m.default??m));
let token;
try{
 assert.equal((await db.query("SELECT count(*)::int n FROM signatures WHERE email NOT LIKE '%@example.test'")).rows[0].n,0);
 await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at,seq) VALUES('QA','qa-recovery-preserved@example.test','qa-rec-eh','qa-rec-ch','apoiador','QA','2026-01-01Z','confirmed','2026-01-01Z','2026-01-02Z',77)");
 const mail={to:"qa-recovery-runtime@example.test",subject:"NEVER_EXPOSE_SUBJECT",text:"NEVER_EXPOSE_BODY"};const message=await A.prepareMessage(mail,"confirmacao","transactional"),qid=await A.queueMessage(mail,"confirmacao","QA",message.id),a=await A.beginAttempt(message.id,"dev","qa@example.test");assert.ok(a.ok);assert.ok((await A.finishAttempt(a.id,"accepted")).ok);
 const at="2026-11-01T10:00:00.123456Z";await db.query("UPDATE mail_message_attempts SET finished_at=$2 WHERE id=$1",[a.id,at]);await db.query("UPDATE mail_outbox SET status='failed',last_error='mail_rollback_quarantine' WHERE id=$1",[qid]);
 const before=(await db.query("SELECT * FROM mail_outbox WHERE id=$1",[qid])).rows[0];
 const preserved=async()=>(await db.query("SELECT row_to_json(s) data FROM signatures s UNION ALL SELECT row_to_json(m) FROM mail_messages m UNION ALL SELECT row_to_json(a) FROM mail_message_attempts a")).rows;const original=await preserved();
 const user=await U.criarUsuario({email:"qa-recovery-total@example.test",nome:"QA Recovery",nivel:"total",senha:"QA-Recovery-Runtime-2026-Ficticia"});assert.ok(user.ok);token=(await U.abrirSessao(user.usuario.id,"127.0.0.1")).token;
 const request=async(method="GET",auth=token)=>{const target=new URL(`/api/admin/emails/recuperacao${method==="GET"?`?id=${qid}`:""}`,base);const r=await fetch(target,{method,headers:{origin:base.origin,cookie:auth?`adm=${auth}`:"",...(method==="POST"?{"content-type":"application/json"}:{})},...(method==="POST"?{body:JSON.stringify({id:qid})}:{})});return{status:r.status,data:await r.json()};};
 assert.equal((await request("GET","")).status,401);assert.equal((await request()).status,403);await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1",[user.usuario.id]);
 const diagnosis=await request();assert.equal(diagnosis.status,200);assert.equal(diagnosis.data.eligible,true);assert.equal(diagnosis.data.acceptedAt,at);assert.ok(!JSON.stringify(diagnosis.data).includes("NEVER_EXPOSE"));
 const listResponse=await fetch(new URL("/api/admin/emails/recuperacao?limit=1",base),{headers:{origin:base.origin,cookie:`adm=${token}`}});assert.equal(listResponse.status,200);const list=await listResponse.json();assert.equal(list.records.length,1);assert.equal(list.records[0].queueId,qid);assert.deepEqual(Object.keys(list.records[0]).sort(),["acceptedAt","kind","queueId","toAddr"]);assert.ok(!JSON.stringify(list).includes("NEVER_EXPOSE"));
 const r=await request("POST");assert.equal(r.status,200);assert.equal(r.data.existing,false);assert.equal((await request("POST")).data.existing,true);
 const after=(await db.query("SELECT * FROM mail_outbox WHERE id=$1",[qid])).rows[0];assert.equal(after.status,"sent");assert.equal(after.last_error,null);for(const field of ["payload","id","kind","to_addr","message_id","created_at","attempts","next_attempt_at"])assert.deepEqual(after[field],before[field]);
 assert.equal((await db.query("SELECT to_char(sent_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') at FROM mail_outbox WHERE id=$1",[qid])).rows[0].at,at);assert.deepEqual(await preserved(),original);
 const audits=(await db.query("SELECT data FROM audit_log WHERE event='mail_queue_acceptance_recovered'")).rows;assert.equal(audits.length,1);assert.equal(JSON.parse(audits[0].data).userId,user.usuario.id);assert.ok((await db.verifyAuditChain()).ok);
 await db.query("UPDATE mail_outbox SET created_at=now()-interval '31 days' WHERE id=$1",[qid]);
 const cm=await import("../../site/src/lib/admin-content-retention.ts"),C=cm.default??cm;
 assert.equal((await C.purgeAdminContent()).outbox,1);
 const purged=(await db.query("SELECT row_to_json(q)::text raw FROM mail_outbox q ORDER BY id")).rows;
 assert.deepEqual((await db.query("SELECT payload FROM mail_outbox WHERE id=$1",[qid])).rows[0].payload,{});
 assert.equal((await request()).data.reason,"already_settled");
 const replays=await Promise.all(Array.from({length:3},()=>request("POST")));assert.ok(replays.every(r=>r.status===200&&r.data.existing===true));
 const oversized=await fetch(new URL("/api/admin/emails/recuperacao",base),{method:"POST",headers:{origin:base.origin,cookie:`adm=${token}`,"content-type":"application/json"},body:"x".repeat(257)});assert.equal(oversized.status,413);
 assert.deepEqual((await db.query("SELECT row_to_json(q)::text raw FROM mail_outbox q ORDER BY id")).rows,purged);
 assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='mail_queue_acceptance_recovered'")).rows[0].n,1);
 await db.query("ALTER TABLE mail_message_attempts RENAME TO qa_unavailable_attempts");
 try{const failed=await fetch(new URL("/api/admin/emails/recuperacao",base),{headers:{origin:base.origin,cookie:`adm=${token}`}});assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{ok:false,error:"unavailable"});}
 finally{await db.query("ALTER TABLE qa_unavailable_attempts RENAME TO mail_message_attempts");}
 assert.equal((await request()).status,200);assert.deepEqual(await preserved(),original);assert.ok((await db.verifyAuditChain()).ok);
 const report={ok:true,compiledRecoveryAuthorization:true,compiledRecoveryList:true,stepupRequired:true,acceptedProofRequired:true,noTransportCalled:true,originalAcceptanceTime:true,duplicateIdempotent:true,payloadAndAttemptsPreserved:true,signersAndMessagesPreserved:true,actualActorAudited:true,noContentExposed:true,replayAfterContentPurge:true,concurrentReplayAfterPurge:true,boundedBody:true,sourceFailureAndRecovery:true};await writeFile(`${output}/mail-recovery.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(token)await U.encerrarSessao(token);await db._closeDbForTests();}
