import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import pg from "../../site/node_modules/pg/lib/index.js";
const name = process.argv[2]; assert.equal(name, "batch-input");
assert.equal(process.env.QA_BASE_URL, "http://127.0.0.1:3035"); assert.equal(process.env.DEV_DB_PORT, "54357"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }), schema = `qa_consolidation_${name.replaceAll("-", "_")}_${process.pid}`;
let server, stopped, log;
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  const env = { ...process.env, DATABASE_SCHEMA: schema }; log = createWriteStream(`${env.QA_OUTPUT_DIR}/${name}-server.log`);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3035"], { env }); stopped = once(server, "exit"); server.stdout.pipe(log); server.stderr.pipe(log);
  let ready = false;
  for (let n = 0; n < 120; n++) { if (server.exitCode !== null) throw new Error("Owned QA server exited"); try { ready = (await fetch(`${env.QA_BASE_URL}/admin`, { signal: AbortSignal.timeout(5000) })).status === 200; } catch {} if (ready) break; await new Promise(r => setTimeout(r, 500)); }
  assert.ok(ready);
  const child = spawn(process.execPath, ["--import", "tsx", `../tools/admin-qa/${name}.mjs`], { env, stdio: "inherit" }); const [code] = await once(child, "exit"); assert.equal(code, 0); console.log(`PASS compiled ${name} on owned 3035/54357`);
} finally {
  if (server) { server.kill("SIGTERM"); const timer = setTimeout(() => server.kill("SIGKILL"), 10000); await stopped; clearTimeout(timer); log.end(); }
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end();
}
