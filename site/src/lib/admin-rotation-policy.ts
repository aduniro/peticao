import type { SessaoAdmin } from "./admin-users";

export const ADMIN_TROCA_SENHA_URL = "/admin/conta";
export const ADMIN_TROCA_SENHA_RESPOSTA = Object.freeze({
  ok: false,
  erro: "troca_senha_obrigatoria",
  mensagem: "Para continuar no painel, troque a sua senha em Minha conta.",
  contaUrl: ADMIN_TROCA_SENHA_URL,
});

/** Only the authenticated server session supplies these flags. */
export function precisaTrocarSenhaAdmin(
  session: Pick<SessaoAdmin, "legado" | "preview" | "trocarSenha"> | null | undefined,
): boolean {
  return !!session && !session.legado && !session.preview && session.trocarSenha === true;
}

const RECUPERACAO = new Set([
  "POST /api/admin/conta",
  "POST /api/admin/sair",
  "POST /api/admin/login",
  "POST /api/admin/esqueci",
  "POST /api/admin/redefinir",
]);

/** Exact server-owned routes; body, query flags and caller-supplied headers grant no exception. */
export const acaoPermitidaDuranteTrocaSenha = (method: string, pathname: string): boolean =>
  RECUPERACAO.has(`${method} ${pathname}`);
