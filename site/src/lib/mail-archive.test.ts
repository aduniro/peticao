import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serializeMail,encryptMail,decryptMail } from "./mail/archive-codec";
(process.env as Record<string,string>).NODE_ENV="test";process.env.MAIL_PROVIDER="dev";delete process.env.MAIL_PROVIDERS;
const mail=()=>({to:"archive@example.test",bcc:["qa-owner@example.test"],replyTo:"qa-reply@example.test",subject:"never-plain-subject",text:"never-plain-token",html:"<p>never-plain-html</p>",attachments:[{filename:"fixture.pdf",content:Buffer.from([0,1,255,32,10]),contentType:"application/pdf"}]});
async function setup(){const db=await import("./db");await db._openForTests("t_mail_archive");return {db,A:await import("./mail/archive")};}
const until=()=>new Date(Date.now()+3600000);

test("conteúdo cifrado conserva envelope e bytes; adulteração, outro ID e outra chave falham",()=>{
 const id=randomUUID(),value=mail(),serialized=serializeMail(value),cipher=encryptMail(id,serialized);assert.ok(!cipher.includes(value.subject));assert.deepEqual(decryptMail(id,cipher),value);
 assert.notEqual(encryptMail(id,serialized),cipher);assert.throws(()=>decryptMail(randomUUID(),cipher),/archive_invalid/);
 const parts=cipher.split(".");parts[2]=(parts[2][0]==="a"?"b":"a")+parts[2].slice(1);assert.throws(()=>decryptMail(id,parts.join(".")),/archive_invalid/);
 assert.throws(()=>decryptMail(id,cipher+"!"),/archive_invalid/);
 const previous=process.env.HASH_PEPPER;try{process.env.HASH_PEPPER="fixture-other-pepper-not-a-production-key";assert.throws(()=>decryptMail(id,cipher),/archive_invalid/);}finally{if(previous===undefined)delete process.env.HASH_PEPPER;else process.env.HASH_PEPPER=previous;}
});

