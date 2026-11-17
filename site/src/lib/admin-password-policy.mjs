/** Shared by the application, password fields and the owner's bootstrap CLI. */
export const ADMIN_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MAX_LENGTH = 200;

const MUITO_COMUNS = new Set(["123456789012", "senha1234567", "password1234", "qwertyuiop12", "administrador", "adminadmin123", "sancionaintegral"]);

/** Retains the existing repetition, e-mail and common-password checks. */
export function problemaNaSenha(senha, email = "") {
  if (senha.length < ADMIN_PASSWORD_MIN_LENGTH) return `A senha precisa ter pelo menos ${ADMIN_PASSWORD_MIN_LENGTH} caracteres.`;
  if (senha.length > ADMIN_PASSWORD_MAX_LENGTH) return `A senha é longa demais (máximo ${ADMIN_PASSWORD_MAX_LENGTH} caracteres).`;
  if (new Set(senha).size < 5) return "A senha tem caracteres repetidos demais.";
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && senha.toLowerCase().includes(local)) return "A senha não pode conter o seu e-mail.";
  if (MUITO_COMUNS.has(senha.toLowerCase())) return "Essa senha é comum demais. Escolha outra.";
  return null;
}
