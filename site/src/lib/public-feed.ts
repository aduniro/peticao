import { query } from "./db";

/** "maria josé DA silva" → "Maria": só o primeiro nome, nunca sobrenome. */
export function firstName(full: string, locale = "pt-BR"): string {
  const t = full.trim().split(/\s+/).filter(Boolean)[0];
  if (!t) return "";
  return (t.charAt(0).toLocaleUpperCase(locale) + t.slice(1).toLocaleLowerCase(locale)).slice(0, 18);
}

/** Linha pública: bandeira (country, minúsculo), primeiro nome e o rótulo (sigla da IFES para servidores; o texto "Apoiador…"/"… Universidade Estrangeira" vem traduzido no navegador). */
export type FeedItem = { id: number; who: string; kind: "servidor" | "apoiador" | "estrangeiro"; flag: string; ifes: string | null; at: string };

export async function recentSignatures(n = 8): Promise<FeedItem[]> {
  const { rows } = await query<{ id: number; name: string; category: FeedItem["kind"]; country: string | null; ifes_acronym: string | null; confirmed_at: string }>(
    "SELECT id,name,category,country,ifes_acronym,confirmed_at FROM signatures WHERE status='confirmed' ORDER BY confirmed_at DESC, id DESC LIMIT $1", [Math.min(Math.max(n, 1), 20)]);
  return rows.map((r) => ({
    id: r.id, who: firstName(r.name) || "—", kind: r.category,
    flag: r.category === "estrangeiro" && r.country ? r.country.toLowerCase() : "br",
    ifes: r.category === "servidor" ? (r.ifes_acronym ?? null) : null, at: r.confirmed_at,
  }));
}
