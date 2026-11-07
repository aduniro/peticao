// Postgres embutido para DESENVOLVIMENTO. Dados persistentes em site/.pgdata (precisa de um sistema de
// arquivos POSIX, como ext4: o Postgres exige permissão 0700). Em produção use um Postgres de verdade (DATABASE_URL).
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";

export const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const DIR = process.env.DEV_DB_DIR ?? fileURLToPath(new URL("../.pgdata", import.meta.url));

export const isUp = (port = PORT) =>
  new Promise((res) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => { s.destroy(); res(true); });
    s.on("error", () => res(false));
  });

export async function startDevDb() {
  if (await isUp()) return null;
  const pg = new EmbeddedPostgres({ databaseDir: DIR, user: "peticao", password: "peticao", port: PORT, persistent: true,
    onLog: () => {}, onError: () => {} });
  if (!existsSync(`${DIR}/PG_VERSION`)) await pg.initialise();
  await pg.start();
  try { await pg.createDatabase("peticao"); } catch { /* já existe */ }
  return pg;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pg = await startDevDb();
  console.log(pg ? `Postgres de desenvolvimento no ar: postgres://peticao:peticao@localhost:${PORT}/peticao` : "Postgres já estava no ar.");
  const stop = async () => { try { await pg?.stop(); } finally { process.exit(0); } };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  setInterval(() => {}, 1 << 30);
}
