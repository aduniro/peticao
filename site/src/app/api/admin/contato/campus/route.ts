import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { campusReviewHistory, previewCampusReview, recordCampusReview } from "@/lib/contact-triage/campus-review";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const status = (r: { ok: boolean; error?: string }) => r.ok ? 200 : r.error === "parameters" ? 400 : r.error === "forbidden" ? 403 : r.error === "not_found" ? 404 : 409;
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao"); if (denied) return denied;
  const q = req.nextUrl.searchParams, id = q.get("contato");
  if (q.size !== 1 || !id || !/^[1-9]\d{0,9}$/.test(id)) return reply({ ok: false, error: "parameters" }, 400);
  try { const r = await campusReviewHistory(Number(id)); return reply(r, status(r)); } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao", 30); if (denied) return denied;
  const body = await readLimitedText(req, 4096); if (!body.ok) return reply({ ok: false, error: "parameters" }, body.status);
  let b: any; try { b = JSON.parse(body.raw); } catch { return reply({ ok: false, error: "parameters" }, 400); }
  if (!b || Array.isArray(b) || !["preview", "record"].includes(b.modo) || Object.keys(b).sort().join(",") !== (b.modo === "preview" ? "input,modo" : "input,modo,proof")) return reply({ ok: false, error: "parameters" }, 400);
  if (b.modo === "record") { const blocked = await exigirNivel(req, "total", 60, { stepup: true }); if (blocked) return blocked; }
  const actor = await quemAge(req); if (!actor) return reply({ ok: false, error: "forbidden" }, 403);
  try {
    const r = b.modo === "preview" ? await previewCampusReview(b.input, actor) : await recordCampusReview(b.input, b.proof, actor);
    return reply(r, status(r));
  } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
