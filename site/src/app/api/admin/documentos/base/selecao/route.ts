import { NextRequest } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { currentPetitionBaseSelection, selectPetitionBase, getPetitionBaseSelectionRequest } from "@/lib/petition-base-selection";
import { baseReply, baseStatus, readBaseCommand } from "@/lib/petition-base-http";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 120, { stepup: true }); if (denied) return denied;
  const q = req.nextUrl.searchParams; if (q.size && (q.size !== 1 || !q.has("requestId"))) return baseReply({ ok: false, error: "parameters" }, 400);
  try { const actor = await quemAge(req), result = q.has("requestId") ? await getPetitionBaseSelectionRequest(q.get("requestId")!, actor) : await currentPetitionBaseSelection(actor); return baseReply(result, result.ok ? 200 : baseStatus(result.error)); }
  catch { return baseReply({ ok: false, error: "unavailable" }, 503); }
}
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 20, { stepup: true }); if (denied) return denied;
  if (req.nextUrl.searchParams.size) return baseReply({ ok: false, error: "parameters" }, 400);
  const body = await readBaseCommand(req, ["requestId", "expectedRevision", "validationId", "reviewedSha256", "expectedTextVersion"]);
  if (!body.ok) return baseReply({ ok: false, error: "parameters" }, body.status);
  try {
    const result = await selectPetitionBase(body.value as Parameters<typeof selectPetitionBase>[0], await quemAge(req));
    return baseReply(result, result.ok ? result.replayed ? 200 : 201 : baseStatus(result.error));
  } catch { return baseReply({ ok: false, error: "unavailable" }, 503); }
}
