import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import pg from "../../site/node_modules/pg/lib/index.js";

assert.equal(process.env.DEV_DB_PORT, "54349");
assert.equal(process.env.MAIL_PROVIDER, "dev");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const contracts = process.argv.slice(2).length ? process.argv.slice(2) : ["referrals", "referrals-browser", "content-retention", "whatsapp-senders"];
assert.ok(contracts.every(name => ["referrals", "referrals-browser", "content-retention", "whatsapp-senders", "contact-history", "contact-drafts", "mail-recovery", "mail-preview", "ai-executor", "batch-control", "batch-reservation", "batch-reconciliation"].includes(name)));
try {
  for (const name of contracts) {
    const schema = `qa_consolidation_${name.replaceAll("-", "_")}_${process.pid}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const env = { ...process.env, DATABASE_SCHEMA: schema, MAIL_OUTBOX_DIR: `${process.env.QA_OUTPUT_DIR}/${name}-outbox` };
    if (["batch-reservation", "batch-reconciliation"].includes(name)) Object.assign(env, { APPROVER_EMAIL: "qa-president@example.test", RECIPIENTS: "qa-authority@example.test", SIGNER: "none" });
    const log = createWriteStream(`${env.QA_OUTPUT_DIR}/${name}-server.log`);
    const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3033"], { env });
    server.stdout.pipe(log); server.stderr.pipe(log);
    const stopped = once(server, "exit");
    try {
      let ready = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        if (server.exitCode !== null) throw new Error("QA server exited before readiness");
        try { ready = (await fetch(`${env.QA_BASE_URL}/admin`, { signal: AbortSignal.timeout(5000) })).status === 200; } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.ok(ready, "QA server readiness");
      const child = spawn(process.execPath, ["--import", "tsx", `../tools/admin-qa/${name}.mjs`], { env, stdio: "inherit" });
      const [code] = await once(child, "exit"); assert.equal(code, 0, `${name} contract`);
      console.log(`PASS compiled ${name}`);
    } finally {
      server.kill("SIGTERM");
      const timer = setTimeout(() => server.kill("SIGKILL"), 10000);
      await stopped; clearTimeout(timer); log.end();
      // Only the schema created by this owned run; no pre-existing data is touched.
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  }
} finally { await pool.end(); }
