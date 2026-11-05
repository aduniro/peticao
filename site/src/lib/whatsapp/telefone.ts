import { DDI_SET } from "./ddi";

export type Telefone = { ok: true; e164: string; ddi: string; nacional: string } | { ok: false; code: "wa_ddi_invalid" | "wa_number_invalid" | "wa_br_mobile" };
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** DDI + número nacional → E.164 (só dígitos, com DDI). Brasil: celular com 9 (11 dígitos). Zero de tronco é descartado. */
export function normalizarTelefone(ddiRaw: unknown, numeroRaw: unknown): Telefone {
  let ddi = dig(ddiRaw).replace(/^0+/, "");
  if (!DDI_SET.has(ddi)) return { ok: false, code: "wa_ddi_invalid" };
  let nac = dig(numeroRaw);
  if (nac.startsWith(ddi) && nac.length > 11 && ddi !== "1") nac = nac.slice(ddi.length); // colou o número já com DDI
  nac = nac.replace(/^0+/, "");
  if (ddi === "55") {
    if (nac.length !== 11) return { ok: false, code: nac.length === 10 ? "wa_br_mobile" : "wa_number_invalid" };
    if (nac[2] !== "9" || nac[0] === "0" || nac[1] === "0") return { ok: false, code: "wa_br_mobile" };
  }
  if (ddi === "1" && nac.length !== 10) return { ok: false, code: "wa_number_invalid" };
  const total = ddi.length + nac.length;
  if (nac.length < 6 || total < 8 || total > 15) return { ok: false, code: "wa_number_invalid" };
  return { ok: true, e164: ddi + nac, ddi, nacional: nac };
}

/** Exibição para o painel: +55 69 99999-0000 (Brasil) ou +DDI número. */
export function formatarTelefone(e164: string): string {
  if (e164.startsWith("55") && e164.length === 13) return `+55 ${e164.slice(2, 4)} ${e164.slice(4, 9)}-${e164.slice(9)}`;
  return "+" + e164;
}
export const mascararTelefone = (e164: string) => (e164.length > 4 ? "+" + e164.slice(0, 2) + "•".repeat(Math.max(0, e164.length - 6)) + e164.slice(-4) : "•••");
