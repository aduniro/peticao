import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { exactKeys } from "@/lib/ai/configuration";
import { prepareAiContext, validateAiContext } from "@/lib/ai/context";
import { AI_REQUEST_MAX_BYTES } from "@/lib/ai/limits";
export const dynamic = "force-dynamic";
const reply = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { "cache-control": "no-store" } });
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "leitura", 60); if (denied) return denied;
  const body = await readLimitedText(req, AI_REQUEST_MAX_BYTES); if (!body.ok) return reply({ ok: false, error: "parameters" }, body.status);
  let b: any; try { b = JSON.parse(body.raw); } catch { return reply({ ok: false, error: "parameters" }, 400); }
  if (!b || !["preparar", "conferir"].includes(b.modo) || !exactKeys(b, b.modo === "preparar" ? ["modo", "input"] : ["modo", "input", "proof"])) return reply({ ok: false, error: "parameters" }, 400);
  if (b.input?.uso !== "painel") { const blocked = await exigirNivel(req, "edicao", 60); if (blocked) return blocked; }
  try {
    if (b.modo === "conferir") {
      const r = await validateAiContext(b.input, b.proof);
      return reply(r, r.ok ? 200 : r.error === "parameters" ? 400 : r.error === "not_found" ? 404 : 409);
    }
    const r = await prepareAiContext(b.input);
    // Prompt and transient question stay server-side; the API returns only the reviewable context identity.
    if (r.ok) return reply({ ok: true, purpose: r.purpose, configurationRevision: r.configurationRevision, inputBytes: r.inputBytes, sources: r.sources, proof: r.proof, requiresHumanReview: true, executionAvailable: r.executionAvailable, requestedEnabled: r.requestedEnabled, supportContext: r.supportContext });
    return reply(r, r.ok ? 200 : r.error === "parameters" ? 400 : r.error === "not_found" ? 404 : 409);
  } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
