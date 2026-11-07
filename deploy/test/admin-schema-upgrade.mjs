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
const newSource=readFileSync(resolve(here,"../../site/src/lib/db.ts"),"utf8");
const match=/const SCHEMA_SQL = (`[\s\S]*?`);/.exec(newSource);assert.ok(match);assert.ok(!match[1].includes("${"));
const newSql=Function("return "+match[1])();
const schemaName="admin_upgrade_rehearsal_"+process.pid;
let db;
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const c=await pool.connect();
try{
 await c.query(`CREATE SCHEMA ${schemaName}`);await c.query(`SET search_path=${schemaName}`);
 await c.query(oldSql);
 await c.query(`INSERT INTO signatures(id,name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at,seq,verify_code) VALUES
 (201,'Pessoa Confirmada','confirmed@example.test','hash-email-1','hash-cpf-1','apoiador','fixture','2026-10-01T10:00:00Z','confirmed','2026-10-01T10:00:00Z','2026-10-01T10:10:00Z',42,'ABCDEF123456'),
 (202,'Pessoa Pendente','pending@example.test','hash-email-2','hash-cpf-2','apoiador','fixture','2026-10-02T10:00:00Z','pending','2026-10-02T10:00:00Z',null,null,null)`);
 await c.query("INSERT INTO settings(key,value) VALUES('rehearsal','preserve')");
 const rows=async()=> (await c.query("SELECT * FROM signatures ORDER BY id")).rows;
 const tables=async()=> (await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>r.table_name);
 const columns=async()=> (await c.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position")).rows;
 const before=await rows(),existing=await tables(),definition=await columns();
 process.env.DATABASE_SCHEMA=schemaName;
 const module=await import("../../site/src/lib/db.ts");db=module.default || module;
 await db.query("SELECT 1"); // Real initialization includes schema, seeds and backfills.
 await c.query(newSql); // Reapplying the DDL must also be safe.
 assert.deepEqual(await rows(),before,"All original signer fields must survive byte for byte");
 assert.deepEqual((await columns()).filter(row=>existing.includes(row.table_name)),definition,"Existing table definitions must not change");
 assert.deepEqual((await tables()).filter(name=>!existing.includes(name)),["admin_acoes","admin_reset","admin_sessions","admin_stepup","admin_users","contact_replies"]);
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
 console.log("PASS legacy action history migration: original rows unchanged, no old record admitted as a new request.");
 console.log("PASS legacy contact history migration: original IDs, results, authors and timestamps preserved; no historical message eligible for dispatch.");
 console.log("PASS real startup on old schema plus DDL replay: six additive tables; original definitions, signer records and settings preserved; old schema bootstrap remains compatible.");
}finally{
 if(db)await db._closeDbForTests();
 await c.query("RESET search_path");await c.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);c.release();await pool.end();delete process.env.DATABASE_SCHEMA;
}
