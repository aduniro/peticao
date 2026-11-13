/** Offline migration. Run as the existing schema operator, never a web runtime. */
import { Pool } from "pg";
import { NCPF_SCHEMA_SQL } from "../src/lib/ncpf-schema";
import { schemaFingerprint } from "../src/lib/db-schema-readiness";
async function main() {
const schema=process.env.DATABASE_SCHEMA;
if(schema && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))throw new Error('invalid_schema');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,...(schema?{options:`-c search_path=${schema}`}:{})});
const identifier=(s:string)=>'"'+s.replace(/"/g,'""')+'"';
const c=await pool.connect();
try{
 if (process.argv.includes('--apply')) {
  await c.query('BEGIN');
  try {
   await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='60000ms'");
   await c.query(NCPF_SCHEMA_SQL);
   const present=(await c.query("SELECT to_regclass(format('%I.application_runtime_roles',current_schema())) IS NOT NULL present")).rows[0].present;
   if (present) {
    const roles=(await c.query<{role_name:string}>("SELECT role_name FROM application_runtime_roles WHERE runtime_role IN ('v2','legacy')")).rows;
    for(const row of roles) {
     const role=identifier(row.role_name);
     await c.query(`GRANT INSERT(declared_name,name_source,name_evidence_id,api_name_snapshot),UPDATE(name,name_source,name_evidence_id) ON signatures TO ${role}`);
     await c.query(`GRANT SELECT,INSERT ON ncpf_evidence,signature_name_history,ncpf_candidates TO ${role}`);
     await c.query(`GRANT UPDATE(document_sha256) ON ncpf_evidence TO ${role}`);
     await c.query(`GRANT SELECT,INSERT,UPDATE ON ncpf_jobs,ncpf_intents,signup_receipts,confirmation_receipts TO ${role}`);
     await c.query(`GRANT DELETE ON ncpf_intents,signup_receipts,confirmation_receipts TO ${role}`);
     await c.query(`GRANT USAGE,SELECT ON SEQUENCE signature_name_history_id_seq TO ${role}`);
    }
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}
 }
 console.log(JSON.stringify({schemaSha256:await schemaFingerprint(c),applied:process.argv.includes('--apply')}));
}finally{c.release();await pool.end();}

}
main().catch(()=>{console.error("ncpf_offline_operation_failed");process.exitCode=1;});
