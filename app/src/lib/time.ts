/** Horário de Brasília (America/Sao_Paulo; o Brasil não tem horário de verão desde 2019: UTC-3 o ano todo). Sem dependências de Node. */
const TZ = "America/Sao_Paulo";
const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** "29/10/2026 14:03:22" no horário de Brasília. Aceita ISO (UTC). Retorna "" se inválida. */
export function brasilia(iso: string | Date | null | undefined, withLabel = false): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}${withLabel ? " (horário de Brasília)" : ""}`;
}

/** "agora", "há 3 min", "há 2 h", "há 5 dias". */
export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}
