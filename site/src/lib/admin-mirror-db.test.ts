import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { audit, getPool, query } from "./db";
import type { PoolClient } from "pg";

test("mirror initialization only checks readiness and never seeds or renumbers signatures", async () => {
  const previous = process.env.ADMIN_MIRROR_MODE;
  process.env.ADMIN_MIRROR_MODE = "1";
  const calls: string[] = [];
  const pool = getPool();
  const stub = mock.method(pool, "query", async (sql: string) => {
    calls.push(sql);
    return { rows: [{ revision: "fictitious-snapshot" }], rowCount: 1 };
  });
  try {
    await query("SELECT id FROM signatures LIMIT 1");
    assert.deepEqual(calls, [
      "SELECT revision FROM admin_mirror_state WHERE singleton = true",
      "SELECT id FROM signatures LIMIT 1",
    ]);
  } finally {
    stub.mock.restore();
    await pool.end();
    if (previous === undefined) delete process.env.ADMIN_MIRROR_MODE;
    else process.env.ADMIN_MIRROR_MODE = previous;
  }
});

test("mirror read audits do not append to the imported production audit chain", async () => {
  const previous = process.env.ADMIN_MIRROR_MODE;
  process.env.ADMIN_MIRROR_MODE = "1";
  const calls: string[] = [];
  const client = { query: async (sql: string) => { calls.push(sql); } } as unknown as PoolClient;
  try {
    await audit("signup_diagnostics_read", null, { count: 0 }, client);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^INSERT INTO admin_mirror_access_log /);
    assert.doesNotMatch(calls[0], /\baudit_log\b/);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_MIRROR_MODE;
    else process.env.ADMIN_MIRROR_MODE = previous;
  }
});
