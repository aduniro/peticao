import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { requestApprovalCode, type ApprovalCodeIntent } from "@/lib/batches";
import { rateLimit } from "@/lib/ratelimit";
import { batchId, readBatchFields } from "@/lib/batch-http-input";
import { batchReturnUrl } from "@/lib/batch-return";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const id = batchId(params.id); if (id === null) return new NextResponse(null, { status: 400 });
  const body = await readBatchFields(req); if (!body.ok) return new NextResponse(null, { status: body.status });
  const url = batchReturnUrl(req, id);
  const fields = [...body.form.entries()];
  if (fields.some(([k, v]) => !["requestId", "expectedDocumentVersion", "expectedPackageId", "expectedPackageDigest"].includes(k) || typeof v !== "string") || new Set(fields.map(([k]) => k)).size !== fields.length || !body.form.get("requestId")) return new NextResponse(null, { status: 400 });
  const intent = Object.fromEntries(fields) as ApprovalCodeIntent;
  try { await requestApprovalCode(id, actor, intent, () => rateLimit(`codigo:${id}`, 5, 15 * 60_000)); url.searchParams.set("msg", "Código enviado ao aprovador."); }
  catch (e) { url.searchParams.set("msg", (e as Error).message); }
  return NextResponse.redirect(url, 303);
}
