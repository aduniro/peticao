import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { digest } from "./snapshot.mjs";
import { localDatabaseUrl } from "./local-database.mjs";
const require = createRequire(new URL("../../site/package.json", import.meta.url));
const { Client } = require("pg");

/** Only data already published in the local database can be used as a delta baseline. */
export async function knownTables(base, contract) {
  if (process.env.ADMIN_MIRROR_FORCE_FULL === "1") return {};
  let client;
  try {
    const config = JSON.parse(readFileSync(join(base, "local-config.json"), "utf8"));
    client = new Client({ connectionString: localDatabaseUrl(config) }); await client.connect();
    const state = (await client.query("SELECT contract_hash,tables FROM public.admin_mirror_state WHERE singleton=true")).rows[0];
    if (state?.contract_hash !== digest(contract)) return {};
    return Object.fromEntries(state.tables.filter(t => t.fingerprint && t.sha256).map(t => [t.name, { fingerprint: t.fingerprint, count: t.count, sha256: t.sha256, lastKey: t.lastKey ?? null }]));
  } catch { return {}; }
  finally { await client?.end().catch(() => {}); }
}
