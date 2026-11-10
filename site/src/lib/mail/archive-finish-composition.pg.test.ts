import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string, string>).NODE_ENV = "test";
const TO = "qa-finish-compose@example.test", SCOPE = "a".repeat(64), OTHER_SCOPE = "b".repeat(64);
const RECEIPT = "QA-COMPOSABLE-RECEIPT", STAMP = "2026-11-10T12:00:00.123456Z";
async function setup(schema: string) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "54382"); assert.equal(url.pathname, "/peticao");
  assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
  const db = await import("../db"), A = await import("./archive"), E = await import("./message-events");
  await db._openForTests(schema);
  const message = await A.prepareMessage({ to: TO, subject: "QA", text: "Fictitious composable finish" }, "confirmacao", "transactional");
  const complete = (id: string, outcome: "accepted" | "rejected" | "indeterminate", options: { providerId?: string; errorCode?: string; accountScope?: string } = {}) => db.tx(async client => {
    const result = await A.finishAttemptInTransaction(client, id, outcome, options);
    await A.appendFinishedAttemptAudit(client, result);
    return result;
  });
  const snapshot = async () => {
    const all: unknown[] = [];
    for (const table of ["mail_messages", "mail_message_attempts", "mail_message_events", "mail_log", "audit_log"]) {
      all.push((await db.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows);
    }
    return all;
  };
  const begin = async (provider = "dev", retryUncertain = false) => {
    const attempt = await A.beginAttempt(message.id, provider, "QA <qa@example.test>", { retryUncertain });
    assert.ok(attempt.ok); return attempt.id;
  };
  return { db, A, E, message, complete, snapshot, begin };
}
test("composable known rejection persists failed log and idempotent replay creates no new audit", async () => {
  const c = await setup("qa_finish_compose_rejected");
  try {
    const id = await c.begin(); assert.deepEqual(await c.complete(id, "rejected", { errorCode: "provider_rejected" }), { ok: true, existing: false });
    assert.deepEqual((await c.db.query("SELECT state,error_code FROM mail_message_attempts WHERE id=$1", [id])).rows[0], { state: "rejected", error_code: "provider_rejected" });
    assert.equal((await c.db.query("SELECT status FROM mail_messages WHERE id=$1", [c.message.id])).rows[0].status, "rejected");
    assert.deepEqual((await c.db.query("SELECT status,error FROM mail_log WHERE message_id=$1", [c.message.id])).rows, [{ status: "failed", error: "provider_rejected" }]);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='mail_message_attempt_finished'")).rows[0].n, 1);
    const before = await c.snapshot(); assert.deepEqual(await c.complete(id, "rejected", { errorCode: "provider_rejected" }), { ok: true, existing: true });
    assert.deepEqual(await c.snapshot(), before);
    assert.deepEqual(await c.complete(id, "accepted"), { ok: false, error: "outcome_conflict" }); assert.deepEqual(await c.snapshot(), before);
    assert.equal((await c.db.verifyAuditChain()).ok, true);
  } finally { await c.db._closeDbForTests(); }
});
test("composable aggregate preserves earlier uncertainty until a real accepted outcome dominates", async () => {
  const c = await setup("qa_finish_compose_aggregate");
  try {
    const first = await c.begin(); await c.complete(first, "rejected", { errorCode: "known_rejection" });
    const second = await c.begin("smtp"); await c.complete(second, "indeterminate", { errorCode: "transport_uncertain" });
    assert.deepEqual(await c.A.beginAttempt(c.message.id, "dev", "QA <qa@example.test>"), { ok: false, error: "indeterminate" });
    // Explicit legacy admission exercises aggregate SQL only. No controller/transport retries are installed or invoked.
    const third = await c.begin("dev", true); await c.complete(third, "rejected", { errorCode: "known_rejection" });
    assert.equal((await c.db.query("SELECT status FROM mail_messages WHERE id=$1", [c.message.id])).rows[0].status, "indeterminate");
    const fourth = await c.begin("smtp", true); await c.complete(fourth, "accepted", { providerId: RECEIPT });
    assert.equal((await c.db.query("SELECT status FROM mail_messages WHERE id=$1", [c.message.id])).rows[0].status, "accepted");
    const statuses = (await c.db.query("SELECT id,state FROM mail_message_attempts WHERE message_id=$1", [c.message.id])).rows;
    assert.equal(statuses.length, 4); assert.equal(statuses.find(r => r.id === second)?.state, "indeterminate");
    assert.equal(statuses.filter(r => r.state === "rejected").length, 2); assert.equal(statuses.filter(r => r.state === "accepted").length, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_log WHERE message_id=$1", [c.message.id])).rows[0].n, 4);
    assert.deepEqual(await c.A.beginAttempt(c.message.id, "dev", "QA <qa@example.test>"), { ok: false, error: "already_accepted" });
    assert.equal((await c.db.verifyAuditChain()).ok, true);
  } finally { await c.db._closeDbForTests(); }
});
test("composable completion reconciles exact scope/receipt and preserves original microsecond event facts", async () => {
  const c = await setup("qa_finish_compose_scope");
  try {
    const id = await c.begin("ses");
    await c.E.recordMessageEvents([SCOPE, OTHER_SCOPE].map(accountScope => ({ provider: "ses", accountScope, providerId: RECEIPT, recipient: TO, type: "delivered", timestamp: STAMP, source: "sns" as const })));
    const before = (await c.db.query("SELECT to_jsonb(e) value FROM mail_message_events e ORDER BY account_scope")).rows.map(r => r.value);
    assert.equal(before.length, 2); assert.ok(before.every(r => r.association_state === "unlinked"));
    await c.complete(id, "accepted", { providerId: RECEIPT, accountScope: SCOPE });
    const after = (await c.db.query("SELECT to_jsonb(e) value FROM mail_message_events e ORDER BY account_scope")).rows.map(r => r.value);
    const linked = after.find(r => r.account_scope === SCOPE), unrelated = after.find(r => r.account_scope === OTHER_SCOPE);
    assert.equal(linked.association_state, "linked"); assert.equal(linked.message_id, c.message.id); assert.equal(linked.attempt_id, id);
    assert.equal(unrelated.association_state, "unlinked"); assert.equal(unrelated.message_id, null); assert.equal(unrelated.attempt_id, null);
    for (let index = 0; index < before.length; index++) {
      for (const key of ["id", "fingerprint", "provider", "provider_id", "recipient", "occurred_at", "received_at", "account_scope", "event_type"]) assert.deepEqual(after[index][key], before[index][key]);
    }
    assert.equal((await c.db.query("SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') at FROM mail_message_events LIMIT 1")).rows[0].at, STAMP);
    const durable = await c.snapshot(); assert.deepEqual(await c.complete(id, "accepted", { providerId: RECEIPT, accountScope: SCOPE }), { ok: true, existing: true });
    assert.deepEqual(await c.snapshot(), durable); assert.equal((await c.db.verifyAuditChain()).ok, true);
  } finally { await c.db._closeDbForTests(); }
});
test("deferred audit rejection rolls back receipt and reconciliation together", async () => {
  const c = await setup("qa_finish_compose_scope_rollback");
  try {
    const id = await c.begin("ses");
    await c.E.recordMessageEvents([{ provider: "ses", accountScope: SCOPE, providerId: RECEIPT, recipient: TO, type: "blocked", timestamp: STAMP, source: "sns" as const }]);
    await c.db.query("CREATE FUNCTION qa_finish_compose_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event='mail_message_attempt_finished' THEN RAISE EXCEPTION 'QA_COMPOSE_AUDIT_FAILED'; END IF; RETURN NEW; END$$");
    await c.db.query("CREATE TRIGGER qa_finish_compose_fail_trigger BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_finish_compose_fail()");
    const before = await c.snapshot(); await assert.rejects(c.complete(id, "accepted", { providerId: RECEIPT, accountScope: SCOPE }), /QA_COMPOSE_AUDIT_FAILED/);
    assert.deepEqual(await c.snapshot(), before); assert.equal((await c.db.query("SELECT association_state FROM mail_message_events")).rows[0].association_state, "unlinked");
    assert.equal((await c.db.query("SELECT state FROM mail_message_attempts WHERE id=$1", [id])).rows[0].state, "prepared");
    assert.deepEqual(await c.A.beginAttempt(c.message.id, "dev", "QA <qa@example.test>"), { ok: false, error: "in_progress" });
    assert.equal((await c.db.verifyAuditChain()).ok, true);
  } finally { await c.db._closeDbForTests(); }
});
