import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Senhas do painel: hash scrypt no formato `scrypt$N$r$p$sal$hash` (o mesmo do arquivo de senha única, deploy/13-senha-admin.sh).
 * Funções puras, sem banco, usadas pelo login por usuário (lib/admin-users.ts) e pela senha única legada (lib/admin.ts).
 */
const N = 16384, R = 8, P = 1, TAM = 32;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const h = scryptSync(senha, sal, TAM, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${sal.toString("hex")}$${h.toString("hex")}`;
}

export function verificarHash(senha: string, guardado: string): boolean {
  const [, n, r, p, sal, hash] = guardado.split("$");
  try {
    const esperado = Buffer.from(hash, "hex");
    const obtido = scryptSync(senha, Buffer.from(sal, "hex"), esperado.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
    return esperado.length > 0 && timingSafeEqual(obtido, esperado);
  } catch { return false; }
}

/** Hash de mentira, para gastar o mesmo tempo quando o e-mail não existe (não revela quais e-mails têm conta). */
export const HASH_FALSO = hashSenha("senha-que-nunca-sera-usada-" + randomBytes(8).toString("hex"));

const MUITO_COMUNS = new Set(["123456789012", "senha1234567", "password1234", "qwertyuiop12", "administrador", "adminadmin123", "sancionaintegral"]);
/** Regras mínimas: 12 a 200 caracteres, não repetida, não igual ao e-mail, não muito comum. Devolve a mensagem do problema, ou null se serve. */
export function problemaNaSenha(senha: string, email = ""): string | null {
  if (senha.length < 12) return "A senha precisa ter pelo menos 12 caracteres.";
  if (senha.length > 200) return "A senha é longa demais (máximo 200 caracteres).";
  if (new Set(senha).size < 5) return "A senha tem caracteres repetidos demais.";
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && senha.toLowerCase().includes(local)) return "A senha não pode conter o seu e-mail.";
  if (MUITO_COMUNS.has(senha.toLowerCase())) return "Essa senha é comum demais. Escolha outra.";
  return null;
}

/** Senha forte e legível (sem 0/O/1/l/I), 16 caracteres, para o primeiro acesso de um usuário novo. */
export function gerarSenha(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 16 }, () => A[randomInt(A.length)]).join("");
}
