/**
 * Trava de segurança de envio.
 * Regra do projeto: fora de produção NUNCA enviar e-mail de teste para a ADUNIR
 * nem para endereços governamentais reais. Em produção, endereços .gov.br só
 * recebem mensagens pelo fluxo de lote aprovado (não implementado neste módulo).
 */
export const BLOCKED_ALWAYS_OUTSIDE_PROD = ["adunir.andes@gmail.com"];
export const BLOCKED_DOMAIN_SUFFIXES_OUTSIDE_PROD = [".gov.br", ".leg.br", ".jus.br"];

export class MailBlockedError extends Error {}

export function assertSendAllowed(to: string, nodeEnv: string | undefined = process.env.NODE_ENV): void {
  const addr = to.trim().toLowerCase();
  const prod = nodeEnv === "production" && process.env.PREVIEW_MODE !== "1"; // pré-visualização conta como teste
  if (!prod) {
    if (BLOCKED_ALWAYS_OUTSIDE_PROD.includes(addr)) {
      throw new MailBlockedError(`Envio bloqueado fora de produção: ${addr}`);
    }
    if (BLOCKED_DOMAIN_SUFFIXES_OUTSIDE_PROD.some((s) => addr.endsWith(s))) {
      throw new MailBlockedError(`Envio a domínio governamental bloqueado fora de produção: ${addr}`);
    }
  }
}
