import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { localDatabaseUrl } from "./local-database.mjs";
const require = createRequire(new URL("../../site/package.json", import.meta.url));
const { Client } = require("pg");
const base = process.env.ADMIN_MIRROR_STATE ?? join(homedir(), ".local/share/peticao-admin-mirror");
const cfg = JSON.parse(readFileSync(join(base, "local-config.json"), "utf8"));
const client = new Client({ connectionString: localDatabaseUrl(cfg) });
try {
  await client.connect();
  const names = (await client.query("SELECT nspname FROM pg_namespace WHERE nspname ~ '^admin_mirror_old_[a-f0-9]{16}$' ORDER BY oid DESC")).rows.slice(2);
  for (const { nspname } of names) {
    if (!/^admin_mirror_old_[a-f0-9]{16}$/.test(nspname)) throw new Error("MIRROR_CLEANUP_SCHEMA");
    try {
      await client.query("BEGIN; SET LOCAL lock_timeout='300ms'; SET LOCAL statement_timeout='3000ms'");
      await client.query(`DROP SCHEMA "${nspname}" CASCADE`);
      await client.query("COMMIT");
    } catch { await client.query("ROLLBACK").catch(() => {}); }
  }
  const current = JSON.parse(readFileSync(join(base, "current-capture.json"), "utf8")).directory;
  const dirs = readdirSync(base).filter(name => /^capture-[a-f0-9-]{36}$/.test(name))
    .map(name => ({ name, stat: statSync(join(base, name)) })).filter(item => item.stat.isDirectory())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const keep = new Set([current, ...dirs.slice(0, 3).map(d => d.name)]);
  for (const { name, stat } of dirs) if (!keep.has(name) && Date.now() - stat.mtimeMs > 3600_000) rmSync(join(base, name), { recursive: true });
  console.log(JSON.stringify({ cleanup: "checked", retainedRetiredSchemas: 2 }));
} catch { console.error("MIRROR_CLEANUP_DEFERRED"); process.exitCode = 1; }
finally { await client.end().catch(() => {}); }
