import { randomBytes } from "node:crypto";

/** Código de verificação da assinatura: 10 caracteres Crockford base32 (sem I, L, O, U), 50 bits aleatórios. */
const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
export function newVerifyCode(): string {
  let s = "";
  for (const b of randomBytes(10)) s += A[b & 31];
  return s;
}
/** "ABCDE-FGHJK" para exibição. */
export const formatCode = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;
/** Aceita o código com traço, espaço, minúsculas e as trocas comuns (O→0, I/L→1). Devolve null se não for um código válido. */
export function parseCode(raw: string): string | null {
  const c = String(raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return CODE_RE.test(c) ? c : null;
}