test("mesma chave de pedido reserva uma mensagem; conteúdo diferente é recusado e o prazo não renova",async()=>{
 const c=await setup();try{
  const input=mail(),deadline=until();const results=await Promise.all(Array.from({length:5},()=>c.A.prepareMessage(input,"confirmacao","transactional",{requestKey:"never-request-token",archive:{until:deadline}})));
  assert.equal(new Set(results.map(r=>r.id)).size,1);assert.equal(results.filter(r=>!r.existing).length,1);
  const id=results[0].id,row=(await c.db.query("SELECT * FROM mail_messages WHERE id=$1",[id])).rows[0];
  for(const text of [input.subject,input.text,"never-request-token",input.html])assert.ok(!JSON.stringify(row).includes(text));
  await assert.rejects(c.A.prepareMessage({...input,text:"changed"},"confirmacao","transactional",{requestKey:"never-request-token"}),/message_conflict/);
  await c.A.prepareMessage(input,"confirmacao","transactional",{requestKey:"never-request-token",archive:{until:new Date(deadline.getTime()+86400000)}});
  assert.deepEqual((await c.db.query("SELECT * FROM mail_messages WHERE id=$1",[id])).rows[0],row);
  const content=await c.A.archivedContent(id);assert.ok(content.state==="stored");assert.deepEqual(content.mail,input);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("sem política de conteúdo só há metadados; versões novas não reescrevem a mensagem anterior",async()=>{
 const c=await setup();try{
  const hidden=await c.A.prepareMessage(mail(),"confirmacao","transactional");assert.deepEqual(await c.A.archivedContent(hidden.id),{state:"unavailable"});
  const first=await c.A.prepareMessage(mail(),"admin","transactional",{archive:{until:null}});const before=(await c.db.query("SELECT * FROM mail_messages WHERE id=$1",[first.id])).rows[0];
  const second=await c.A.prepareMessage({...mail(),subject:"new-version"},"admin","transactional",{archive:{until:until()},previousId:first.id});assert.notEqual(second.id,first.id);
  assert.deepEqual((await c.db.query("SELECT * FROM mail_messages WHERE id=$1",[first.id])).rows[0],before);assert.equal((await c.db.query("SELECT previous_id FROM mail_messages WHERE id=$1",[second.id])).rows[0].previous_id,first.id);
  await assert.rejects(c.A.prepareMessage(mail(),"admin","transactional",{archive:{until:new Date(0)}}),/archive_expired/);
 }finally{await c.db._closeDbForTests();}});

test("admissão de tentativa concorrente é única; aceite é terminal e repetição de resultado é idempotente",async()=>{
 const c=await setup();try{
  const message=await c.A.prepareMessage(mail(),"confirmacao","transactional");
  const starts=await Promise.all(Array.from({length:6},()=>c.A.beginAttempt(message.id,"dev","QA <qa@example.test>")));assert.equal(starts.filter(r=>r.ok).length,1);const first=starts.find(r=>r.ok)!;assert.ok(first.ok);
  const results=await Promise.all(Array.from({length:4},()=>c.A.finishAttempt(first.id,"accepted",{providerId:"provider-fixture"})));assert.ok(results.every(r=>r.ok));assert.equal(results.filter(r=>r.ok&&!r.existing).length,1);
  assert.deepEqual(await c.A.beginAttempt(message.id,"smtp","QA <qa@example.test>"),{ok:false,error:"already_accepted"});
  assert.deepEqual(await c.A.finishAttempt(first.id,"rejected"),{ok:false,error:"outcome_conflict"});
  const logs=(await c.db.query("SELECT * FROM mail_log WHERE message_id=$1",[message.id])).rows;assert.equal(logs.length,1);assert.equal(logs[0].status,"sent");assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("recusa conhecida admite outro provedor; incerteza não vira recusa nem repetição automática",async()=>{
 const c=await setup();try{
  const message=await c.A.prepareMessage(mail(),"confirmacao","transactional");const first=await c.A.beginAttempt(message.id,"dev","QA <qa@example.test>");assert.ok(first.ok);await c.A.finishAttempt(first.id,"rejected",{errorCode:"provider_rejected"});
  const next=await c.A.beginAttempt(message.id,"smtp","QA <qa@example.test>");assert.ok(next.ok);await c.A.finishAttempt(next.id,"indeterminate",{errorCode:"transport_uncertain"});
  assert.deepEqual(await c.A.beginAttempt(message.id,"dev","QA <qa@example.test>"),{ok:false,error:"indeterminate"});
  const explicit=await c.A.beginAttempt(message.id,"dev","QA <qa@example.test>",{retryUncertain:true});assert.ok(explicit.ok);await c.A.finishAttempt(explicit.id,"rejected");
  assert.equal((await c.db.query("SELECT status FROM mail_messages WHERE id=$1",[message.id])).rows[0].status,"indeterminate");
  assert.equal((await c.db.query("SELECT 1 FROM mail_message_attempts WHERE message_id=$1 AND state='indeterminate'",[message.id])).rowCount,1);
 }finally{await c.db._closeDbForTests();}});

test("falha de auditoria reverte admissão/resultado; uma possível entrega não dispara segunda tentativa",async()=>{
 const c=await setup();try{
  const message=await c.A.prepareMessage(mail(),"confirmacao","transactional");
  await c.db.query(`CREATE FUNCTION fail_archive_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('mail_message_attempt_started','mail_message_attempt_finished') THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_archive_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_archive_audit()`);
  await assert.rejects(c.A.beginAttempt(message.id,"dev","QA <qa@example.test>"));assert.equal((await c.db.query("SELECT 1 FROM mail_message_attempts")).rowCount,0);
  await c.db.query("DROP TRIGGER fail_archive_audit ON audit_log");const attempt=await c.A.beginAttempt(message.id,"dev","QA <qa@example.test>");assert.ok(attempt.ok);
  await c.db.query("CREATE TRIGGER fail_archive_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_archive_audit()");await assert.rejects(c.A.finishAttempt(attempt.id,"accepted"));
  assert.equal((await c.db.query("SELECT state FROM mail_message_attempts WHERE id=$1",[attempt.id])).rows[0].state,"prepared");assert.equal((await c.db.query("SELECT 1 FROM mail_log")).rowCount,0);
  assert.deepEqual(await c.A.beginAttempt(message.id,"smtp","QA <qa@example.test>"),{ok:false,error:"in_progress"});
  await c.db.query("DROP TRIGGER fail_archive_audit ON audit_log");assert.ok((await c.A.finishAttempt(attempt.id,"accepted")).ok);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("vínculo com a fila exige conteúdo exato e não troca a identidade existente",async()=>{
 const c=await setup();try{
  const input=mail(),message=await c.A.prepareMessage(input,"confirmacao","transactional"),other=await c.A.prepareMessage(input,"confirmacao","transactional");
  const stored={...input,attachments:input.attachments.map(a=>({filename:a.filename,contentType:a.contentType,contentBase64:a.content.toString("base64")}))};
  const id=(await c.db.query("INSERT INTO mail_outbox(kind,to_addr,payload) VALUES('confirmacao',$1,$2) RETURNING id",[input.to,JSON.stringify({...stored,text:"different"})])).rows[0].id;
  assert.equal((await c.A.linkOutbox(id,message.id)).ok,false);await c.db.query("UPDATE mail_outbox SET payload=$2 WHERE id=$1",[id,JSON.stringify(stored)]);
  const before=(await c.db.query("SELECT * FROM mail_outbox WHERE id=$1",[id])).rows[0];assert.deepEqual(await c.A.linkOutbox(id,message.id),{ok:true,existing:false});assert.deepEqual(await c.A.linkOutbox(id,message.id),{ok:true,existing:true});assert.equal((await c.A.linkOutbox(id,other.id)).ok,false);
  const after=(await c.db.query("SELECT * FROM mail_outbox WHERE id=$1",[id])).rows[0];assert.deepEqual({...after,message_id:null},before);assert.equal(after.message_id,message.id);
 }finally{await c.db._closeDbForTests();}});

test("prazo usa o relógio do banco; expiração remove só conteúdo e não apaga tentativas/histórico",async()=>{
 const c=await setup();try{
  const message=await c.A.prepareMessage(mail(),"admin","transactional",{archive:{until:until()}});const attempt=await c.A.beginAttempt(message.id,"dev","QA <qa@example.test>");assert.ok(attempt.ok);await c.A.finishAttempt(attempt.id,"accepted");
  await c.db.query("UPDATE mail_messages SET content_expires_at=now()-interval '1 second' WHERE id=$1",[message.id]);assert.deepEqual(await c.A.archivedContent(message.id),{state:"expired"});assert.ok((await c.db.query("SELECT content_cipher FROM mail_messages WHERE id=$1",[message.id])).rows[0].content_cipher);
  assert.equal(await c.A.purgeArchivedContent(),1);assert.equal(await c.A.purgeArchivedContent(),0);
  const row=(await c.db.query("SELECT * FROM mail_messages WHERE id=$1",[message.id])).rows[0];assert.equal(row.content_cipher,null);assert.equal(row.status,"accepted");assert.equal(row.content_state,"expired");assert.equal((await c.db.query("SELECT 1 FROM mail_message_attempts WHERE message_id=$1",[message.id])).rowCount,1);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("cópia de ciphertext de outra mensagem não é exibida nem corrompe o histórico",async()=>{
 const c=await setup();try{
  const first=await c.A.prepareMessage(mail(),"admin","transactional",{archive:{until:null}}),second=await c.A.prepareMessage({...mail(),text:"second"},"admin","transactional",{archive:{until:null}});
  await c.db.query("UPDATE mail_messages SET content_cipher=(SELECT content_cipher FROM mail_messages WHERE id=$2) WHERE id=$1",[first.id,second.id]);assert.deepEqual(await c.A.archivedContent(first.id),{state:"unreadable"});assert.equal((await c.A.archivedContent(second.id)).state,"stored");
 }finally{await c.db._closeDbForTests();}});

test("limite do arquivo não impede criar identidade de e-mail com anexo grande",async()=>{
 const c=await setup();try{
  const large={...mail(),attachments:[{filename:"large-fixture.pdf",content:Buffer.alloc(13*1024*1024),contentType:"application/pdf"}]};
  assert.throws(()=>serializeMail(large),/archive_size/);
  const result=await c.A.prepareMessage(large,"lote","transactional",{archive:{until:until()}});assert.deepEqual(await c.A.archivedContent(result.id),{state:"oversize"});
  assert.equal((await c.db.query("SELECT content_cipher FROM mail_messages WHERE id=$1",[result.id])).rows[0].content_cipher,null);
  const metadata=await c.A.prepareMessage(large,"lote","transactional");assert.equal((await c.A.archivedContent(metadata.id)).state,"unavailable");
  await assert.rejects(c.A.prepareMessage(mail(),"admin","transactional",{archive:{} as any}),/archive_parameters/);
 }finally{await c.db._closeDbForTests();}});

test("expurgo com auditoria indisponível não remove conteúdo silenciosamente",async()=>{
 const c=await setup();try{
  const message=await c.A.prepareMessage(mail(),"admin","transactional",{archive:{until:until()}});
  await c.db.query("UPDATE mail_messages SET content_expires_at=now()-interval '1 second'");
  await c.db.query(`CREATE FUNCTION fail_purge_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_message_content_expired' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_purge_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_purge_audit()`);
  await assert.rejects(c.A.purgeArchivedContent());assert.ok((await c.db.query("SELECT content_cipher FROM mail_messages WHERE id=$1",[message.id])).rows[0].content_cipher);
  assert.deepEqual(await c.A.archivedContent(message.id),{state:"expired"});
  await c.db.query("DROP TRIGGER fail_purge_audit ON audit_log");assert.equal(await c.A.purgeArchivedContent(),1);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});
