import test, { after } from "node:test";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
(process.env as Record<string,string>).NODE_ENV="test";process.env.MAIL_PROVIDER="dev";delete process.env.MAIL_PROVIDERS;delete process.env.MAIL_ARCHIVE_RETENTION;
const deliveryDirectory=mkdtempSync(join(tmpdir(),"peticao-recorded-mail-"));
process.env.MAIL_OUTBOX_DIR=deliveryDirectory;
after(()=>rmSync(deliveryDirectory,{recursive:true,force:true}));
const m=()=>({to:"recorded@example.test",subject:"QA Message",text:"QA body"});
async function setup(){const db=await import("./db");await db._openForTests("t_mail_recorded_delivery");return {db,M:await import("./mail"),A:await import("./mail/archive"),R:await import("./mail/recorded")};}
const scope=async(fn:()=>Promise<void>)=>{
 const keys=["MAIL_PROVIDER","MAIL_PROVIDERS","MAIL_ARCHIVE_RETENTION","BREVO_API_KEY","MAIL_REPLY_TO","PREVIEW_MODE","MAIL_PROVIDERS_MARKETING"],saved=new Map(keys.map(k=>[k,process.env[k]])),fetch=globalThis.fetch;
 try{await fn();}finally{globalThis.fetch=fetch;for(const [k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
};
async function close(c:Awaited<ReturnType<typeof setup>>){await c.M.waitForBackgroundMail();await c.db._closeDbForTests();}

test("envio dev registra uma vez e não escolhe política de conteúdo",()=>scope(async()=>{
 const c=await setup();try{
  assert.equal(await c.M.sendMail(m(),"confirmacao",{messageKey:"dev-one"}),"sent");await c.M.waitForBackgroundMail();
  const messages=(await c.db.query("SELECT * FROM mail_messages")).rows;assert.equal(messages.length,1);assert.equal(messages[0].status,"accepted");assert.equal(messages[0].content_state,"unavailable");
  assert.equal(await c.M.sendMail(m(),"confirmacao",{messageKey:"dev-one"}),"sent");await c.M.waitForBackgroundMail();
  assert.equal((await c.db.query("SELECT 1 FROM mail_message_attempts")).rowCount,1);assert.equal((await c.db.query("SELECT 1 FROM mail_log WHERE message_id=$1",[messages[0].id])).rowCount,1);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await close(c);}
}));

test("guardas recusam antes de criar mensagem ou chamar transporte, inclusive marketing no preview",()=>scope(async()=>{
 const c=await setup();try{
  await assert.rejects(c.M.sendMail({...m(),to:"qa@ministerio.gov.br"},"teste"));await assert.rejects(c.M.sendMail({...m(),bcc:["qa@ministerio.gov.br"]},"teste"));
  process.env.MAIL_PROVIDER="brevo";process.env.BREVO_API_KEY="fixture-only";let calls=0;globalThis.fetch=(async()=>{calls++;return new Response("{}",{status:201});}) as typeof fetch;
  await c.db.query("INSERT INTO email_suppressions(email,reason) VALUES($1,'bounce')",[m().to]);await assert.rejects(c.M.sendMail(m(),"confirmacao"));
  process.env.PREVIEW_MODE="1";process.env.MAIL_PROVIDERS_MARKETING="brevo";await assert.rejects(c.M.sendMail({...m(),to:"other@example.test"},"teste",{channel:"marketing"}),/PREVIEW_MODE/);
  assert.equal(calls,0);assert.equal((await c.db.query("SELECT 1 FROM mail_messages")).rowCount,0);
 }finally{await close(c);}
}));

test("falha de registro ou callback após aceite não dispara outro provedor",()=>scope(async()=>{
 const c=await setup();let sends=0;try{
  const record=await c.A.prepareMessage(m(),"teste","transactional");
  await c.db.query(`CREATE FUNCTION fail_record_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_message_attempt_finished' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_record_finish BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_record_finish()`);
  assert.equal(await c.M.deliver(m(),["first","second"],{first:async()=>{sends++;},second:async()=>{sends++;}},()=>"QA <qa@example.test>","teste",()=>{throw new Error("fixture callback");},{journal:c.R.journalFor(record.id,true)}),"first");
  assert.equal(sends,1);assert.equal((await c.db.query("SELECT state FROM mail_message_attempts")).rows[0].state,"prepared");
  await assert.rejects(c.M.deliver(m(),["first"],{first:async()=>{sends++;}},()=>"QA <qa@example.test>","teste",undefined,{journal:c.R.journalFor(record.id,true)}));assert.equal(sends,1);
 }finally{await close(c);}
}));

test("fallback mantém identidade; singleAttempt não passa a outro provedor",()=>scope(async()=>{
 const c=await setup();try{
  const record=await c.A.prepareMessage(m(),"teste","transactional");let calls=0;
  assert.equal(await c.M.deliver(m(),["first","second"],{first:async()=>{calls++;throw new Error("fixture failure");},second:async()=>{calls++;}},()=>"QA <qa@example.test>","teste",undefined,{journal:c.R.journalFor(record.id,true)}),"second");assert.equal(calls,2);
  const rows=(await c.db.query("SELECT state,message_id FROM mail_message_attempts ORDER BY started_at")).rows;assert.deepEqual(rows.map(r=>r.state),["indeterminate","accepted"]);assert.ok(rows.every(r=>r.message_id===record.id));
  const single=await c.A.prepareMessage(m(),"teste","transactional");calls=0;
  await assert.rejects(c.M.deliver(m(),["first","second"],{first:async()=>{calls++;throw undefined;},second:async()=>{calls++;}},()=>"QA <qa@example.test>","teste",undefined,{singleAttempt:true,journal:c.R.journalFor(single.id,false)}));assert.equal(calls,1);assert.equal((await c.A.messageMetadata(single.id))?.status,"indeterminate");
 }finally{await close(c);}
}));

test("fila preserva identidade e Reply-To; aceite conhecido recupera fila sem reenviar",()=>scope(async()=>{
 const c=await setup();try{
  process.env.MAIL_PROVIDER="brevo";process.env.BREVO_API_KEY="fixture-only";process.env.MAIL_REPLY_TO="original@example.test";
  globalThis.fetch=(async()=>new Response('{"message":"fixture unavailable"}',{status:503})) as typeof fetch;
  assert.equal(await c.M.sendMail(m(),"confirmacao"),"queued");const queued=(await c.db.query("SELECT * FROM mail_outbox")).rows[0];assert.ok(queued.message_id);
  process.env.MAIL_REPLY_TO="changed@example.test";await c.db.query("UPDATE mail_outbox SET next_attempt_at=now()");assert.equal((await c.M.drainMailOutbox()).sent,0);
  process.env.MAIL_PROVIDER="dev";await c.db.query("UPDATE mail_outbox SET next_attempt_at=now()");assert.equal((await c.M.drainMailOutbox()).sent,1);
  const message=(await c.A.messageMetadata(queued.message_id))!;assert.equal(message.status,"accepted");assert.equal(message.reply_to,"original@example.test");
  const count=async()=>Number((await c.db.query("SELECT count(*) n FROM mail_message_attempts WHERE message_id=$1",[message.id])).rows[0].n),before=await count();
  await c.db.query("UPDATE mail_outbox SET status='pending',next_attempt_at=now()");assert.equal((await c.M.drainMailOutbox()).sent,1);assert.equal(await count(),before);
  assert.equal((await c.db.query("SELECT 1 FROM mail_messages")).rowCount,1);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await close(c);}
}));

test("fila antiga ganha identidade sem reescrever payload e data originais",()=>scope(async()=>{
 const c=await setup();try{
  const O=await import("./mail/outbox");process.env.MAIL_REPLY_TO="legacy-observed@example.test";
  const id=await O.enqueueMail(m(),"confirmacao","fixture");await c.db.query("UPDATE mail_outbox SET next_attempt_at=now(),created_at=now()-interval '1 hour' WHERE id=$1",[id]);const before=(await c.db.query("SELECT * FROM mail_outbox WHERE id=$1",[id])).rows[0];
  assert.equal((await c.M.drainMailOutbox()).sent,1);const after=(await c.db.query("SELECT * FROM mail_outbox WHERE id=$1",[id])).rows[0];assert.deepEqual(after.payload,before.payload);assert.deepEqual(after.created_at,before.created_at);assert.ok(after.message_id);assert.equal((await c.A.messageMetadata(after.message_id))?.reply_to,"legacy-observed@example.test");
  assert.equal((await c.db.query("SELECT 1 FROM mail_messages")).rowCount,1);
 }finally{await close(c);}
}));

test("política explícita arquiva o envelope efetivo sem alterar a mensagem",()=>scope(async()=>{
 const c=await setup();try{
  process.env.MAIL_ARCHIVE_RETENTION="30";process.env.MAIL_REPLY_TO="qa-owner@example.test";
  assert.equal(await c.M.sendMail(m(),"confirmacao"),"sent");await c.M.waitForBackgroundMail();const record=(await c.db.query("SELECT id FROM mail_messages")).rows[0];
  const content=await c.A.archivedContent(record.id);assert.ok(content.state==="stored");assert.deepEqual(content.mail,{...m(),bcc:undefined,html:undefined,attachments:undefined,replyTo:"qa-owner@example.test"});
 }finally{await close(c);}
}));

test("transporte mantém o disjuntor transacional original separado do marketing",()=>scope(async()=>{
 const c=await setup(),rotation=await import("./mail/rodizio");rotation._resetRodizio();
 try{
  process.env.MAIL_PROVIDER="brevo";process.env.BREVO_API_KEY="fixture-only";globalThis.fetch=(async()=>new Response("{}",{status:503})) as typeof fetch;
  for(let i=0;i<3;i++)await assert.rejects(c.M.sendMail(m(),"teste",{queue:false}));
  assert.equal(rotation.aberto("transacional","brevo"),true);assert.equal(rotation.aberto("marketing","brevo"),false);
 }finally{rotation._resetRodizio();await close(c);}
}));
