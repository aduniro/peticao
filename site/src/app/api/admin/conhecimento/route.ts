import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { knowledgeSource, searchKnowledge } from "@/lib/knowledge/search";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "leitura", 60); if (denied) return denied;
  const body = await readLimitedText(req, 2048); if (!body.ok) return reply({ ok: false, error: "parameters" }, body.status);
  let b: any; try { b = JSON.parse(body.raw); } catch { return reply({ ok: false, error: "parameters" }, 400); }
  if (!b || Array.isArray(b) || !["consulta,uso", "consulta,limite,uso", "fonte,uso,versao"].includes(Object.keys(b).sort().join(","))) return reply({ ok: false, error: "parameters" }, 400);
  if (b.uso !== "painel") { const blocked = await exigirNivel(req, "edicao", 60); if (blocked) return blocked; }
  try {
    const r = "fonte" in b ? await knowledgeSource(b.fonte, b.versao, b.uso) : await searchKnowledge(b.consulta, b.uso, b.limite);
    return reply(r, r.ok ? 200 : r.error === "forbidden" ? 403 : r.error === "not_found" ? 404 : r.error === "source_stale" ? 409 : 400);
  } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
