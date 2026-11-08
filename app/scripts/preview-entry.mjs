// Ponto de entrada DENTRO do sandbox: sobe o Postgres embutido (rede só em loopback) e o servidor com senha.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, readFileSync } from "node:fs";

const STATE = process.env.STATE_DIR ?? "/state";
const PGPORT = 54329;
const secret = (n) => readFileSync(`${STATE}/secrets/${n}`, "utf8").trim();
const pgPassword = secret("pg-password");
// Segredos vêm de arquivos (não da linha de comando, que outros processos do computador poderiam ler).
process.env.HASH_PEPPER = secret("pepper");
process.env.ADMIN_PASSWORD = secret("admin-password");
// CPF de teste (fictício) para a janela de identidade, SÓ quando não há chave real gravada na pré-visualização (a chave real sempre tem precedência).
// Com a ponte de saída ativa, as consultas (CPF e domínios) saem por ela; a chave fica FORA do sandbox.
const bridge = existsSync(`${STATE}/run/egress.sock`);
if (bridge) process.env.EGRESS_SOCKET = `${STATE}/run/egress.sock`; // checagem de domínios
const cpfViaBridge = bridge && existsSync(`${STATE}/run/cpf-via-bridge`); // o CPF só vai pela ponte se houver chave real no computador
if (cpfViaBridge) process.env.CPF_VIA_BRIDGE = "1";
if (!cpfViaBridge && existsSync(`${STATE}/cpf-mock.json`)) process.env.CPF_MOCK_DATA = readFileSync(`${STATE}/cpf-mock.json`, "utf8");
// Chaves opcionais gravadas por `npm run chave:cpf -- --preview` (sem elas, a pré-visualização usa dados de teste, sem consultar o serviço).
for (const [file, env] of [["turnstile-secret", "TURNSTILE_SECRET_KEY"]]) {
  if (existsSync(`${STATE}/secrets/${file}`)) process.env[env] = secret(file);
}
const pgDir = `${STATE}/pgdata`;

const pg = new EmbeddedPostgres({
  databaseDir: pgDir, user: "peticao", password: pgPassword, port: PGPORT, persistent: true, authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C.UTF-8"], onLog: () => {}, onError: (e) => console.error("[pg]", String(e).slice(0, 300)),
});
if (!existsSync(`${pgDir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try { await pg.createDatabase("peticao"); } catch { /* já existe */ }
console.log("Postgres no ar (loopback do sandbox)");

process.env.DATABASE_URL = `postgres://peticao:${encodeURIComponent(pgPassword)}@127.0.0.1:${PGPORT}/peticao`;
const stop = async () => { try { await pg.stop(); } finally { process.exit(0); } };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
// parada graciosa pedida de fora do sandbox: `preview.sh stop` cria este arquivo
setInterval(() => { if (existsSync(`${STATE}/run/stop`)) stop(); }, 2000);

await import("../server/preview-server.mjs").then((m) => m.main?.());
