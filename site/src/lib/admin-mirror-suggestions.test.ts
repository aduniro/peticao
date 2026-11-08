import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { getPool } from "./db";
import { sugerir, _limparDominios } from "./email-sugestao";

test("mirror email suggestions use stored domains without invoking DNS; normal mode still checks MX", async () => {
  const before = process.env.ADMIN_MIRROR_MODE;
  process.env.ADMIN_MIRROR_MODE = "1";
  const pool = getPool();
  const stub = mock.method(pool, "query", async (sql: string) => sql.includes("admin_mirror_state") ? { rows: [{ revision: "fixture" }], rowCount: 1 } : { rows: [], rowCount: 0 });
  let calls = 0;
  const dns = async () => { calls++; return "erro" as const; };
  try {
    _limparDominios();
    assert.equal((await sugerir("fixture@gmal.com", undefined, dns)).sugestao, "fixture@gmail.com");
    assert.equal(calls, 0);
    delete process.env.ADMIN_MIRROR_MODE;
    await sugerir("fixture@gmal.com", undefined, dns);
    assert.equal(calls, 1);
  } finally {
    _limparDominios(); stub.mock.restore(); await pool.end();
    if (before === undefined) delete process.env.ADMIN_MIRROR_MODE; else process.env.ADMIN_MIRROR_MODE = before;
  }
});
