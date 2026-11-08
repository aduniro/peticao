import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Pasta de segredos (fora do código). Os arquivos são gravados pelos comandos `npm run chave:*`, nunca por script de IA. */
export const secretsDir = () => process.env.SECRETS_DIR ?? join(process.cwd(), "..", "secrets");

/** Lê um segredo: variável de ambiente primeiro; senão o arquivo `<SECRETS_DIR>/<arquivo>`. Nunca registra o valor. */
export function readSecret(envName: string, fileName: string): string | null {
  const env = process.env[envName]?.trim();
  if (env) return env;
  const f = join(secretsDir(), fileName);
  try {
    if (existsSync(f)) return readFileSync(f, "utf8").trim() || null;
  } catch { /* sem permissão: tratado como ausente */ }
  return null;
}
