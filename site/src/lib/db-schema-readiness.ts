import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

// Metadata only: excludes business rows, sequence current values, OIDs, owners and ACLs.
// The expected hash is frozen by the reviewed migration, never learned on startup.
const CONTRACT_SQL = `
WITH relations AS (
 SELECT c.oid,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m')
)
SELECT jsonb_build_object(
 'columns',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name,ordinal_position)
  FROM (SELECT table_name,column_name,ordinal_position,udt_schema,udt_name,is_nullable,
    column_default,identity_generation,is_generated,generation_expression
    FROM information_schema.columns WHERE table_schema=current_schema()) x),'[]'::jsonb),
 'relations',COALESCE((SELECT jsonb_agg(jsonb_build_array(relname,relkind,relrowsecurity,relforcerowsecurity)
  ORDER BY relname) FROM relations),'[]'::jsonb),
 'constraints',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.relname,c.conname,c.contype,c.convalidated,
   c.condeferrable,c.condeferred,pg_get_constraintdef(c.oid,true)) ORDER BY r.relname,c.conname)
  FROM pg_constraint c JOIN relations r ON r.oid=c.conrelid),'[]'::jsonb),
 'indexes',COALESCE((SELECT jsonb_agg(jsonb_build_array(tablename,indexname,indexdef)
  ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname=current_schema()),'[]'::jsonb),
 'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.relname,t.tgname,t.tgenabled,
   pg_get_triggerdef(t.oid,true)) ORDER BY r.relname,t.tgname)
  FROM pg_trigger t JOIN relations r ON r.oid=t.tgrelid WHERE NOT t.tgisinternal),'[]'::jsonb),
 'functions',COALESCE((SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=current_schema() AND p.prokind IN ('f','p')),'[]'::jsonb),
 'policies',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname)
  FROM pg_policies p WHERE schemaname=current_schema()),'[]'::jsonb),
 'sequences',COALESCE((SELECT jsonb_agg(jsonb_build_array(sequencename,data_type,start_value,
   min_value,max_value,increment_by,cycle,cache_size) ORDER BY sequencename)
  FROM pg_sequences WHERE schemaname=current_schema()),'[]'::jsonb)
) AS contract`;

export async function schemaContract(client: Pick<PoolClient, "query">): Promise<{ catalog: unknown; runtimeRoles: { runtime_role: string; role_name: string }[] | null }> {
  const result = await client.query<{ contract: unknown }>(CONTRACT_SQL);
  const present = (await client.query<{ present: boolean }>("SELECT to_regclass(format('%I.application_runtime_roles',current_schema())) IS NOT NULL present")).rows[0].present;
  const bindings = present ? (await client.query<{ runtime_role: string; role_name: string }>("SELECT runtime_role,role_name FROM application_runtime_roles ORDER BY runtime_role")).rows : null;
  return { catalog: result.rows[0].contract, runtimeRoles: bindings };
}

export async function schemaFingerprint(client: Pick<PoolClient, "query">): Promise<string> {
  return createHash("sha256").update(JSON.stringify(await schemaContract(client))).digest("hex");
}

/** Web default: SELECTs inside READ ONLY. Only the offline operator owns a caller transaction. */
export async function verifyRuntimeSchema(pool: Pool, expected: string | undefined, options: { transaction?: "own" | "caller"; batchController?: "split" | "v2" } = {}): Promise<void> {
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("runtime_schema_hash_required");
  const client = await pool.connect();
  const ownTransaction = options.transaction !== "caller";
  try {
    if (ownTransaction) await client.query("BEGIN READ ONLY");
    else if (!(await client.query("SELECT pg_current_xact_id_if_assigned() IS NOT NULL active")).rows[0].active) {
      throw new Error("caller_transaction_with_assigned_xid_required");
    }
    await client.query("SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='1000ms'");
    const role = (await client.query<{
      rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean;
      rolbypassrls: boolean; schema_create: boolean; database_create: boolean; owns_objects: boolean; legacy_queue_mutation: boolean; role_binding_mutation: boolean; batch_control_mutation: boolean;
    }>(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
      has_schema_privilege(current_user,current_schema(),'CREATE') schema_create,
      has_database_privilege(current_user,current_database(),'CREATE') database_create,
      has_table_privilege(current_user,format('%I.mail_outbox',current_schema()),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') legacy_queue_mutation,
      has_table_privilege(current_user,to_regclass(format('%I.application_runtime_roles',current_schema())),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') role_binding_mutation,
      has_table_privilege(current_user,to_regclass(format('%I.batch_runtime_control',current_schema())),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') batch_control_mutation,
      (EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND pg_has_role(current_user,c.relowner,'MEMBER'))
       OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=current_schema() AND pg_has_role(current_user,p.proowner,'MEMBER'))) owns_objects
      FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
    if (!role || Object.values(role).some(Boolean)) throw new Error("runtime_role_has_ddl_authority");
    const contract = await schemaContract(client);
    const actor = (await client.query<{ actor: string }>("SELECT session_user actor")).rows[0].actor;
    if (!contract.runtimeRoles || contract.runtimeRoles.length !== 3 || contract.runtimeRoles.find(row => row.runtime_role === "v2")?.role_name !== actor) throw new Error("runtime_v2_role_binding_required");
    const controllerPresent = (await client.query("SELECT to_regclass(format('%I.batch_runtime_control',current_schema())) IS NOT NULL present")).rows[0].present;
    const controller = controllerPresent ? (await client.query("SELECT controller FROM batch_runtime_control WHERE singleton")).rows[0]?.controller : "split";
    const expectedController = options.batchController ?? (process.env.BATCH_LEGACY_CONTROL === "admin-v2" ? "v2" : "split");
    if (controller !== expectedController) throw new Error("runtime_batch_controller_configuration_mismatch");
    const actual = createHash("sha256").update(JSON.stringify(contract)).digest("hex");
    if (actual !== expected) throw new Error("runtime_schema_fingerprint_mismatch");
    if (ownTransaction) await client.query("COMMIT");
  } catch (error) {
    if (ownTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
