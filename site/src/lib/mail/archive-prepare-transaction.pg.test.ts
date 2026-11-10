import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string,string>).NODE_ENV="test";
async function setup(schema:string){
 const u=new URL(process.env.DATABASE_URL!);assert.equal(u.hostname,"127.0.0.1");assert.equal(u.port,"54382");assert.equal(process.env.MAIL_PROVIDER,"dev");assert.equal(process.env.MAIL_PROVIDERS,"dev");
 const db=await import("../db"),A=await import("./archive");await db._openForTests(schema);
 const mail={to:"qa-prepare@example.test",subject:"QA private subject",text:"QA private content"};
 const snapshot=async()=>{const a=[];for(const table of["mail_messages","mail_log","audit_log"]){a.push((await db.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows);}return a;};return{db,A,mail,snapshot};
}
test("prepare and finish compose with one outer ledger transaction and audit chain",async()=>{
 const c=await setup("qa_prepare_finish");try{
 let messageId="";await c.db.tx(async client=>{const prepared=await c.A.prepareMessageInTransaction(client,c.mail,"confirmacao","transactional",{requestKey:"QA-COMPOSE-ONLY"});messageId=prepared.id;await c.A.appendPreparedMessageAudit(client,prepared);});
 const attempt=await c.A.beginAttempt(messageId,"dev","QA <qa@example.test>");assert.ok(attempt.ok);
 await c.db.tx(async client=>{const result=await c.A.finishAttemptInTransaction(client,attempt.id,"accepted");await c.A.appendFinishedAttemptAudit(client,result);});
 assert.equal((await c.db.query("SELECT status FROM mail_messages WHERE id=$1",[messageId])).rows[0].status,"accepted");assert.equal((await c.db.verifyAuditChain()).ok,true);
 const before=await c.snapshot();await c.db.tx(async client=>{const same=await c.A.prepareMessageInTransaction(client,c.mail,"confirmacao","transactional",{requestKey:"QA-COMPOSE-ONLY"});assert.equal(same.id,messageId);assert.equal(same.existing,true);await c.A.appendPreparedMessageAudit(client,same);});assert.deepEqual(await c.snapshot(),before);
 }finally{await c.db._closeDbForTests();}
});
test("outer failure and savepoint rollback cannot produce a phantom prepared audit",async()=>{
 const c=await setup("qa_prepare_rollback");try{const before=await c.snapshot();
 await assert.rejects(c.db.tx(async client=>{await c.A.prepareMessageInTransaction(client,c.mail,"confirmacao","transactional");throw Error("QA-OUTER-FAILED");}),/QA-OUTER-FAILED/);assert.deepEqual(await c.snapshot(),before);
 await c.db.tx(async client=>{await client.query("SAVEPOINT qa_before_prepare");const prepared=await c.A.prepareMessageInTransaction(client,c.mail,"confirmacao","transactional");await client.query("ROLLBACK TO SAVEPOINT qa_before_prepare");await assert.rejects(c.A.appendPreparedMessageAudit(client,prepared));});assert.deepEqual(await c.snapshot(),before);
 }finally{await c.db._closeDbForTests();}
});
test("prepare audit failure rolls back encrypted archive and permits no unsupported acceptance",async()=>{
 const c=await setup("qa_prepare_audit");try{await c.db.query("CREATE FUNCTION qa_fail_prepare() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event='mail_message_prepared' THEN RAISE EXCEPTION 'QA_PREPARE_AUDIT_FAILED'; END IF; RETURN NEW; END$$");await c.db.query("CREATE TRIGGER qa_fail_prepare_trigger BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_prepare()");const before=await c.snapshot();
 await assert.rejects(c.db.tx(async client=>{const prepared=await c.A.prepareMessageInTransaction(client,c.mail,"confirmacao","transactional",{archive:{until:new Date(Date.now()+3600000)}});await c.A.appendPreparedMessageAudit(client,prepared);}),/QA_PREPARE_AUDIT_FAILED/);assert.deepEqual(await c.snapshot(),before);assert.equal((await c.db.verifyAuditChain()).ok,true);
 }finally{await c.db._closeDbForTests();}
});
