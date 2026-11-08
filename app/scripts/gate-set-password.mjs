// Cadastra a senha de acesso da pré-visualização. A senha NÃO é guardada: só um hash scrypt com sal aleatório
// (não dá para "descriptografar"; só conferir). Trocar a senha também gera um novo segredo de cookie, o que
// derruba as sessões abertas. Uso: npm run preview:senha   (a senha é digitada sem aparecer na tela)
// Sem tamanho mínimo e sem regra de formato: qualquer texto serve (só letras, números, espaços, símbolos, emojis…).
import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { askHidden, closePrompt } from "./lib-prompt.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const stateDir = process.env.PREVIEW_STATE ?? join(root, "preview-state");
const gateDir = join(stateDir, "gate");

async function readStdin() {
  const chunks = []; for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

let password;
if (process.argv.includes("--stdin")) password = await readStdin(); // para automação/testes
else {
  if (!process.stdin.isTTY) { console.error("Rode num terminal interativo (ou use --stdin)."); process.exit(1); }
  password = await askHidden("Nova senha da pré-visualização (qualquer formato, sem mínimo): ");
  const again = await askHidden("Repita a senha: ");
  closePrompt();
  if (password !== again) { console.error("As senhas não conferem."); process.exit(1); }
}
if (password.length === 0) { console.error("Senha vazia: nada foi gravado."); process.exit(1); }

const N = 32768, r = 8, p = 1, salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 });
mkdirSync(gateDir, { recursive: true, mode: 0o700 });
writeFileSync(join(gateDir, "password.scrypt"), `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}\n`, { mode: 0o600 });
writeFileSync(join(gateDir, "cookie.secret"), randomBytes(32).toString("base64url") + "\n", { mode: 0o600 });
chmodSync(join(gateDir, "password.scrypt"), 0o600); chmodSync(join(gateDir, "cookie.secret"), 0o600);
console.log(`Senha registrada (hash scrypt) em ${gateDir}. Sessões anteriores foram invalidadas.`);
