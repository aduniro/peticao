/** Offline-only schema operator. Plan rolls back; apply checks both hashes before commit. */
import { Pool } from "pg";
import { NCPF_SCHEMA_SQL } from "../src/lib/ncpf-schema";
import { schemaFingerprint } from "../src/lib/db-schema-readiness";
const option=(name:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const identifier=(s:string)=>'"'+s.replace(/"/g,'""')+'"';
const digest=(s:string|undefined):s is string=>!!s && /^[a-f0-9]{64}$/.test(s);
async function main() {
 const schema=process.env.DATABASE_SCHEMA ?? 'public';
 if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))throw new Error('invalid_schema');
 const apply=process.argv.includes('--apply'),plan=process.argv.includes('--plan');
 if(apply===plan)throw new Error('choose_plan_or_apply');
 const expectedBefore=option('expected-before'),expectedAfter=option('expected-after');
 const expectedDatabase=option('expected-database'),expectedRole=option('expected-role'),expectedSchema=option('expected-schema');
 const fence=option('fence'),manifest=option('manifest-sha256');
 if(apply && (!digest(expectedBefore)||!digest(expectedAfter)||!digest(manifest)||!expectedDatabase||!expectedRole||!expectedSchema||!fence||!/^[1-9][0-9]*$/.test(fence)))throw new Error('missing_reviewed_contract');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,options:`-c search_path=${schema}`});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  try{
   await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='60000ms'");
   const identity=(await c.query("SELECT current_database() database,current_schema() schema,current_user role,session_user session_role,pg_is_in_recovery() recovery")).rows[0];
   if(identity.recovery || (apply && (identity.database!==expectedDatabase||identity.schema!==expectedSchema||identity.role!==expectedRole||identity.session_role!==expectedRole)))throw new Error('database_identity_mismatch');
   if(!(await c.query('SELECT pg_try_advisory_xact_lock(7041314) locked')).rows[0].locked)throw new Error('migration_busy');
   const before=await schemaFingerprint(c);
   if(apply && before===expectedAfter){
    const recorded=(await c.query("SELECT fence::text,manifest_sha256 FROM application_migration_fences WHERE resource='ncpf-v1'")).rows[0];
    if(recorded?.fence!==fence||recorded?.manifest_sha256!==manifest)throw new Error('migration_replay_mismatch');
    await c.query('ROLLBACK');console.log(JSON.stringify({schemaSha256:before,beforeSha256:before,applied:false,alreadyApplied:true,identity}));return;
   }
   if(apply && before!==expectedBefore)throw new Error('schema_before_mismatch');
   await c.query(NCPF_SCHEMA_SQL);
   // This table is operator-owned. Runtime roles can inspect but cannot advance fencing.
   await c.query(`CREATE TABLE IF NOT EXISTS application_migration_fences(resource TEXT PRIMARY KEY,fence BIGINT NOT NULL,manifest_sha256 TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
   if(apply){
    const advanced=await c.query("INSERT INTO application_migration_fences(resource,fence,manifest_sha256) VALUES('ncpf-v1',$1,$2) ON CONFLICT(resource) DO UPDATE SET fence=EXCLUDED.fence,manifest_sha256=EXCLUDED.manifest_sha256,applied_at=now() WHERE application_migration_fences.fence<EXCLUDED.fence RETURNING resource",[fence,manifest]);
    if(!advanced.rowCount)throw new Error('stale_migration_fence');
   }
   const present=(await c.query("SELECT to_regclass(format('%I.application_runtime_roles',current_schema())) IS NOT NULL present")).rows[0].present;
   if(present){
    const roles=(await c.query<{role_name:string}>("SELECT role_name FROM application_runtime_roles WHERE runtime_role IN ('v2','legacy')")).rows;
    for(const row of roles){
     const role=identifier(row.role_name);
     await c.query(`GRANT INSERT(declared_name,name_source,name_evidence_id,api_name_snapshot,name_projected_at),UPDATE(name,name_source,name_evidence_id,name_projected_at) ON signatures TO ${role}`);
     await c.query(`GRANT SELECT,INSERT ON ncpf_evidence,ncpf_evidence_observations,signature_name_history,ncpf_candidates TO ${role}`);
     await c.query(`GRANT UPDATE(last_verified_at,expires_at) ON ncpf_evidence TO ${role}`);
     await c.query(`GRANT SELECT ON application_migration_fences TO ${role}`);
     await c.query(`GRANT SELECT,INSERT,UPDATE ON ncpf_jobs,ncpf_intents,signup_receipts,confirmation_receipts TO ${role}`);
     await c.query(`GRANT DELETE ON ncpf_intents,signup_receipts,confirmation_receipts TO ${role}`);
     await c.query(`GRANT USAGE,SELECT ON SEQUENCE signature_name_history_id_seq TO ${role}`);
    }
   }
   const after=await schemaFingerprint(c);
   if(apply && after!==expectedAfter)throw new Error('schema_after_mismatch');
   await c.query(apply?'COMMIT':'ROLLBACK');
   console.log(JSON.stringify({beforeSha256:before,schemaSha256:after,applied:apply,planned:plan,identity}));
  }catch(error){await c.query('ROLLBACK');throw error;}
 }finally{c.release();await pool.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'ncpf_offline_operation_failed');process.exitCode=1;});
