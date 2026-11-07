import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
(process.env as Record<string,string>).NODE_ENV="test";process.env.MAIL_PROVIDER="dev";delete process.env.MAIL_PROVIDERS;
const fence=readFileSync(join(__dirname,"../../../deploy/mail-rollback.sql"),"utf8");
const mail=(n:number)=>({to:`rollback-${n}@example.test`,subject:`QA ${n}`,text:"QA rollback fixture"});
async function setup(){const db=await import("./db");await db._openForTests("t_mail_rollback");const A=await import("./mail/archive"),O=await import("./mail/outbox");return{db,A,O};}
async function pair(c:Awaited<ReturnType<typeof setup>>,n:number,state?:"accepted"|"rejected"|"indeterminate"|"prepared"){
 const m=mail(n),record=await c.A.prepareMessage(m,"confirmacao","transactional"),id=await c.A.queueMessage(m,"confirmacao","fixture",record.id);
 if(state){const attempt=await c.A.beginAttempt(record.id,"dev","QA <qa@example.test>");assert.ok(attempt.ok);if(state!=="prepared")await c.A.finishAttempt(attempt.id,state);}
 return {id,messageId:record.id};
}

test("rollback encerra aceite comprovado e retém demais filas correlacionadas sem alterar mensagens/assinaturas",async()=>{
 const c=await setup();try{
  const accepted=await pair(c,1,"accepted"),pending=await pair(c,2,"prepared"),uncertain=await pair(c,3,"indeterminate"),rejected=await pair(c,4,"rejected"),untried=await pair(c,5);
  const legacy=await c.O.enqueueMail(mail(6),"confirmacao","legacy");
  await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at) VALUES('Pessoa Fictícia','signature@example.test','hash-email','hash-cpf','apoiador','fixture','2026-10-01T10:00:00Z')");
  const sigs=(await c.db.query("SELECT * FROM signatures")).rows,oldQueues=(await c.db.query("SELECT * FROM mail_outbox ORDER BY id")).rows,oldMessages=(await c.db.query("SELECT * FROM mail_messages ORDER BY id")).rows,oldAttempts=(await c.db.query("SELECT * FROM mail_message_attempts ORDER BY id")).rows;
  await c.db.query(fence);
  const queues=(await c.db.query("SELECT * FROM mail_outbox ORDER BY id")).rows;assert.equal(queues.find(q=>q.id===accepted.id).status,"sent");
  for(const q of [pending,uncertain,rejected,untried]){const row=queues.find(x=>x.id===q.id);assert.equal(row.status,"failed");assert.equal(row.last_error,"mail_rollback_quarantine");}
  assert.deepEqual(queues.find(q=>q.id===legacy),oldQueues.find(q=>q.id===legacy));
  for(const row of queues){const old=oldQueues.find(q=>q.id===row.id);for(const field of ["id","kind","to_addr","payload","created_at","attempts","next_attempt_at","message_id"])assert.deepEqual(row[field],old[field]);}
  assert.deepEqual((await c.db.query("SELECT * FROM signatures")).rows,sigs);assert.deepEqual((await c.db.query("SELECT * FROM mail_messages ORDER BY id")).rows,oldMessages);assert.deepEqual((await c.db.query("SELECT * FROM mail_message_attempts ORDER BY id")).rows,oldAttempts);
  assert.ok((await c.db.verifyAuditChain()).ok);
  const auditBefore=(await c.db.query("SELECT * FROM audit_log ORDER BY id")).rows;await c.db.query(fence);assert.deepEqual((await c.db.query("SELECT * FROM audit_log ORDER BY id")).rows,auditBefore);
  // Same pending-selection contract as the old worker: only the original unlinked item is eligible.
  await c.db.query("UPDATE mail_outbox SET next_attempt_at=now() WHERE id=$1",[legacy]);const seen:string[]=[];assert.equal((await c.O.drainOutbox(async m=>{seen.push(m.to);})).sent,1);assert.deepEqual(seen,[mail(6).to]);
 }finally{await c.db._closeDbForTests();}});

test("status aceito sem prova de tentativa não é promovido a envio confirmado",async()=>{
 const c=await setup();try{
  const item=await pair(c,1);await c.db.query("UPDATE mail_messages SET status='accepted' WHERE id=$1",[item.messageId]);await c.db.query(fence);
  assert.equal((await c.db.query("SELECT status FROM mail_outbox WHERE id=$1",[item.id])).rows[0].status,"failed");assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("falha de auditoria reverte todo o fence e nenhuma mensagem some",async()=>{
 const c=await setup();try{
  await pair(c,1,"accepted");await pair(c,2,"indeterminate");const before=(await c.db.query("SELECT * FROM mail_outbox ORDER BY id")).rows;
  await c.db.query(`CREATE FUNCTION fail_rollback_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_rollback_guard' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_rollback_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_rollback_audit()`);
  // Use one dedicated client: a failed explicit SQL transaction must be rolled back before reuse.
  await assert.rejects(c.db.tx(async client=>{await client.query(fence.replace(/^BEGIN;/m,"").replace(/^COMMIT;/m,""));}));
  assert.deepEqual((await c.db.query("SELECT * FROM mail_outbox ORDER BY id")).rows,before);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("base anterior sem correlação é aceita sem reescrever a fila",async()=>{
 const c=await setup();try{
  await c.O.enqueueMail(mail(1),"confirmacao","legacy");await c.db.query("ALTER TABLE mail_outbox DROP COLUMN message_id; ALTER TABLE mail_log DROP COLUMN message_id; DROP TABLE mail_message_attempts; DROP TABLE mail_messages");
  const before=(await c.db.query("SELECT * FROM mail_outbox")).rows;await c.db.query(fence);assert.deepEqual((await c.db.query("SELECT * FROM mail_outbox")).rows,before);
 }finally{await c.db._closeDbForTests();}});

test("schema parcial é recusado antes de alterar qualquer fila",async()=>{
 const c=await setup();try{
  await pair(c,1);await c.db.query("DROP TABLE mail_message_attempts");const before=(await c.db.query("SELECT * FROM mail_outbox ORDER BY id")).rows;
  await assert.rejects(c.db.tx(async client=>{await client.query(fence.replace(/^BEGIN;/m,"").replace(/^COMMIT;/m,""));}),/unsupported_mail_rollback_schema/);
  assert.deepEqual((await c.db.query("SELECT * FROM mail_outbox ORDER BY id")).rows,before);
 }finally{await c.db._closeDbForTests();}});
