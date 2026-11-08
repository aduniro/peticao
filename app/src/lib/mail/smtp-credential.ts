import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SmtpCredential = { user: string; pass: string };

/**
 * Credencial SMTP do SES entregue pelo systemd (LoadCredentialEncrypted=ses-smtp:...).
 * O arquivo fica criptografado em disco; o systemd o decifra só para este serviço e o expõe em $CREDENTIALS_DIRECTORY.
 */
export function readSmtpCredential(dir: string | undefined = process.env.CREDENTIALS_DIRECTORY): SmtpCredential | null {
  if (!dir) return null;
  const file = join(dir, "ses-smtp");
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return typeof j.user === "string" && j.user && typeof j.pass === "string" && j.pass ? { user: j.user, pass: j.pass } : null;
  } catch {
    return null;
  }
}

/** Credencial em texto puro entregue pelo systemd (LoadCredentialEncrypted=nome:...), por exemplo a chave da API do Brevo. */
export function readCredentialText(name: string, dir: string | undefined = process.env.CREDENTIALS_DIRECTORY): string | null {
  if (!dir || !/^[a-z0-9-]+$/.test(name)) return null;
  const file = join(dir, name);
  if (!existsSync(file)) return null;
  try { return readFileSync(file, "utf8").trim() || null; } catch { return null; }
}

export function sesSmtpOptions(c: SmtpCredential, region = process.env.SES_REGION ?? "sa-east-1") {
  return { host: `email-smtp.${region}.amazonaws.com`, port: 465, secure: true, auth: { user: c.user, pass: c.pass } };
}
