import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSetting, setSetting } from "./batches";

/**
 * Terminal do painel. Roda num serviço SEPARADO e sem privilégios (scripts/terminal-servico.mjs, deploy/22-terminal.sh); o site só pede a execução
 * com um ticket assinado (HMAC, 60 s, uso único, amarrado ao hash do comando). Fica DESLIGADO por padrão: só vale enquanto `terminal_ate` for futuro
 * (ligado na Central de Ações por no máximo 60 minutos). Comandos que precisam de root continuam indo por e-mail para o dono rodar.
 */
export const CHAVE_ATE = "terminal_ate";
export const MAX_MINUTOS = 60;
export const terminalUrl = () => (process.env.TERMINAL_URL ?? "http://127.0.0.1:3911").replace(/\/$/, "");
const segredo = () => process.env.TERMINAL_SECRET ?? "";

export async function terminalAte(): Promise<Date | null> {
  const v = await getSetting(CHAVE_ATE, ""); const d = v ? new Date(v) : null;
  return d && d.getTime() > Date.now() ? d : null;
}
export async function ligarTerminal(minutos: number): Promise<Date> {
  const m = Math.min(MAX_MINUTOS, Math.max(5, Math.round(minutos) || 30)), ate = new Date(Date.now() + m * 60_000);
  await setSetting(CHAVE_ATE, ate.toISOString()); return ate;
}
export const desligarTerminal = () => setSetting(CHAVE_ATE, "");

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
export const comandoValido = (c: unknown): c is string => typeof c === "string" && c.trim().length > 0 && c.length <= 2000 && !c.includes("\0");

/** Ticket de uma execução: `payload.assinatura`, igual ao que conferirTicket (scripts/terminal-servico.mjs) confere. */
export function emitirTicket(usuario: string, comando: string, chave = segredo(), agora = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: usuario, exp: agora + 60_000, n: randomBytes(12).toString("hex"), h: sha256hex(comando) })).toString("base64url");
  return `${payload}.${createHmac("sha256", chave).update(payload).digest("hex")}`;
}
export const terminalConfigurado = () => segredo().length >= 32;

/** Pede a execução ao serviço e devolve a resposta em fluxo (texto). */
export async function executarNoTerminal(usuario: string, comando: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return fetchImpl(`${terminalUrl()}/executar`, { method: "POST", headers: { "content-type": "application/json", "x-ticket": emitirTicket(usuario, comando) }, body: JSON.stringify({ comando }), signal: AbortSignal.timeout(90_000) });
}
