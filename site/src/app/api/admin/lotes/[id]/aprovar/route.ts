import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { approveAndSend } from "@/lib/batches";
import { batchResultSummary, BATCH_REVIEW_MESSAGE } from "@/lib/batch-result-summary";
import { batchId, readBatchFields } from "@/lib/batch-http-input";
import { config } from "@/lib/config";
import { batchReturnUrl, returnsToPresident } from "@/lib/batch-return";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return new NextResponse(null, { status: 400 });
  const body = await readBatchFields(req); if (!body.ok) return new NextResponse(null, { status: body.status });
  const form = body.form; if (form.getAll("code").length > 1) return new NextResponse(null, { status: 400 });
  const url = batchReturnUrl(req, id);
  try {
    const r = await approveAndSend(id, String(form.get("code") ?? ""), config.approverEmail(), actor);
    url.searchParams.set("msg", batchResultSummary(r));
  } catch (error) {
    if (!returnsToPresident(req)) throw error;
    url.searchParams.set("msg", BATCH_REVIEW_MESSAGE);
  }
  return NextResponse.redirect(url, 303);
}
