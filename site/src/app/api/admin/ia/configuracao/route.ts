import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { aiConfiguration, exactKeys, saveAiConfiguration } from "@/lib/ai/configuration";
export const dynamic = "force-dynamic";
const reply = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { "cache-control": "no-store" } });
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "total"); if (denied) return denied;
  try { const r = await aiConfiguration(); return reply(r, r.ok ? 200 : 409); } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 30, { stepup: true }); if (denied) return denied;
  const body = await readLimitedText(req, 4096); if (!body.ok) return reply({ ok: false, error: "parameters" }, body.status);
  let b: any; try { b = JSON.parse(body.raw); } catch { return reply({ ok: false, error: "parameters" }, 400); }
  if (!exactKeys(b, ["config", "expectedRevision"])) return reply({ ok: false, error: "parameters" }, 400);
  const actor = await quemAge(req); if (!actor) return reply({ ok: false, error: "forbidden" }, 403);
  try { const r = await saveAiConfiguration(b.config, b.expectedRevision, actor); return reply(r, r.ok ? 200 : r.error === "parameters" ? 400 : r.error === "forbidden" ? 403 : 409); } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
