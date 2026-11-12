/** Offline operator only. Never imported by the web application. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";
// Supplied from the exact db.ts bytes by build-migrator.mjs, without editing db.ts.
// @ts-expect-error operator-only virtual module
import { MIGRATION_BASE_SCHEMA_SQL } from "peticao:migration-base-schema";
import { BATCH_A1_SCHEMA_SQL } from "../../site/src/lib/batch-a1-schema";
import { DOCUMENT_REFERENCE_SCHEMA_SQL } from "../../site/src/lib/document-reference-schema";
import { PETITION_BASE_SCHEMA_SQL } from "../../site/src/lib/petition-base-schema";
import { BATCH_PACKAGE_SCHEMA_SQL } from "../../site/src/lib/batch-package-schema";
import { PRESIDENT_OWN_DOCUMENT_SCHEMA_SQL } from "../../site/src/lib/president-own-document-schema";
import { PRESIDENT_OWN_A1_SCHEMA_SQL } from "../../site/src/lib/president-own-a1-schema";
import { MATERIALS_SCHEMA_SQL } from "../../site/src/lib/materials-schema";
import { schemaContract, schemaFingerprint, verifyRuntimeSchema } from "../../site/src/lib/db-schema-readiness";
import { installBatchRuntimeOwnership } from "../../site/src/lib/batch-runtime-ownership";

const schemaStatements = [MIGRATION_BASE_SCHEMA_SQL, BATCH_A1_SCHEMA_SQL, DOCUMENT_REFERENCE_SCHEMA_SQL,
  PETITION_BASE_SCHEMA_SQL, BATCH_PACKAGE_SCHEMA_SQL, PRESIDENT_OWN_DOCUMENT_SCHEMA_SQL,
  PRESIDENT_OWN_A1_SCHEMA_SQL, MATERIALS_SCHEMA_SQL];

const ident = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const hash = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const refuse = (code: string): never => { throw new Error("operator:" + code); };

async function main() {
  const [mode, filename] = process.argv.slice(2);
  if (!["inspect", "qualify", "apply"].includes(mode) || !filename) refuse("invalid_arguments");
  const plan = JSON.parse(readFileSync(filename, "utf8"));
  if (plan.version !== 1 || typeof plan.database !== "string" || plan.schema !== "public" ||
      !plan.roles || ["legacy", "v2", "migration"].some(k => !/^[a-z][a-z0-9_]{0,62}$/.test(plan.roles[k])) ||
      new Set(Object.values(plan.roles)).size !== 3) refuse("invalid_plan");
  if (mode !== "inspect" && (!hash(plan.expectedBefore) || plan.replaySeeds !== false)) refuse("reviewed_before_hash_and_no_seed_replay_required");
  if (mode === "apply" && !hash(plan.expectedAfter)) refuse("qualified_after_hash_required");
  if (!process.env.MIGRATION_DATABASE_URL) refuse("migration_database_url_required");
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  const wrappedPool = { connect: async () => ({ query: client.query.bind(client), release() {} }) } as unknown as Pool;
  try {
    const c = (await client.query("SELECT current_database() db,current_schema() schema,session_user actor,current_setting('server_version_num')::int version")).rows[0];
    if (c.db !== plan.database || c.schema !== "public" || c.actor !== plan.roles.migration || c.version < 170000 || c.version >= 180000) refuse("database_identity_mismatch");
    if (mode === "qualify" && c.db === "peticao") refuse("qualification_cannot_target_production_database");
    await client.query("SET statement_timeout='30000ms'; SET lock_timeout='3000ms'");
    if (mode === "inspect") await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    else {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(7002)");
    }
    const before = await schemaFingerprint(client);
    if (mode === "inspect") {
      const contract = plan.includeContract === true ? await schemaContract(client) : undefined;
      await client.query("COMMIT");
      let runtimePermissionsVerified = false;
      if (hash(plan.expectedAfter)) {
        if (before !== plan.expectedAfter) refuse("inspect_expected_after_mismatch");
        await client.query(`SET SESSION AUTHORIZATION ${ident(plan.roles.v2)}`);
        await verifyRuntimeSchema(wrappedPool, plan.expectedAfter);
        if ((await client.query("SELECT has_table_privilege(current_user,'public.audit_log','UPDATE,DELETE') allowed")).rows[0].allowed) refuse("audit_history_mutation_authority");
        await client.query("RESET SESSION AUTHORIZATION");
        runtimePermissionsVerified = true;
      }
      console.log(JSON.stringify({ ok: true, mode, database: c.db, schema: c.schema, actor: c.actor, fingerprint: before, contract, runtimePermissionsVerified }));
      return;
    }
    if (before !== plan.expectedBefore) refuse("before_schema_drift");
    const roles = (await client.query("SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::name[])", [Object.values(plan.roles)])).rows;
    if (roles.length !== 3 || roles.some(r => r.rolname !== plan.roles.migration && (r.rolsuper || r.rolbypassrls))) refuse("unsafe_or_missing_application_roles");
    // Canonical DDL/defaults only: do not replay the separate catalogue seed
    // routines or signature backfills against a live database.
    for (const sql of schemaStatements) await client.query(sql);
    const ownership = await installBatchRuntimeOwnership(client, plan.roles, { transaction: "caller" });
      const role = ident(plan.roles.v2);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role};
        GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role};
        GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};
        REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON mail_outbox,application_runtime_roles FROM ${role};
        REVOKE UPDATE,DELETE ON audit_log FROM ${role};
        REVOKE CREATE ON SCHEMA public FROM ${role}; REVOKE CREATE ON DATABASE ${ident(c.db)} FROM ${role}`);
    const after = await schemaFingerprint(client);
    // This is a permission check through a trusted operator connection. Actual
    // application password/TCP authentication is a separate readiness gate.
    await client.query(`SET SESSION AUTHORIZATION ${ident(plan.roles.v2)}`);
    await verifyRuntimeSchema(wrappedPool, after, { transaction: "caller" });
    if ((await client.query("SELECT has_table_privilege(current_user,'public.audit_log','UPDATE,DELETE') allowed")).rows[0].allowed) refuse("audit_history_mutation_authority");
    await client.query("RESET SESSION AUTHORIZATION");
    const matchesExpected = mode === "qualify" || after === plan.expectedAfter;
    if (!matchesExpected) refuse("after_schema_mismatch_rolled_back");
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: matchesExpected, mode, database: c.db, before, after,
      matchesExpected, roles: plan.roles, guardedReferences: ownership.guardedReferences,
      catalogueSeedsReplayed: false, signatureBackfillReplayed: false,
      canonicalDefaultDml: ["unir.br insert if absent", "unir.br null acronym to UNIR"],
      schemaInputSha256: schemaStatements.map(sql => createHash("sha256").update(sql).digest("hex")),
      singleTransaction: true, advisoryLock: 7002,
      phases: ["schema_verified", "ownership_verified", "grants_verified", "runtime_permissions_verified", "single_commit"],
      activatesApplication: false }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await client.query("RESET SESSION AUTHORIZATION").catch(() => {});
    throw error;
  } finally { client.release(); await pool.end(); }
}

main().catch(error => {
  // PG DETAIL can include personal records; never log the error object/stack.
  console.error(JSON.stringify({ ok: false, error: String(error.message).startsWith("operator:") ? error.message : "migration_failed",
    databaseCode: typeof error.code === "string" ? error.code : null, activatesApplication: false }));
  process.exitCode = 1;
});
