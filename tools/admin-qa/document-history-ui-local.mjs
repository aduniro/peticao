import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
assert.equal(process.env.QA_BASE_URL, "http://127.0.0.1:3036");
assert.equal(process.env.DEV_DB_PORT, "54356");
assert.equal(process.env.MAIL_PROVIDER, "dev");
const log = createWriteStream(`${process.env.QA_OUTPUT_DIR}/server.log`);
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3036"], { env: process.env });
server.stdout.pipe(log); server.stderr.pipe(log);
const stopped = once(server, "exit");
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error("QA server exited before readiness");
    try { ready = (await fetch(`${process.env.QA_BASE_URL}/admin`, { signal: AbortSignal.timeout(5000) })).status === 200; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Owned QA server readiness");
  const child = spawn(process.execPath, ["--import", "tsx", "../tools/admin-qa/document-history-ui.mjs"], { env: process.env, stdio: "inherit" });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, "compiled document history UI contract");
} finally {
  server.kill("SIGTERM"); const timer = setTimeout(() => server.kill("SIGKILL"), 10000);
  await stopped; clearTimeout(timer); log.end();
}
