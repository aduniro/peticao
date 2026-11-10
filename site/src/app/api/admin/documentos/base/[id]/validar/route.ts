import { NextRequest } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { beginPetitionBaseValidation, finishPetitionBaseValidation, persistPetitionBaseValidation } from "@/lib/petition-base-validation-store";
import { verifyPetitionBasePdf } from "@/lib/petition-base-validation";
import { baseReply, baseStatus, readBaseCommand } from "@/lib/petition-base-http";

export const dynamic = "force-dynamic";
/** Explicit verifier call only. It neither selects a base nor signs, approves or sends a document. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "total", 10, { stepup: true }); if (denied) return denied;
  if (req.nextUrl.searchParams.size) return baseReply({ ok: false, error: "parameters" }, 400);
  const body = await readBaseCommand(req, ["expectedSha256"]); if (!body.ok) return baseReply({ ok: false, error: "parameters" }, body.status);
  if (typeof body.value.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.value.expectedSha256)) return baseReply({ ok: false, error: "parameters" }, 400);
  try {
    const actor = await quemAge(req), captured = await beginPetitionBaseValidation(params.id, body.value.expectedSha256 as string, actor);
    if (!captured.ok) return baseReply(captured, baseStatus(captured.error));
    let verified;
    try { verified = await verifyPetitionBasePdf(captured.bytes, captured.binding); }
    catch { await finishPetitionBaseValidation(captured.attemptId, { state: "unavailable" }, actor); return baseReply({ ok: false, error: "unavailable" }, 503); }
    if (!verified.ok) {
      await finishPetitionBaseValidation(captured.attemptId, { state: verified.error === "base_validation_rejected" ? "rejected" : "unavailable" }, actor);
      return baseReply({ ok: false, error: "validation_unavailable" }, 409);
    }
    const saved = await persistPetitionBaseValidation({ binding: captured.binding, proof: verified.proof }, actor);
    if (saved.ok) {
      const finished = await finishPetitionBaseValidation(captured.attemptId, { state: "valid", validationId: saved.validationId }, actor);
      if (!finished.ok) return baseReply(finished, baseStatus(finished.error));
      if (!finished.isCurrent) return baseReply({ ok: false, error: "validation_unavailable" }, 409);
    }
    return baseReply(saved, saved.ok ? saved.replayed ? 200 : 201 : baseStatus(saved.error));
  } catch { return baseReply({ ok: false, error: "unavailable" }, 503); }
}
