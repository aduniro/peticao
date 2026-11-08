import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { inspectBatchAcceptance, reconcileBatchAcceptance } from "@/lib/batch-reconciliation";
import { readLimitedText } from "@/lib/http-body";

export const dynamic = "force-dynamic";
const reply = (result: { ok: boolean; error?: string }) => NextResponse.json(result, { status: result.ok ? 200 : result.error === "parameters" ? 400 : result.error === "forbidden" ? 403 : 409, headers: { "cache-control": "no-store" } });

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = await exigirNivel(req, "total", 120, { stepup: true }); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  try { return reply(await inspectBatchAcceptance(Number(params.id), actor)); }
  catch { return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = await exigirNivel(req, "total", 120, { stepup: true }); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await readLimitedText(req, 1024); if (!body.ok) return new NextResponse(null, { status: body.status });
  let input;
  try { input = JSON.parse(body.raw); } catch { return NextResponse.json({ ok: false, error: "parameters" }, { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || !("proof" in input)) return NextResponse.json({ ok: false, error: "parameters" }, { status: 400 });
  try { return reply(await reconcileBatchAcceptance(Number(params.id), input.proof, actor)); }
  catch { return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
