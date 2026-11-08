/** Datas de nascimento (sem dependências de Node: usado no navegador e no servidor). */
export type Birth = { d: number; m: number; y: number; text: string };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function build(d: number, m: number, y: number, minYear: number): Birth | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // data inexistente (ex.: 31/02)
  if (y < minYear) return null;
  return { d, m, y, text: `${pad(d)}/${pad(m)}/${pad(y, 4)}` };
}

/** Entrada do usuário: dd/mm/aaaa (ou só os 8 dígitos). Rejeita datas inexistentes, futuras ou antes de `minYear`. */
export function parseBirth(input: string, minYear = 1900, today = new Date()): Birth | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const b = build(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4)), minYear);
  if (!b) return null;
  return new Date(Date.UTC(b.y, b.m - 1, b.d)) > today ? null : b;
}

/** Data do cadastro (dd/mm/aaaa ou aaaa-mm-dd), sem limite de ano mínimo (a base tem datas-padrão como 30/11/1899). */
export function normalizeRegistryBirth(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return build(+m[1], +m[2], +m[3], 0)?.text ?? null;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? build(+m[3], +m[2], +m[1], 0)?.text ?? null : null;
}

/** Máscara de digitação: "01021980" → "01/02/1980". */
export function maskBirth(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
