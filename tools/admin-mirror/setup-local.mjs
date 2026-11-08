import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { localDatabaseUrl } from "./local-database.mjs";
import { createReadIndexes } from "./read-indexes.mjs";
const require = createRequire(new URL("../../site/package.json", import.meta.url));
const { Client } = require("pg");
const base = process.env.ADMIN_MIRROR_STATE ?? join(homedir(), ".local/share/peticao-admin-mirror");
const configuration = JSON.parse(readFileSync(join(base, "local-config.json"), "utf8"));
const connectionString = localDatabaseUrl(configuration);
const source = readFileSync(new URL("../../site/src/lib/db.ts", import.meta.url), "utf8");
const schema = source.match(/const SCHEMA_SQL = `([\s\S]*?)`;/)?.[1];
if (!schema || schema.includes("${")) throw new Error("MIRROR_LOCAL_SCHEMA_REVIEW_REQUIRED");
const client = new Client({ connectionString });
let stage = "connect";
try {
  await client.connect();
  await client.query("BEGIN");
  stage = "schema";
  await client.query(schema); // Initializes only the new local database, never a production connection.
  stage = "bootstrap";
  await client.query(readFileSync(new URL("./bootstrap.sql", import.meta.url), "utf8"));
  stage = "reader-password";
  const sql = (await client.query("SELECT format('ALTER ROLE admin_mirror_reader LOGIN PASSWORD %L',$1::text) AS sql", [configuration.readerPassword])).rows[0].sql;
  await client.query(sql);
  stage = "grants";
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('admin_mirror_access_log','admin_mirror_documents')")).rows;
  for (const { tablename } of tables) {
    if (!/^[a-z][a-z0-9_]+$/.test(tablename)) throw new Error("MIRROR_LOCAL_TABLE_NAME");
    await client.query(`GRANT SELECT ON public."${tablename}" TO admin_mirror_reader`);
  }
  const hasLive = (await client.query("SELECT 1 FROM pg_namespace WHERE nspname='admin_mirror_live'")).rowCount;
  if (hasLive) {
    const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));
    for (const table of catalog) await createReadIndexes(client, "admin_mirror_live", table);
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ localDatabase: "prepared", productionChanged: false }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(JSON.stringify({ error: "MIRROR_LOCAL_SETUP_FAILED", stage, code: error.code, position: error.position })); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
