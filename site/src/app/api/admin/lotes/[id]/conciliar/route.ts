import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { inspectBatchAcceptance, reconcileBatchAcceptance } from "@/lib/batch-reconciliation";
import { readLimitedText } from "@/lib/http-body";
import { batchId } from "@/lib/batch-http-input";
import { batchReturnUrl, returnsToPresident } from "@/lib/batch-return";

export const dynamic = "force-dynamic";
const reply = (result: { ok: boolean; error?: string }) => NextResponse.json(result, { status: result.ok ? 200 : result.error === "parameters" ? 400 : result.error === "forbidden" ? 403 : 409, headers: { "cache-control": "no-store" } });
function portalReply(req: NextRequest, id: number, result: { ok: boolean; error?: string; complete?: boolean }) {
  if (!returnsToPresident(req) || result.error === "forbidden" || result.error === "parameters") return reply(result);
  const url = batchReturnUrl(req, id);
  url.searchParams.set("msg", result.ok ? result.complete ? "Aceites conferidos. Nenhum envio foi repetido." : "Comprovantes conferidos. Ainda há resultados pendentes." : "Não foi possível concluir a conferência. Atualize o documento e verifique o histórico.");
  const response = NextResponse.redirect(url, 303); response.headers.set("cache-control", "no-store"); return response;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = await exigirNivel(req, "total", 120, { stepup: true }); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return reply({ ok: false, error: "parameters" });
  try { return reply(await inspectBatchAcceptance(id, actor)); }
  catch { return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = await exigirNivel(req, "total", 120, { stepup: true }); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return reply({ ok: false, error: "parameters" });
  const body = await readLimitedText(req, 1024); if (!body.ok) return new NextResponse(null, { status: body.status });
  let input;
  try {
    if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams(body.raw);
      if (form.size !== 1 || form.getAll("proof").length !== 1) return reply({ ok: false, error: "parameters" });
      input = { proof: form.get("proof") };
    } else input = JSON.parse(body.raw);
  } catch { return NextResponse.json({ ok: false, error: "parameters" }, { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || !("proof" in input)) return NextResponse.json({ ok: false, error: "parameters" }, { status: 400 });
  try { return portalReply(req, id, await reconcileBatchAcceptance(id, input.proof, actor)); }
  catch {
    if (returnsToPresident(req)) return portalReply(req, id, { ok: false, error: "unavailable" });
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
