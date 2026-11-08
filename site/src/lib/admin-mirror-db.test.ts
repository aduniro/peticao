import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { getPool, query } from "./db";

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
