import { NextRequest } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { currentPetitionBaseSelection, selectPetitionBase } from "@/lib/petition-base-selection";
import { baseReply, baseStatus, readBaseCommand } from "@/lib/petition-base-http";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 120, { stepup: true }); if (denied) return denied;
  if (req.nextUrl.searchParams.size) return baseReply({ ok: false, error: "parameters" }, 400);
  try { const result = await currentPetitionBaseSelection(await quemAge(req)); return baseReply(result, result.ok ? 200 : baseStatus(result.error)); }
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
