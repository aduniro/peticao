import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import * as db from './db';
import { verifyRuntimeSchema } from './db-schema-readiness';
const run=promisify(execFile);
test('NCPF offline upgrade is additive/idempotent and runtime can use it without DDL/history-delete authority',async()=>{
 const schema=`t_ncpf_upgrade_${process.pid}`,role=`qa_ncpf_runtime_${process.pid}`,password=randomUUID();
 const base=new URL(process.env.DATABASE_URL!);assert(['localhost','127.0.0.1'].includes(base.hostname));assert.notEqual(base.port,'5432');
 await db._openForTests(schema);
 let runtime:Pool|undefined;
 try{
  await db.query('DROP TABLE confirmation_receipts,signup_receipts,signature_name_history,ncpf_candidates,ncpf_intents,ncpf_jobs,ncpf_evidence CASCADE');
  await db.query('ALTER TABLE signatures DROP COLUMN declared_name,DROP COLUMN name_source,DROP COLUMN name_evidence_id,DROP COLUMN api_name_snapshot');
  await db.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  await db.query(`CREATE TABLE application_runtime_roles(runtime_role text PRIMARY KEY,role_name text);INSERT INTO application_runtime_roles VALUES('v2','${role}'),('legacy','peticao'),('outbox','peticao')`);
  await db.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role};GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  const execute=async()=>{
   const r=await run(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/prepare-ncpf.ts','--apply'],{cwd:process.cwd(),env:{...process.env,DATABASE_SCHEMA:schema}});
   return JSON.parse(r.stdout.trim()) as {schemaSha256:string;applied:boolean};
  };
  const first=await execute();assert(first.applied);assert.match(first.schemaSha256,/^[a-f0-9]{64}$/);
  const again=await execute();assert.equal(again.schemaSha256,first.schemaSha256);
  base.username=role;base.password=password;
  runtime=new Pool({connectionString:base.toString(),options:`-c search_path=${schema}`,max:1});
  await verifyRuntimeSchema(runtime,first.schemaSha256);
  await runtime.query('INSERT INTO ncpf_jobs(id,cpf_hash,payload,purpose) VALUES($1,$2,$3,$4)',[randomUUID(),'fixture-hash','fixture-encrypted-payload','interactive']);
  await assert.rejects(()=>runtime!.query('ALTER TABLE signatures ADD COLUMN should_fail integer'),/owner|permission/);
  await assert.rejects(()=>runtime!.query('DELETE FROM ncpf_evidence'),/permission/);
  await assert.rejects(()=>runtime!.query('DELETE FROM signature_name_history'),/permission/);
 }finally{
  await runtime?.end();
  await db._closeDbForTests();
  const clean=new Pool({connectionString:process.env.DATABASE_URL});
  try{await clean.query(`DROP ROLE IF EXISTS ${role}`);}finally{await clean.end();}
 }
});
