import type { PoolClient } from "pg";

export type RuntimeRoles = { legacy: string; v2: string; migration: string };
const ident = (value: string) => '"' + value.replace(/"/g, '""') + '"';

/** Explicit migration step, never called by a request/bootstrap verifier. */
export async function installBatchRuntimeOwnership(client: PoolClient, roles: RuntimeRoles) {
  const names = Object.values(roles);
  if (new Set(names).size !== 3 || names.some(name => typeof name !== "string" || !name || Buffer.byteLength(name) > 63)) {
    throw new Error("three_distinct_runtime_roles_required");
  }
  const roleRows = (await client.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::name[])", [names])).rows;
  if (roleRows.length !== 3 || roleRows.some(row => row.rolname !== roles.migration && (row.rolsuper || row.rolbypassrls))) {
    throw new Error("application_roles_must_not_bypass_database_guards");
  }
  const context = (await client.query<{ actor: string; schema: string }>("SELECT session_user actor,current_schema() schema")).rows[0];
  if (context.actor !== roles.migration) throw new Error("dedicated_migration_identity_required");
  const schema = ident(context.schema), batches = `${schema}.batches`, bindings = `${schema}.application_runtime_roles`;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout='3000ms'; SET LOCAL statement_timeout='30000ms'");
    await client.query("SELECT pg_advisory_xact_lock(7002)");
    await client.query(`LOCK TABLE ${batches} IN ACCESS EXCLUSIVE MODE`);
    const existing = (await client.query<{ present: boolean }>("SELECT to_regclass($1) IS NOT NULL present", [context.schema + ".application_runtime_roles"])).rows[0].present;
    const children = (await client.query<{ relation: string; column_name: string; width: number; parent_column: string }>(`
      SELECT rel.relname relation,att.attname column_name,cardinality(c.conkey) width,parent.attname parent_column
      FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
      JOIN pg_attribute att ON att.attrelid=c.conrelid AND att.attnum=c.conkey[1]
      JOIN pg_attribute parent ON parent.attrelid=c.confrelid AND parent.attnum=c.confkey[1]
      WHERE c.contype='f' AND c.confrelid=$1::regclass AND n.nspname=$2
      ORDER BY rel.relname,att.attname`, [context.schema + ".batches", context.schema])).rows;
    if (children.some(row => row.width !== 1 || row.parent_column !== "id")) throw new Error("unsupported_composite_batch_reference");
    // Initial ownership never transfers an existing object to the new runtime.
    // Existing modular data needs its own reconciliation rather than inference.
    if (!existing) {
      for (const child of children) {
        if (["signatures", "batch_sends"].includes(child.relation)) continue;
        if ((await client.query(`SELECT 1 FROM ${schema}.${ident(child.relation)} LIMIT 1`)).rowCount) {
          throw new Error("preexisting_modular_batch_data_requires_reconciliation:" + child.relation);
        }
      }
    }
    await client.query(`CREATE TABLE IF NOT EXISTS ${bindings} (
      runtime_role text PRIMARY KEY CHECK(runtime_role IN ('legacy','v2','migration')),
      role_name name NOT NULL UNIQUE
    )`);
    const columns = (await client.query("SELECT column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='application_runtime_roles' ORDER BY ordinal_position", [context.schema])).rows;
    if (JSON.stringify(columns) !== JSON.stringify([
      { column_name: "runtime_role", udt_name: "text", is_nullable: "NO" },
      { column_name: "role_name", udt_name: "name", is_nullable: "NO" },
    ])) throw new Error("runtime_role_binding_shape_drift");
    if (existing) {
      const previous = (await client.query<{ runtime_role: keyof RuntimeRoles; role_name: string }>(`SELECT runtime_role,role_name FROM ${bindings} ORDER BY runtime_role`)).rows;
      if (previous.length !== 3 || previous.some(row => roles[row.runtime_role] !== row.role_name)) throw new Error("runtime_role_bindings_are_immutable");
    }
    for (const [runtime, role] of Object.entries(roles)) {
      await client.query(`INSERT INTO ${bindings}(runtime_role,role_name) VALUES($1,$2) ON CONFLICT(runtime_role) DO NOTHING`, [runtime, role]);
    }
    await client.query(`ALTER TABLE ${batches} ADD COLUMN IF NOT EXISTS runtime_owner text NOT NULL DEFAULT 'legacy'`);
    const ownerColumn = (await client.query("SELECT udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name='batches' AND column_name='runtime_owner'", [context.schema])).rows[0];
    if (!ownerColumn || ownerColumn.udt_name !== "text" || ownerColumn.is_nullable !== "NO" || ownerColumn.column_default !== "'legacy'::text") throw new Error("batch_runtime_owner_shape_drift");
    if ((await client.query(`SELECT 1 FROM ${batches} WHERE runtime_owner NOT IN ('legacy','v2') LIMIT 1`)).rowCount) throw new Error("unknown_existing_batch_owner");
    await client.query(`
      CREATE OR REPLACE FUNCTION ${schema}.batch_runtime_actor() RETURNS text
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
      AS $body$ SELECT runtime_role FROM ${bindings} WHERE role_name=session_user::name $body$;

      CREATE OR REPLACE FUNCTION ${schema}.batch_runtime_check(p_id integer) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
      DECLARE actor text; owner text;
      BEGIN
        actor:=${schema}.batch_runtime_actor();
        IF actor='migration' THEN RETURN; END IF;
        IF actor IS NULL THEN RAISE EXCEPTION 'unmapped batch runtime' USING ERRCODE='42501'; END IF;
        SELECT runtime_owner INTO owner FROM ${batches} WHERE id=p_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'batch not found' USING ERRCODE='23503'; END IF;
        IF actor<>owner THEN RAISE EXCEPTION 'batch belongs to another runtime' USING ERRCODE='42501'; END IF;
      END $body$;

      CREATE OR REPLACE FUNCTION ${schema}.guard_batch_runtime() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
      DECLARE actor text;
      BEGIN
        actor:=${schema}.batch_runtime_actor();
        IF actor IS NULL THEN RAISE EXCEPTION 'unmapped batch runtime' USING ERRCODE='42501'; END IF;
        IF TG_OP='INSERT' THEN
          IF actor<>'migration' THEN NEW.runtime_owner:=actor; END IF;
          IF NEW.runtime_owner NOT IN ('legacy','v2') THEN RAISE EXCEPTION 'invalid batch owner' USING ERRCODE='23514'; END IF;
          RETURN NEW;
        END IF;
        IF TG_OP='DELETE' THEN
          IF actor<>'migration' THEN RAISE EXCEPTION 'batch history cannot be deleted' USING ERRCODE='42501'; END IF;
          RETURN OLD;
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id THEN
          RAISE EXCEPTION 'batch identity cannot be changed' USING ERRCODE='42501';
        END IF;
        IF NEW.runtime_owner IS DISTINCT FROM OLD.runtime_owner THEN
          RAISE EXCEPTION 'batch ownership cannot be transferred' USING ERRCODE='42501';
        END IF;
        PERFORM ${schema}.batch_runtime_check(OLD.id);
        RETURN NEW;
      END $body$;

      CREATE OR REPLACE FUNCTION ${schema}.guard_batch_runtime_reference() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
      DECLARE old_id integer; new_id integer;
      BEGIN
        IF ${schema}.batch_runtime_actor()='migration' THEN
          IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;
        IF TG_OP<>'INSERT' THEN old_id:=(to_jsonb(OLD)->>TG_ARGV[0])::integer; END IF;
        IF TG_OP<>'DELETE' THEN new_id:=(to_jsonb(NEW)->>TG_ARGV[0])::integer; END IF;
        IF TG_TABLE_NAME='signatures' AND TG_OP='UPDATE' AND old_id IS NOT DISTINCT FROM new_id THEN RETURN NEW; END IF;
        IF old_id IS NOT NULL THEN PERFORM ${schema}.batch_runtime_check(old_id); END IF;
        IF new_id IS NOT NULL THEN PERFORM ${schema}.batch_runtime_check(new_id); END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END $body$;

      CREATE OR REPLACE FUNCTION ${schema}.guard_runtime_role_bindings() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
      BEGIN
        IF TG_OP='TRUNCATE' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'runtime bindings are immutable' USING ERRCODE='42501'; END IF;
        IF ${schema}.batch_runtime_actor() IS DISTINCT FROM 'migration' THEN RAISE EXCEPTION 'runtime bindings are migration-only' USING ERRCODE='42501'; END IF;
        IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'runtime bindings cannot be reassigned' USING ERRCODE='42501'; END IF;
        RETURN NEW;
      END $body$;
      CREATE OR REPLACE FUNCTION ${schema}.guard_batch_runtime_truncate() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
      BEGIN
        IF ${schema}.batch_runtime_actor() IS DISTINCT FROM 'migration' THEN
          RAISE EXCEPTION 'batch history truncate is migration-only' USING ERRCODE='42501';
        END IF;
        RETURN NULL;
      END $body$;
      DROP TRIGGER IF EXISTS batch_runtime_owner_guard ON ${batches};
      CREATE TRIGGER batch_runtime_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON ${batches}
      FOR EACH ROW EXECUTE FUNCTION ${schema}.guard_batch_runtime();
      DROP TRIGGER IF EXISTS batch_runtime_no_truncate ON ${batches};
      CREATE TRIGGER batch_runtime_no_truncate BEFORE TRUNCATE ON ${batches}
      FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.guard_batch_runtime_truncate();
      DROP TRIGGER IF EXISTS runtime_role_bindings_guard ON ${bindings};
      CREATE TRIGGER runtime_role_bindings_guard BEFORE INSERT OR UPDATE OR DELETE ON ${bindings}
      FOR EACH ROW EXECUTE FUNCTION ${schema}.guard_runtime_role_bindings();
      DROP TRIGGER IF EXISTS runtime_role_bindings_no_truncate ON ${bindings};
      CREATE TRIGGER runtime_role_bindings_no_truncate BEFORE TRUNCATE ON ${bindings}
      FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.guard_runtime_role_bindings();
    `);
    const references = [...children];
    if (!references.some(row => row.relation === "signatures" && row.column_name === "batch_id")) references.push({ relation: "signatures", column_name: "batch_id", width: 1, parent_column: "id" });
    for (const child of references) {
      const table = `${schema}.${ident(child.relation)}`;
      const trigger = ident("batch_runtime_reference_" + child.column_name);
      if (Buffer.byteLength("batch_runtime_reference_" + child.column_name) > 63) throw new Error("unsupported_long_batch_reference_name");
      // Column names come from the catalog; quote the trigger argument as text.
      const columnLiteral = "'" + child.column_name.replace(/'/g, "''") + "'";
      await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}; CREATE TRIGGER ${trigger}
        BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW
        EXECUTE FUNCTION ${schema}.guard_batch_runtime_reference(${columnLiteral})`);
      await client.query(`DROP TRIGGER IF EXISTS batch_runtime_no_truncate ON ${table};
        CREATE TRIGGER batch_runtime_no_truncate BEFORE TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.guard_batch_runtime_truncate();
        REVOKE TRUNCATE ON ${table} FROM ${ident(roles.legacy)},${ident(roles.v2)}`);
    }
    await client.query(`REVOKE ALL ON ${bindings} FROM PUBLIC,${ident(roles.legacy)},${ident(roles.v2)};
      GRANT SELECT ON ${bindings} TO ${ident(roles.legacy)},${ident(roles.v2)};
      REVOKE TRUNCATE ON ${batches} FROM ${ident(roles.legacy)},${ident(roles.v2)}`);
    await client.query("COMMIT");
    return { schema: context.schema, roles, guardedReferences: references.map(row => ({ table: row.relation, column: row.column_name })), transferredExistingBatches: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
