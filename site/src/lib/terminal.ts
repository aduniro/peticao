import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { query } from "./db";
import type { PoolClient } from "pg";
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
export async function ligarTerminal(minutos: number, client?: PoolClient): Promise<Date> {
  const m = Math.min(MAX_MINUTOS, Math.max(5, Math.round(minutos) || 30)), ate = new Date(Date.now() + m * 60_000);
  await query("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [CHAVE_ATE, ate.toISOString()], client); return ate;
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

export class TerminalProtocolUnavailable extends Error {}
export function verifyTerminalResult(frame: Record<string, unknown>, nonce: string, commandHash: string, key: string): boolean {
  if (frame.nonce !== nonce || frame.commandHash !== commandHash || typeof frame.signature !== "string" || !/^[a-f0-9]{64}$/.test(frame.signature)) return false;
  const expected = createHmac("sha256", key).update("terminal-result:" + JSON.stringify([nonce, commandHash, frame.code, frame.signal, frame.timedOut, frame.truncated, frame.spawnError, frame.bytes])).digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(frame.signature));
}
export type TerminalExecution = { response: Response; verify: (frame: Record<string, unknown>) => boolean };

/** Checks protocol before sending any command; final results are signed and bound to this ticket. */
export async function executarNoTerminal(usuario: string, comando: string, fetchImpl: typeof fetch = fetch): Promise<TerminalExecution> {
  const capability = await fetchImpl(`${terminalUrl()}/protocolo`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!capability.ok) { await capability.body?.cancel().catch(() => {}); throw new TerminalProtocolUnavailable(); }
  const protocol = await capability.json().catch(() => null);
  if (protocol?.protocol !== "terminal-ndjson-signed-v1") throw new TerminalProtocolUnavailable();
  const key = segredo(), ticket = emitirTicket(usuario, comando, key);
  const identity = JSON.parse(Buffer.from(ticket.split(".")[0], "base64url").toString("utf8")) as { n: string; h: string };
  const response = await fetchImpl(`${terminalUrl()}/executar`, { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson", "x-ticket": ticket }, body: JSON.stringify({ comando }), signal: AbortSignal.timeout(90_000) });
  return { response, verify: frame => verifyTerminalResult(frame, identity.n, identity.h, key) };
}
