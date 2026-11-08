import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { changeBatchSending } from "@/lib/batch-sending-control";
import { readLimitedText } from "@/lib/http-body";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Explicit, versioned pause/resume; never a blind toggle after a lost response. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 120, { stepup: true });
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const body = await readLimitedText(req, 1024);
  if (!body.ok) return new NextResponse(null, { status: body.status });
  const form = new URLSearchParams(body.raw), value = form.get("enabled");
  if (form.size !== 2 || form.getAll("enabled").length !== 1 || form.getAll("version").length !== 1 || !["true", "false"].includes(value ?? "")) return new NextResponse(null, { status: 400 });
  let result;
  try { result = await changeBatchSending(value === "true", form.get("version"), actor); }
  catch { return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
  if (!result.ok) return new NextResponse(null, { status: result.error === "parameters" ? 400 : result.error === "forbidden" ? 403 : 409 });
  const url = new URL("/admin/lotes", requestOrigin(req.headers));
  url.searchParams.set("msg", result.enabled ? "Envios retomados." : "Envios PAUSADOS.");
  return NextResponse.redirect(url, 303);
}
