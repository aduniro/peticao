// Uso: node scripts/with-db.mjs <comando> [args...]  — sobe o Postgres de dev (se preciso), roda o comando e encerra.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startDevDb, PORT } from "./dev-db.mjs";

// tsx cria um socket no TMPDIR; /tmp fica no disco raiz (quase cheio), então usamos uma pasta do projeto.
const TMP = process.env.TMPDIR ?? fileURLToPath(new URL("../../.cache/tmp", import.meta.url));
mkdirSync(TMP, { recursive: true });

const pg = await startDevDb();
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, {
  stdio: "inherit",
  env: { ...process.env, TMPDIR: TMP, DATABASE_URL: process.env.DATABASE_URL ?? `postgres://peticao:peticao@localhost:${PORT}/peticao` },
  shell: false,
});
child.on("exit", async (code) => { try { await pg?.stop(); } catch {} process.exit(code ?? 1); });
