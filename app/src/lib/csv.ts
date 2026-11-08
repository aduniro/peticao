/** Célula CSV segura: aspas escapadas e proteção contra injeção de fórmula em planilhas (=, +, -, @). */
export function esc(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
