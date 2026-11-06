import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Segredo exclusivo do cache: não altera o pepper nem a criptografia de outros recursos. */
function key(): Buffer {
  const raw = process.env.CPF_CACHE_ENCRYPTION_KEY?.trim();
  if (raw && raw.length >= 32) return createHash("sha256").update(raw).digest();
  if (process.env.NODE_ENV === "production") throw new Error("CPF_CACHE_ENCRYPTION_KEY ausente ou curta");
  return createHash("sha256").update("cpf-cache-somente-testes-locais").digest();
}

export function encryptCpfCache(plain: string, context: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptCpfCache(value: string, context: string): string | null {
  try {
    const [version, iv, tag, data] = value.split(".");
    if (version !== "v1") return null;
    const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8");
  } catch { return null; }
}
