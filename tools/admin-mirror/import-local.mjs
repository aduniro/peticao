import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { publishFiles } from "./files.mjs";
import { localDatabaseUrl } from "./local-database.mjs";
const require = createRequire(new URL("../../site/package.json", import.meta.url));
const { Client } = require("pg");
process.umask(0o077);
const base = process.env.ADMIN_MIRROR_STATE ?? join(homedir(), ".local/share/peticao-admin-mirror");
const configuration = JSON.parse(readFileSync(join(base, "local-config.json"), "utf8"));
const connectionString = localDatabaseUrl(configuration);
const current = JSON.parse(readFileSync(join(base, "current-capture.json"), "utf8"));
if (!/^capture-[a-f0-9-]+$/.test(current.directory)) throw new Error("MIRROR_CAPTURE_PATH");
const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));
const client = new Client({ connectionString });
const started = Date.now();
try {
  await client.connect();
  const result = await publishFiles(client, join(base, current.directory), catalog);
  const state = { phase: "published", revision: result.revision, retiredSchema: result.retiredSchema, syncedAt: new Date().toISOString(), elapsedSeconds: Math.round((Date.now() - started) / 1000) };
  writeFileSync(join(base, "import-status.json"), JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(state));
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : /^MIRROR_[A-Z_]+$/.test(error.message ?? "") ? error.message : "MIRROR_IMPORT_FAILED";
  writeFileSync(join(base, "import-status.json"), JSON.stringify({ phase: "failed", at: new Date().toISOString(), code, stage: error.mirrorStage, table: error.mirrorTable }), { mode: 0o600 });
  console.error("MIRROR_LOCAL_IMPORT_FAILED: previous database retained"); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
