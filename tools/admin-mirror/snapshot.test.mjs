import test from "node:test";
import assert from "node:assert/strict";
import { digest, validateContract, validateSnapshot, publishSnapshot } from "./snapshot.mjs";

const contract = [{ name: "signatures", columns: [{ name: "id", type: "integer" }, { name: "name", type: "text" }], primaryKey: ["id"] }];
function fixture(rows = [{ id: 1, name: "Pessoa Fictícia" }]) {
  const tables = [{ name: "signatures", rows, count: rows.length, sha256: digest(rows) }];
  return { format: "peticao-admin-mirror/v1", complete: true, contractHash: digest(contract), capturedAt: "2026-11-08T06:00:00Z", tables, revision: digest(tables.map(({ name, count, sha256 }) => ({ name, count, sha256 }))) };
}
test("snapshot accepts a complete verified fixture and canonicalizes object key order", () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.equal(validateSnapshot(fixture(), contract), fixture().revision);
});
test("snapshot rejects missing data, corruption, unapproved columns and duplicate identities", () => {
  for (const mutate of [p => p.complete = false, p => p.tables = [], p => p.contractHash = "bad", p => p.tables[0].count++, p => p.tables[0].rows[0].name = "Changed", p => p.revision = "bad", p => p.capturedAt = "invalid"]) {
    const packet = fixture(); mutate(packet); assert.throws(() => validateSnapshot(packet, contract));
  }
  assert.throws(() => validateSnapshot(fixture([{ id: 1, name: "A" }, { id: 1, name: "B" }]), contract), /DUPLICATE/);
  assert.throws(() => validateSnapshot(fixture([{ id: 1, name: "A", email_cipher: "forbidden" }]), contract), /INVALID_ROW/);
});
test("contract excludes authentication, identity cache, tokens, secrets and SQL identifiers", () => {
  for (const name of ["admin_users", "admin_sessions", "cpf_lookup_cache", "signatures;DROP TABLE signatures"]) {
    assert.throws(() => validateContract([{ ...contract[0], name }]));
  }
  for (const name of ["token_hash", "verify_code", "wa_cipher", "email_cipher", "password", "payload"]) {
    assert.throws(() => validateContract([{ ...contract[0], columns: [{ name: "id", type: "integer" }, { name, type: "text" }] }]));
  }
});
function fakeClient(fail = false, stale = false) {
  const calls = [];
  return { calls, query: async (sql, params) => {
    calls.push({ sql, params });
    if (fail && sql.startsWith("INSERT INTO \"admin_mirror_stage_")) throw new Error("fixture import failure");
    if (sql.includes("count(*)")) return { rows: [{ n: "1" }], rowCount: 1 };
    if (sql.includes("FOR UPDATE")) return { rows: stale ? [{ captured_at: "2026-11-09T00:00:00Z" }] : [], rowCount: stale ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  } };
}
test("publication validates before opening a transaction and uses parameters for row values", async () => {
  const client = fakeClient();
  const bad = fixture();bad.complete = false;
  await assert.rejects(publishSnapshot(client, bad, contract));assert.equal(client.calls.length, 0);
  await publishSnapshot(client, fixture(), contract);
  assert.equal(client.calls.at(-1).sql, "COMMIT");
  assert(!client.calls.some(c => c.sql.includes("Pessoa Fictícia")));
  assert(client.calls.some(c => c.sql.includes("jsonb_populate_recordset") && c.params[0].includes("Pessoa Fictícia")));
});
test("import errors and out-of-order snapshots roll back without replacing the current schema", async () => {
  for (const client of [fakeClient(true), fakeClient(false, true)]) {
    await assert.rejects(publishSnapshot(client, fixture(), contract));
    assert.equal(client.calls.at(-1).sql, "ROLLBACK");
    assert(!client.calls.some(c => c.sql.startsWith("ALTER SCHEMA")));
  }
});
