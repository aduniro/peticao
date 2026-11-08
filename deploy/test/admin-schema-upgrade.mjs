// Isolated old-schema -> new-schema rehearsal. Never accepts a remote database.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here=dirname(fileURLToPath(import.meta.url));
const require=createRequire(resolve(here,"../../site/package.json"));
const {Pool}=require("pg");
const url=new URL(process.env.DATABASE_URL || "postgres://invalid");
assert.ok(["localhost","127.0.0.1"].includes(url.hostname) && url.port===process.env.DEV_DB_PORT && url.pathname==="/peticao","Run only through the isolated development database wrapper");
const oldSql=readFileSync(resolve(here,"fixtures/production-db-20261106.sql"),"utf8");
const provenance=JSON.parse(readFileSync(resolve(here,"fixtures/production-db-20261106.json"),"utf8"));
assert.equal(createHash("sha256").update(oldSql).digest("hex"),provenance.schema_sha256);
const diagnosticSql=readFileSync(resolve(here,"fixtures/production-diagnostics-20261107.sql"),"utf8");
const diagnosticProvenance=JSON.parse(readFileSync(resolve(here,"fixtures/production-diagnostics-20261107.json"),"utf8"));
assert.equal(createHash("sha256").update(diagnosticSql).digest("hex"),diagnosticProvenance.schema_sha256);
const newSource=readFileSync(resolve(here,"../../site/src/lib/db.ts"),"utf8");
const match=/const SCHEMA_SQL = (`[\s\S]*?`);/.exec(newSource);assert.ok(match);assert.ok(!match[1].includes("${"));
const newSql=Function("return "+match[1])();
const schemaName="admin_upgrade_rehearsal_"+process.pid;
let db;
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const c=await pool.connect();
try{
 await c.query(`CREATE SCHEMA ${schemaName}`);await c.query(`SET search_path=${schemaName}`);
 await c.query(oldSql);
 await c.query(diagnosticSql);
 await c.query(`INSERT INTO signup_diagnostics(id,trace_id,ts,expires_at,source,classification,learning_index,policy_version,metadata,email_cipher,email_hash)
   VALUES('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','2026-11-07T10:00:00.123456Z','2026-12-07T10:00:00.123456Z','server','validation_failed','QA-LEARNING','QA-POLICY','{"fixture":true}','QA-NOT-A-REAL-CIPHER','QA-NOT-A-REAL-HASH')`);
 const diagnosticsSnapshot=async()=>(await c.query("SELECT row_to_json(d)::text raw FROM signup_diagnostics d ORDER BY id")).rows;
 const originalDiagnostics=await diagnosticsSnapshot();
 await c.query(`INSERT INTO signatures(id,name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at,seq,verify_code) VALUES
 (201,'Pessoa Confirmada','confirmed@example.test','hash-email-1','hash-cpf-1','apoiador','fixture','2026-10-01T10:00:00Z','confirmed','2026-10-01T10:00:00Z','2026-10-01T10:10:00Z',42,'ABCDEF123456'),
 (202,'Pessoa Pendente','pending@example.test','hash-email-2','hash-cpf-2','apoiador','fixture','2026-10-02T10:00:00Z','pending','2026-10-02T10:00:00Z',null,null,null)`);
 await c.query("INSERT INTO settings(key,value) VALUES('rehearsal','preserve')");
 await c.query("INSERT INTO whatsapp_senders(label,phone_cipher,phone_last4,active,created_at) VALUES('QA legacy sender','QA-NOT-A-REAL-CIPHER','0000',false,'2026-10-01T10:00:00.123456Z')");
 const oldSenders=(await c.query("SELECT row_to_json(s)::text raw FROM whatsapp_senders s ORDER BY id")).rows.map(r=>JSON.parse(r.raw));
 await c.query("INSERT INTO mail_log(kind,provider,to_addr,status,ts) VALUES('confirmacao','legacy','legacy@example.test','sent','2026-10-01T10:00:00Z')");
 await c.query("INSERT INTO mail_outbox(kind,to_addr,payload) VALUES('confirmacao','legacy@example.test','{\"to\":\"legacy@example.test\",\"subject\":\"legacy\",\"text\":\"do-not-send-legacy-fixture\"}')");
 const oldMailLog=(await c.query("SELECT * FROM mail_log ORDER BY id")).rows,oldMailOutbox=(await c.query("SELECT * FROM mail_outbox ORDER BY id")).rows;
 const rows=async()=> (await c.query("SELECT * FROM signatures ORDER BY id")).rows;
 const tables=async()=> (await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>r.table_name);
 const columns=async()=> (await c.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position")).rows;
 const before=await rows(),existing=await tables(),definition=await columns();
 process.env.DATABASE_SCHEMA=schemaName;
 const module=await import("../../site/src/lib/db.ts");db=module.default || module;
 await db.query("SELECT 1"); // Real initialization includes schema, seeds and backfills.
 await c.query(newSql); // Reapplying the DDL must also be safe.
 assert.deepEqual(await rows(),before,"All original signer fields must survive byte for byte");
 const afterColumns=await columns(),originalKeys=new Set(definition.map(row=>`${row.table_name}.${row.column_name}`));
 assert.deepEqual(afterColumns.filter(row=>originalKeys.has(`${row.table_name}.${row.column_name}`)),definition,"Original column definitions must not change");
 assert.deepEqual(afterColumns.filter(row=>existing.includes(row.table_name)&&!originalKeys.has(`${row.table_name}.${row.column_name}`)),[
  {table_name:"mail_log",column_name:"message_id",data_type:"uuid",is_nullable:"YES",column_default:null},
  {table_name:"mail_outbox",column_name:"message_id",data_type:"uuid",is_nullable:"YES",column_default:null},
  {table_name:"whatsapp_senders",column_name:"revision",data_type:"integer",is_nullable:"NO",column_default:"1"},
  {table_name:"whatsapp_senders",column_name:"archived_at",data_type:"timestamp with time zone",is_nullable:"YES",column_default:null}
 ],"Only the explicit message correlation and sender revision/archive columns may be added to old tables");
 const upgradedSenders=(await c.query("SELECT row_to_json(s)::text raw FROM whatsapp_senders s ORDER BY id")).rows.map(r=>JSON.parse(r.raw));
 assert.deepEqual(upgradedSenders.map(({revision,archived_at,...row})=>row),oldSenders,"Sender identity, ciphertext, status and microsecond timestamps survive upgrade");
 assert.ok(upgradedSenders.every(row=>row.revision===1&&row.archived_at===null));
 await c.query("UPDATE whatsapp_senders SET revision=2,archived_at='2026-11-08T08:00:00.654321Z'");
 const archivedSenders=(await c.query("SELECT row_to_json(s)::text raw FROM whatsapp_senders s ORDER BY id")).rows;
 await c.query(newSql);await c.query(newSql);await c.query(oldSql);
 assert.deepEqual((await c.query("SELECT row_to_json(s)::text raw FROM whatsapp_senders s ORDER BY id")).rows,archivedSenders,"DDL replay and old bootstrap must not reset archive decisions or revisions");
 assert.deepEqual((await tables()).filter(name=>!existing.includes(name)),["admin_acoes","admin_ai_requests","admin_referral_requests","admin_reset","admin_sessions","admin_stepup","admin_users","contact_campus_reviews","contact_replies","contact_triage_jobs","mail_message_attempts","mail_message_events","mail_messages"]);
 const newMailLog=(await c.query("SELECT * FROM mail_log ORDER BY id")).rows,newMailOutbox=(await c.query("SELECT * FROM mail_outbox ORDER BY id")).rows;
 assert.ok([...newMailLog,...newMailOutbox].every(row=>row.message_id===null));
 assert.deepEqual(newMailLog.map(({message_id,...row})=>row),oldMailLog);assert.deepEqual(newMailOutbox.map(({message_id,...row})=>row),oldMailOutbox);
 assert.equal((await c.query("SELECT count(*)::int n FROM mail_messages")).rows[0].n,0,"Do not fabricate old message identities or contents");
 assert.equal((await c.query("SELECT value FROM settings WHERE key='rehearsal'")).rows[0].value,"preserve");
 await c.query(oldSql);assert.deepEqual(await rows(),before,"Previous schema bootstrap remains compatible with the extended database");
 // Older admin installations already have contact history; migrate it without dispatching it.
 const legacyContact=/CREATE TABLE IF NOT EXISTS contact_replies \([\s\S]*?\n  \);/.exec(newSql);
 assert.ok(legacyContact);
 await c.query("DROP TABLE contact_replies");
 await c.query(legacyContact[0]);
 const contact=(await c.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('Pessoa Fictícia','contact@example.test','duvida','Ensaio de atualização') RETURNING id")).rows[0].id;
 await c.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto,ok,criada_em) VALUES($1,1,'texto','legacy@example.test','Histórico preservado',true,'2026-10-01T10:00:00Z'),($1,1,'card','legacy@example.test','Card antigo',false,'2026-10-01T10:01:00Z')",[contact]);
 const originalHistory=(await c.query("SELECT * FROM contact_replies ORDER BY id")).rows;
 await c.query(newSql);
 await c.query(newSql);
 const migratedHistory=(await c.query("SELECT * FROM contact_replies ORDER BY id")).rows;
 assert.deepEqual(migratedHistory.map(row=>Object.fromEntries(Object.keys(originalHistory[0]).map(key=>[key,row[key]]))),originalHistory);
 assert.ok(migratedHistory.every(row=>row.estado==="legacy" && row.payload===null && row.due_at===null && row.attempts===0));
 assert.deepEqual(await rows(),before,"Contact history migration must also preserve every signer field");
 const legacyAction=/CREATE TABLE IF NOT EXISTS admin_acoes \([\s\S]*?\n  \);/.exec(newSql);
 assert.ok(legacyAction);
 await c.query("DROP TABLE admin_acoes");await c.query(legacyAction[0]);
 await c.query("INSERT INTO admin_acoes(email,acao,modo,parametros,resultado,ok) VALUES('legacy@example.test','reenvio.parar','executar','{}','{\"ligado\":false}',true)");
 const oldActions=(await c.query("SELECT * FROM admin_acoes ORDER BY id")).rows;
 await c.query(newSql);await c.query(newSql);
 const upgradedActions=(await c.query("SELECT * FROM admin_acoes ORDER BY id")).rows;
 assert.deepEqual(upgradedActions.map(row=>Object.fromEntries(Object.keys(oldActions[0]).map(key=>[key,row[key]]))),oldActions);
 assert.ok(upgradedActions.every(row=>row.central_estado==="legacy" && row.central_transacional===false && row.central_fim===null && row.central_request_id===null && row.central_simulacao_hash===null && row.central_simulacao_id===null));
 // A previously installed archive foundation has messages but no observed Reply-To column yet.
 await c.query("ALTER TABLE mail_messages DROP COLUMN reply_to");
 await c.query("INSERT INTO mail_messages(id,kind,channel,to_addr,content_fingerprint,content_state,created_at) VALUES('00000000-0000-4000-8000-000000000001','confirmacao','transactional','foundation@example.test','fixture-fingerprint','unavailable','2026-10-01T10:00:00Z')");
 const priorFoundation=(await c.query("SELECT * FROM mail_messages")).rows;
 await c.query(newSql);await c.query(newSql);
 const upgradedFoundation=(await c.query("SELECT * FROM mail_messages")).rows;
 assert.ok(upgradedFoundation.every(row=>row.reply_to===null));
 assert.deepEqual(upgradedFoundation.map(({reply_to,...row})=>row),priorFoundation);
 // An already installed journal predates account scoping and individual event correlation.
 await c.query("DROP TABLE mail_message_events; ALTER TABLE mail_message_attempts DROP COLUMN account_scope");
 await c.query(`INSERT INTO mail_message_attempts(id,message_id,provider,from_addr,state,started_at,finished_at,provider_id)
   VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','brevo','qa@example.test','accepted',
     '2026-10-01T10:00:01.123456Z','2026-10-01T10:00:02.654321Z','QA-LEGACY-RECEIPT')`);
 const priorAttempts=(await c.query("SELECT row_to_json(a)::text raw FROM mail_message_attempts a ORDER BY id")).rows;
 await c.query(newSql);await c.query(newSql);
 assert.ok((await c.query("SELECT account_scope FROM mail_message_attempts")).rows.every(row=>row.account_scope===null),"Do not invent the account for a historical receipt");
 assert.deepEqual((await c.query("SELECT (to_jsonb(a)-'account_scope')::text raw FROM mail_message_attempts a ORDER BY id")).rows.map(r=>JSON.parse(r.raw)),priorAttempts.map(r=>JSON.parse(r.raw)),"Preserve receipt identity, state and microsecond timestamps");
 assert.equal((await c.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0,"Do not fabricate historical delivery events");
 await c.query("UPDATE mail_message_attempts SET account_scope=$1",["b".repeat(64)]);
 await c.query(`INSERT INTO mail_message_events(fingerprint,provider,account_scope,provider_id,recipient,event_type,occurred_at,received_at,source,association_state,message_id,attempt_id)
   VALUES('QA-EVENT','brevo',$1,'QA-LEGACY-RECEIPT','foundation@example.test','delivered','2026-10-01T10:00:03.123456Z','2026-10-01T10:00:04.654321Z','webhook','linked',
     '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')`,["b".repeat(64)]);
 const journalSnapshot=async()=>(await c.query("SELECT 'message' kind,row_to_json(m)::text raw FROM mail_messages m UNION ALL SELECT 'attempt',row_to_json(a)::text FROM mail_message_attempts a UNION ALL SELECT 'event',row_to_json(e)::text FROM mail_message_events e ORDER BY kind,raw")).rows;
 const priorJournal=await journalSnapshot();await c.query(newSql);await c.query(newSql);await c.query(oldSql);
 assert.deepEqual(await journalSnapshot(),priorJournal,"DDL replay and previous bootstrap must preserve linked events and receipt identity byte for byte");
 assert.deepEqual(await rows(),before,"Message-event upgrade must preserve all signer fields");
 assert.ok((await c.query("SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('mail_message_receipt','mail_message_event_identity','mail_message_event_history')")).rowCount===3,"Correlation indexes must survive the foundation upgrade");
 // Curated reference decisions are additive and remain recoverable across a code rollback.
 const reviewer=(await c.query("INSERT INTO admin_users(email,nome,nivel,senha_hash) VALUES('qa-curator@example.test','QA Curator','total','QA-NOT-A-LOGIN-HASH') RETURNING id")).rows[0].id;
 const referral=(await c.query("INSERT INTO referrers(code,label,manage_token_hash) VALUES('QATEST7','QA Intent','QA-NOT-A-REAL-TOKEN-HASH') RETURNING id")).rows[0].id;
 await c.query("INSERT INTO admin_referral_requests(actor_id,request_id,input_hash,referrer_id,created_at) VALUES($1,'00000000-0000-4000-8000-000000000020',$2,$3,'2026-11-08T08:00:00.123456Z')",[reviewer,'e'.repeat(64),referral]);
 const referralRequests=async()=>(await c.query("SELECT row_to_json(q)::text raw FROM admin_referral_requests q ORDER BY actor_id,request_id")).rows;
 const priorReferralRequests=await referralRequests();await c.query(newSql);await c.query(newSql);await c.query(oldSql);
 assert.deepEqual(await referralRequests(),priorReferralRequests,"Referral intent, owner, fingerprint, allocation and microsecond timestamp survive replay and old bootstrap");
 const reviewJob=(await c.query("INSERT INTO contact_triage_jobs(contact_id,revision,engine,status,analysis) VALUES($1,1,'contact-triage-v1','complete','{\"category\":\"campus\"}') RETURNING id",[contact])).rows[0].id;
 const review=(await c.query(`INSERT INTO contact_campus_reviews(contact_id,triage_job_id,revision,proposal,decision,source_reviewed,created_by,intent_hash,created_at)
   VALUES($1,$2,1,'{"institution":"UNIR","campusName":"QA Campus"}','approved',true,$3,'QA-CURATION-1','2026-10-01T10:00:05.123456Z') RETURNING id`,[contact,reviewJob,reviewer])).rows[0].id;
 await c.query(`INSERT INTO contact_campus_reviews(contact_id,triage_job_id,revision,previous_id,proposal,decision,source_reviewed,created_by,intent_hash,created_at)
   VALUES($1,$2,2,$3,'{"institution":"UNIR","campusName":"QA Campus"}','rejected',false,$4,'QA-CURATION-2','2026-10-01T10:00:06.654321Z')`,[contact,reviewJob,review,reviewer]);
 const curated=async()=>(await c.query("SELECT row_to_json(r)::text raw FROM contact_campus_reviews r ORDER BY id")).rows;
 const priorCurated=await curated();await c.query(newSql);await c.query(newSql);await c.query(oldSql);
 assert.deepEqual(await curated(),priorCurated,"Curated reference versions, authors, previous links and timestamps survive replay and old bootstrap");
 assert.deepEqual(await rows(),before);assert.deepEqual(await journalSnapshot(),priorJournal);
 // A rollback/bootstrap must never forget that an AI request may already have reached its provider.
 await c.query(`INSERT INTO admin_ai_requests(id,request_id,created_by,day,purpose,configuration_revision,provider,model,context_hash,source_versions,input_bytes,reserved_output_tokens,state,created_at,finished_at,error_code)
   VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',$1,'2026-10-01','painel',1,'openai','qa-model-not-real','QA-CONTEXT-HASH','[]',512,1024,'uncertain',
     '2026-10-01T10:00:07.123456Z','2026-10-01T10:00:08.654321Z','transport_uncertain')`,[reviewer]);
 const generations=async()=>(await c.query("SELECT row_to_json(r)::text raw FROM admin_ai_requests r ORDER BY id")).rows;
 const priorGenerations=await generations();await c.query(newSql);await c.query(newSql);await c.query(oldSql);
 assert.deepEqual(await generations(),priorGenerations,"AI request identity, ownership, budget and uncertainty survive replay and old bootstrap");
 assert.deepEqual(await rows(),before);assert.deepEqual(await journalSnapshot(),priorJournal);assert.deepEqual(await curated(),priorCurated);
 await c.query(diagnosticSql);
 assert.deepEqual(await diagnosticsSnapshot(),originalDiagnostics,"Published diagnostic identity, encrypted payload, metadata, expiry and microsecond timestamps survive upgrade/replay/old bootstrap");
 assert.equal((await c.query("SELECT count(*)::int n FROM pg_indexes WHERE schemaname=current_schema() AND tablename='signup_diagnostics'")).rows[0].n,5);
 console.log("PASS currently published diagnostics survive additive admin upgrade and code rollback bootstrap; no contact decryption or signer writes.");
 console.log("PASS AI ledger upgrade: thirteen additive tables; request UUID, actor, quota reservation, uncertain state and microsecond timestamps preserved, no generation dispatched.");
 console.log("PASS campus curation upgrade: thirteen additive tables; review versions, actors, prior links and microsecond timestamps preserved; no signer or mail writes.");
 console.log("PASS scoped journal upgrade: unknown account stays null, no fabricated events; existing receipt and linked event identity/timestamps preserved on replay.");
 console.log("PASS archive foundation upgrade: existing message identity, fingerprint, state and timestamp preserved; Reply-To left unknown.");
 console.log("PASS legacy action history migration: original rows unchanged, no old record admitted as a new request.");
 console.log("PASS legacy contact history migration: original IDs, results, authors and timestamps preserved; no historical message eligible for dispatch.");
 console.log("PASS sender catalogue upgrade: ciphertext, identity, paused state, archive revision and microsecond timestamps survive replay and old bootstrap.");
 console.log("PASS referral intent upgrade: request ownership, allocation, fingerprint and microsecond timestamp preserved.");
 console.log("PASS real startup on old schema plus DDL replay: thirteen additive tables, two nullable message correlation columns and two sender revision/archive columns; original definitions, signer records and settings preserved; old schema bootstrap remains compatible.");
}finally{
 if(db)await db._closeDbForTests();
 await c.query("RESET search_path");await c.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);c.release();await pool.end();delete process.env.DATABASE_SCHEMA;
}
