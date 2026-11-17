import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string,string>).NODE_ENV="test";
async function setup(schema:string){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"54382");assert.equal(url.pathname,"/peticao");assert.equal(process.env.MAIL_PROVIDER,"dev");assert.equal(process.env.MAIL_PROVIDERS,"dev");
 const db=await import("../db"),A=await import("./archive");await db._openForTests(schema);
 const message=await A.prepareMessage({to:"qa-finish@example.test",subject:"QA",text:"Fictitious transaction fixture"},"confirmacao","transactional");
 const attempt=await A.beginAttempt(message.id,"dev","QA <qa@example.test>");assert.ok(attempt.ok);
 const snapshot=async()=>{const result=[];for(const table of["mail_messages","mail_message_attempts","mail_log","audit_log"]){result.push((await db.query(`SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) hash FROM ${table} t`)).rows[0]);}return result;};
 return{db,A,messageId:message.id,attemptId:attempt.id,snapshot};
}
test("legacy completion retains durable receipt, one log/audit and idempotent replay",async()=>{
 const c=await setup("qa_finish_legacy");try{
 assert.deepEqual(await c.A.finishAttempt(c.attemptId,"accepted",{providerId:"QA-RECEIPT"}),{ok:true,existing:false});
 assert.equal((await c.db.query("SELECT status FROM mail_messages WHERE id=$1",[c.messageId])).rows[0].status,"accepted");
 assert.deepEqual((await c.db.query("SELECT state,provider_id FROM mail_message_attempts WHERE id=$1",[c.attemptId])).rows[0],{state:"accepted",provider_id:"QA-RECEIPT"});
 const before=await c.snapshot();assert.deepEqual(await c.A.finishAttempt(c.attemptId,"accepted",{providerId:"QA-RECEIPT"}),{ok:true,existing:true});assert.deepEqual(await c.snapshot(),before);
 assert.deepEqual(await c.A.finishAttempt(c.attemptId,"rejected"),{ok:false,error:"outcome_conflict"});assert.deepEqual(await c.snapshot(),before);assert.equal((await c.db.verifyAuditChain()).ok,true);
 }finally{await c.db._closeDbForTests();}
});
test("outer command failure rolls back completed attempt/message/log before audit append",async()=>{
 const c=await setup("qa_finish_rollback");try{const before=await c.snapshot();
 await assert.rejects(c.db.tx(async client=>{const result=await c.A.finishAttemptInTransaction(client,c.attemptId,"accepted");assert.ok(result.ok);assert.equal((await client.query("SELECT state FROM mail_message_attempts WHERE id=$1",[c.attemptId])).rows[0].state,"accepted");throw Error("QA-LEDGER-FAILED");}),/QA-LEDGER-FAILED/);
 assert.deepEqual(await c.snapshot(),before);assert.equal((await c.db.verifyAuditChain()).ok,true);
 }finally{await c.db._closeDbForTests();}
});
test("deferred audit failure rolls back all receipt writes, successful append is once only",async()=>{
 const c=await setup("qa_finish_audit");try{
 await c.db.query("CREATE FUNCTION qa_fail_finish() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event='mail_message_attempt_finished' THEN RAISE EXCEPTION 'QA_AUDIT_FAILED'; END IF; RETURN NEW; END$$");await c.db.query("CREATE TRIGGER qa_fail_finish_trigger BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_finish()");
 const before=await c.snapshot();await assert.rejects(c.db.tx(async client=>{const result=await c.A.finishAttemptInTransaction(client,c.attemptId,"accepted");await c.A.appendFinishedAttemptAudit(client,result);}),/QA_AUDIT_FAILED/);assert.deepEqual(await c.snapshot(),before);
 await c.db.query("DROP TRIGGER qa_fail_finish_trigger ON audit_log");
 await c.db.tx(async client=>{const result=await c.A.finishAttemptInTransaction(client,c.attemptId,"accepted");await c.A.appendFinishedAttemptAudit(client,result);await assert.rejects(c.A.appendFinishedAttemptAudit(client,result),/already_appended/);});assert.equal((await c.db.verifyAuditChain()).ok,true);
 assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_log WHERE message_id=$1",[c.messageId])).rows[0].n,1);
 }finally{await c.db._closeDbForTests();}
});
test("transaction proof rejects autocommit before writes and rejects same client reused after commit",async()=>{
 const c=await setup("qa_finish_txproof");try{const before=await c.snapshot();let saved:any;
 await c.db.tx(async client=>{await client.query("COMMIT");await assert.rejects(c.A.finishAttemptInTransaction(client,c.attemptId,"accepted"),/active_transaction_required/);await client.query("BEGIN");});assert.deepEqual(await c.snapshot(),before);
 await c.db.tx(async client=>{saved=await c.A.finishAttemptInTransaction(client,c.attemptId,"accepted");await client.query("ROLLBACK");await client.query("BEGIN");await assert.rejects(c.A.appendFinishedAttemptAudit(client,saved),/transaction_changed/);});assert.deepEqual(await c.snapshot(),before);
 await c.db.tx(async client=>{await assert.rejects(c.A.appendFinishedAttemptAudit(client,{ok:true,existing:false}),/client_mismatch/);});
 }finally{await c.db._closeDbForTests();}
});
test("indeterminate is preserved without inventing acceptance or another attempt",async()=>{
 const c=await setup("qa_finish_uncertain");try{await c.db.tx(async client=>{const result=await c.A.finishAttemptInTransaction(client,c.attemptId,"indeterminate",{errorCode:"transport_uncertain"});await c.A.appendFinishedAttemptAudit(client,result);});
 assert.equal((await c.db.query("SELECT status FROM mail_messages WHERE id=$1",[c.messageId])).rows[0].status,"indeterminate");assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_attempts WHERE message_id=$1",[c.messageId])).rows[0].n,1);
 const before=await c.snapshot();assert.deepEqual(await c.A.finishAttempt(c.attemptId,"accepted"),{ok:false,error:"outcome_conflict"});assert.deepEqual(await c.snapshot(),before);
 }finally{await c.db._closeDbForTests();}
});

test("same-transaction savepoint rollback cannot append a false accepted audit",async()=>{
 const c=await setup("qa_finish_savepoint");try{const before=await c.snapshot();
 await c.db.tx(async client=>{await client.query("SAVEPOINT qa_before_finish");const result=await c.A.finishAttemptInTransaction(client,c.attemptId,"accepted");assert.ok(result.ok);await client.query("ROLLBACK TO SAVEPOINT qa_before_finish");await assert.rejects(c.A.appendFinishedAttemptAudit(client,result),/completion_changed/);});
 assert.deepEqual(await c.snapshot(),before);assert.equal((await c.db.verifyAuditChain()).ok,true);
 }finally{await c.db._closeDbForTests();}
});
