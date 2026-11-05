// Grava um segredo SEM que apareça na tela, no histórico do terminal nem em argumentos de comando.
// Uso: npm run chave:cpf              → chave do cpf-brasil.org para dev/produção  (../secrets/cpf-brasil-api-key)
//      npm run chave:cpf -- --preview → chave para a pré-visualização isolada       (../preview-state/secrets/…)
//      npm run chave:turnstile        → chave secreta do Cloudflare Turnstile       (../secrets/turnstile-secret)
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { askHidden, closePrompt } from "./lib-prompt.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const which = process.argv[2];
const preview = process.argv.includes("--preview");
const TARGETS = { cpf: ["cpf-brasil-api-key", "chave de API do cpf-brasil.org"], turnstile: ["turnstile-secret", "chave SECRETA do Cloudflare Turnstile"] };
const t = TARGETS[which];
if (!t) { console.error(`Uso: node scripts/set-secret.mjs <${Object.keys(TARGETS).join("|")}> [--preview]`); process.exit(1); }
const dir = preview ? join(root, "preview-state", "secrets") : join(root, "secrets");

const value = (await askHidden(`Cole a ${t[1]} (não aparece na tela) e tecle Enter: `)).trim();
closePrompt();
if (!value) { console.error("Nada digitado: nada foi gravado."); process.exit(1); }
if (/\s/.test(value)) { console.error("A chave não pode conter espaços ou quebras de linha. Nada foi gravado."); process.exit(1); }
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
const file = join(dir, t[0]);
writeFileSync(file, value + "\n", { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`Chave gravada (${value.length} caracteres) em ${file}, com permissão 600. Ela não foi exibida.`);
