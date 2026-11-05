import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "./db";
import { norm } from "./geo-data";

/** Base aberta Hipo/university-domains-list (MIT): ~10 mil universidades de 200 países. Carregada no banco na primeira necessidade. */
export async function ensureWorldUniversities(): Promise<number> {
  const have = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM world_universities")).rows[0].n;
  if (have > 0) return have;
  const rows = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "world-universities.json"), "utf8")) as [string, string, string, string, string][];
  for (let i = 0; i < rows.length; i += 2000) {
    const c = rows.slice(i, i + 2000);
    await query(
      "INSERT INTO world_universities(name,country,domain,web,state) SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[])",
      [c.map((r) => r[0]), c.map((r) => r[1]), c.map((r) => r[2]), c.map((r) => r[3]), c.map((r) => r[4])]
    );
  }
  return rows.length;
}

export type UniHit = { name: string; domain: string };

/** Sugestões do campo "Universidade": nomes do país escolhido que contêm o texto (sem acento, sem diferença de caixa). */
export async function searchUniversities(country: string, q: string, limit = 40): Promise<UniHit[]> {
  await ensureWorldUniversities();
  if (!/^[A-Z]{2}$/.test(country)) return [];
  const { rows } = await query<{ name: string; domain: string }>("SELECT name, domain FROM world_universities WHERE country = $1 ORDER BY name", [country]);
  const t = norm(q);
  const seen = new Set<string>();
  const out: UniHit[] = [];
  for (const r of rows) {
    if (seen.has(r.name) || (t && !norm(r.name).includes(t))) continue;
    seen.add(r.name);
    out.push({ name: r.name, domain: r.domain });
    if (out.length >= limit) break;
  }
  return out;
}
