import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { hmac } from "./security";
import { readSecret } from "./secrets";

/**
 * Criptografia de dados sensíveis do painel (AES-256-GCM). Formato: `v1.<iv>.<tag>.<dado>` em base64url.
 * A chave vem de DATA_ENCRYPTION_KEY (ou do arquivo `data-key`), 32 bytes em hex/base64; nunca é gravada no banco.
 * Em desenvolvimento, sem chave, usa uma chave derivada fixa (só para testes locais); em produção sem chave, recusa.
 */
function chave(): Buffer {
  const raw = readSecret("DATA_ENCRYPTION_KEY", "data-key");
  if (raw) return createHash("sha256").update(raw).digest();
  if (process.env.NODE_ENV === "production") throw new Error("DATA_ENCRYPTION_KEY ausente");
  return createHash("sha256").update("chave-somente-desenvolvimento").digest();
}
export const criptografiaConfigurada = () => !!readSecret("DATA_ENCRYPTION_KEY", "data-key");

export function cifrar(texto: string, contexto = ""): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  c.setAAD(Buffer.from(contexto));
  const dado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), dado.toString("base64url")].join(".");
}

export function decifrar(valor: string, contexto = ""): string | null {
  try {
    const [v, iv, tag, dado] = valor.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64url"));
    d.setAAD(Buffer.from(contexto));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(dado, "base64url")), d.final()]).toString("utf8");
  } catch { return null; }
}

/** Impressão digital para buscar/evitar duplicidade sem decifrar (HMAC com o pepper do site). */
export const impressao = (texto: string) => hmac("dados:" + texto);
