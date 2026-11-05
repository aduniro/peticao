import { query } from "./db";

/** Registro das verificações de e-mail feitas antes do envio (Reacher pelas sondas de cabanos.cc, MX, descartável…), para o painel. Nunca falha o fluxo. */
export function logCheck(via: "reacher" | "mx" | "syntax" | "disposable" | "mailersend", email: string, verdict: string, ms?: number, detail?: string) {
  const at = email.lastIndexOf("@");
  const domain = at > 0 ? email.slice(at + 1).toLowerCase().slice(0, 120) : null;
  query("INSERT INTO email_checks(via,domain,verdict,ms,detail) VALUES($1,$2,$3,$4,$5)", [via, domain, verdict.slice(0, 40), ms ?? null, detail ? detail.slice(0, 160) : null]).catch(() => {});
}
