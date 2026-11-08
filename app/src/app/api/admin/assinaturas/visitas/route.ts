import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-api";
import { monitorPoints, monitorRequestPoints, sinceOf, type Window } from "@/lib/monitor";

export const dynamic = "force-dynamic";
const JANELAS = new Set(["1h", "24h", "7d", "30d", "all"]);

export type PontoVisita = { lat: number; lon: number; local: string; visitas: number; assinaramVisitantes: number; confirmadas: number; pendentes: number; devolvidos: number; bloqueios: number };

/** Camada "Visitas (por IP)": visitantes, confirmadas, aguardando confirmação e e-mails inexistentes/devolvidos, agrupados por local aproximado. */
export async function GET(req: NextRequest) {
  const bloqueio = exigirAdmin(req, 120);
  if (bloqueio) return bloqueio;
  const j = req.nextUrl.searchParams.get("janela") ?? "7d";
  const since = sinceOf((JANELAS.has(j) ? j : "7d") as Window);
  const [v, p] = await Promise.all([monitorPoints(since), monitorRequestPoints(since)]);
  const mapa = new Map<string, PontoVisita>();
  const chave = (lat: number, lon: number) => `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const nome = (c: string | null, r: string | null, p: string | null) => [c, r, p].filter(Boolean).join(", ") || "Local desconhecido";
  const get = (lat: number, lon: number, local: string) => { const k = chave(lat, lon); let x = mapa.get(k); if (!x) { x = { lat, lon, local, visitas: 0, assinaramVisitantes: 0, confirmadas: 0, pendentes: 0, devolvidos: 0, bloqueios: 0 }; mapa.set(k, x); } return x; };
  for (const x of v) { const o = get(x.lat, x.lon, nome(x.city, x.region, x.country)); o.visitas += x.visitors; o.assinaramVisitantes += x.signed; }
  for (const x of p) { const o = get(x.lat, x.lon, nome(x.city, x.region, x.country)); o.confirmadas += x.confirmed; o.pendentes += x.pending; o.devolvidos += x.invalid; o.bloqueios += x.blocked; }
  return NextResponse.json({ ok: true, janela: j, pontos: [...mapa.values()].sort((a, b) => b.visitas - a.visitas).slice(0, 1500) }, { headers: { "cache-control": "no-store" } });
}
