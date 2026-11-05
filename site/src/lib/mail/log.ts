import { query } from "../db";
import type { Mail } from "./index";

export type Attempt = { provider: string; from: string; ok: boolean; error?: string };

/** Grava cada tentativa de envio (por provedor e por tipo de mensagem). Nunca derruba o envio: se o banco falhar, só registra no log do servidor. */
export function attemptLogger(m: Pick<Mail, "to">, kind: string, channel: "transactional" | "marketing" = "transactional") {
  return (a: Attempt) => {
    query("INSERT INTO mail_log(kind,provider,from_addr,to_addr,status,error,channel) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [kind, a.provider, a.from.slice(0, 200), m.to.toLowerCase().slice(0, 254), a.ok ? "sent" : "failed", a.error ? a.error.slice(0, 300) : null, channel]).catch((e) => console.error("mail_log falhou", String(e).slice(0, 120)));
  };
}

/** Mensagem que foi para a fila de reenvio porque nenhum provedor conseguiu enviar. */
export function logQueued(m: Pick<Mail, "to">, kind: string, error: string) {
  query("INSERT INTO mail_log(kind,provider,to_addr,status,error) VALUES($1,'fila',$2,'queued',$3)", [kind, m.to.toLowerCase().slice(0, 254), error.slice(0, 300)]).catch(() => {});
}
