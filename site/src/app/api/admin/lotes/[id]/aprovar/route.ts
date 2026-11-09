import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { approveAndSend } from "@/lib/batches";
import { batchResultSummary } from "@/lib/batch-result-summary";
import { batchId, readBatchFields } from "@/lib/batch-http-input";
import { config } from "@/lib/config";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return new NextResponse(null, { status: 400 });
  const body = await readBatchFields(req); if (!body.ok) return new NextResponse(null, { status: body.status });
  const form = body.form; if (form.getAll("code").length > 1) return new NextResponse(null, { status: 400 });
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  const r = await approveAndSend(id, String(form.get("code") ?? ""), config.approverEmail(), actor);
  url.searchParams.set("msg", batchResultSummary(r));
  return NextResponse.redirect(url, 303);
}
