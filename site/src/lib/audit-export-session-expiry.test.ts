import test from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;

type AuditKind = "signatures" | "dispersion";

/**
 * The BEFORE INSERT trigger spends time AFTER the audit's initial authorization.
 * Notices are observable before transaction completion: unlike a probe table,
 * they survive the required rollback, proving that the session was valid before
 * the pause and expired afterwards. No lock timeout or deliberate exception can
 * produce a false positive. The old implementation returns true and commits.
 */
async function auditExpiryScenario(kind: AuditKind) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "54375", "only the coordinated isolated QA database");
  assert.equal(url.pathname, "/peticao");
  assert.equal(process.env.MAIL_PROVIDER, "dev");
  assert.equal(process.env.MAIL_PROVIDERS, "dev");

  const db = await import("./db");
  await db._openForTests(`t_audit_expiry_${kind}`);
  const clients = new Set<PoolClient>();
  const messages: string[] = [];
  const notice = (value: { message?: string }) => {
    if (value.message?.startsWith("QA_EXPORT_EXPIRY_")) messages.push(value.message);
  };
  const attach = (client: PoolClient) => {
    if (!clients.has(client)) {
      clients.add(client);
      client.on("notice", notice);
    }
  };
  let pool: ReturnType<typeof db.getPool> | undefined;
  try {
    await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-export-expiry@example.test','QA Export','edicao','QA-NOT-LOGIN')");
    const users = await import("./admin-users");
    const session = await users.abrirSessao(1, "127.0.0.1");
    const actor = await users.sessaoPorToken(session.token);
    assert.ok(actor);
    const sessionId = actor.sessaoId;
    assert.ok(typeof sessionId === "number" && Number.isInteger(sessionId) && sessionId > 0);

    // Numeric ID originates in this test's database, never an untrusted string.
    await db.query(`
      CREATE FUNCTION qa_export_expiry_pause() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE before_valid boolean; after_valid boolean;
      BEGIN
        IF NEW.event='export_internal_base' THEN
          SELECT expira_em>clock_timestamp() INTO before_valid FROM admin_sessions WHERE id=${sessionId};
          RAISE NOTICE 'QA_EXPORT_EXPIRY_BEFORE:%', CASE WHEN before_valid THEN 'valid' ELSE 'expired' END;
          PERFORM pg_sleep(0.75);
          SELECT expira_em>clock_timestamp() INTO after_valid FROM admin_sessions WHERE id=${sessionId};
          RAISE NOTICE 'QA_EXPORT_EXPIRY_AFTER:%', CASE WHEN after_valid THEN 'valid' ELSE 'expired' END;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER qa_export_expiry_pause BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION qa_export_expiry_pause()
    `);
    const auditExport = kind === "signatures"
      ? (await import("./signature-explorer-admin-store")).auditSignatureExport
      : (await import("./dispersion-admin-store")).auditDispersionExport;
    pool = db.getPool();
    pool.on("acquire", attach);
    const previousCount = Number((await db.query("SELECT count(*)::text n FROM audit_log WHERE event='export_internal_base'")).rows[0].n);

    // All setup/import/bootstrap work is complete before opening the short window.
    await db.query("UPDATE admin_sessions SET expira_em=clock_timestamp()+interval '500 milliseconds' WHERE id=$1", [sessionId]);
    const result = await auditExport(actor, {
      rows: 0,
      bytes: 256,
      sha256: "a".repeat(64),
      asOf: "2026-11-10T12:00:00.000Z",
    });

    assert.deepEqual(messages, ["QA_EXPORT_EXPIRY_BEFORE:valid", "QA_EXPORT_EXPIRY_AFTER:expired"], "prove authorization initially succeeded and time expired inside audit, rather than another failure");
    assert.equal(result, false, "an expired session cannot release the prepared export");
    assert.equal(Number((await db.query("SELECT count(*)::text n FROM audit_log WHERE event='export_internal_base'")).rows[0].n), previousCount, "final authorization failure rolls back the audit entry atomically");
    assert.ok((await db.verifyAuditChain()).ok);
    assert.equal(Number((await db.query("SELECT count(*)::text n FROM mail_outbox")).rows[0].n), 0);
  } finally {
    pool?.off("acquire", attach);
    for (const client of clients) client.off("notice", notice);
    await db._closeDbForTests();
  }
}

test("signature CSV audit rechecks a session that expires during the audit write and rolls back", async () => {
  await auditExpiryScenario("signatures");
});

test("dispersion CSV audit rechecks a session that expires during the audit write and rolls back", async () => {
  await auditExpiryScenario("dispersion");
});
