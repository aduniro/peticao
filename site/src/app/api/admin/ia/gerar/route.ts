import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { exactKeys } from "@/lib/ai/configuration";
import { aiRequestStatus, generateAiDraft } from "@/lib/ai/executor";
import { rateLimit } from "@/lib/ratelimit";
export const dynamic = "force-dynamic";
const reply = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { "cache-control": "no-store" } });
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao"); if (denied) return denied;
  const q = req.nextUrl.searchParams, id = q.get("requestId");
  if (q.size !== 1 || !id) return reply({ ok: false, error: "parameters" }, 400);
  const actor = await quemAge(req); if (!actor) return reply({ ok: false, error: "forbidden" }, 403);
  try { const r = await aiRequestStatus(id, actor); return reply(r, r.ok ? 200 : r.error === "parameters" ? 400 : r.error === "forbidden" ? 403 : 404); } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao", 60); if (denied) return denied;
  const body = await readLimitedText(req, 4096); if (!body.ok) return reply({ ok: false, error: "parameters" }, body.status);
  let b: any; try { b = JSON.parse(body.raw); } catch { return reply({ ok: false, error: "parameters" }, 400); }
  if (!exactKeys(b, ["input", "proof", "requestId"])) return reply({ ok: false, error: "parameters" }, 400);
  const actor = await quemAge(req); if (!actor) return reply({ ok: false, error: "forbidden" }, 403);
  if (!rateLimit(`admin-ai-generation:${actor.userId}`, 10, 60000)) return reply({ ok: false, error: "rate_limited" }, 429);
  try { const r = await generateAiDraft(b.input, b.proof, b.requestId, actor); return reply(r, r.ok ? 200 : r.error === "parameters" ? 400 : r.error === "forbidden" ? 403 : r.error === "budget_exhausted" ? 429 : 409); } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
