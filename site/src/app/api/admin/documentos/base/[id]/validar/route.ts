import { NextRequest } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { beginPetitionBaseValidation, finishPetitionBaseValidation, persistPetitionBaseValidation, readPetitionBaseValidationIntent } from "@/lib/petition-base-validation-store";
import { verifyPetitionBasePdf } from "@/lib/petition-base-validation";
import { baseReply, baseStatus, readBaseCommand } from "@/lib/petition-base-http";

export const dynamic = "force-dynamic";
/** Explicit verifier call only. It neither selects a base nor signs, approves or sends a document. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "total", 10, { stepup: true }); if (denied) return denied;
  if (req.nextUrl.searchParams.size) return baseReply({ ok: false, error: "parameters" }, 400);
  const body = await readBaseCommand(req, ["expectedSha256", "requestId"]); if (!body.ok) return baseReply({ ok: false, error: "parameters" }, body.status);
  if (typeof body.value.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.value.requestId) || typeof body.value.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.value.expectedSha256)) return baseReply({ ok: false, error: "parameters" }, 400);
  try {
    const actor = await quemAge(req), captured = await beginPetitionBaseValidation(params.id, body.value.expectedSha256 as string, actor, body.value.requestId as string);
    if (!captured.ok) return baseReply(captured, baseStatus(captured.error));
    if (captured.replayed) return baseReply(captured, 200);
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
    const outcome = await readPetitionBaseValidationIntent(body.value.requestId as string, params.id, body.value.expectedSha256 as string, actor);
    return baseReply(outcome, outcome.ok ? saved.ok && !saved.replayed ? 201 : 200 : baseStatus(outcome.error));
  } catch { return baseReply({ ok: false, error: "unavailable" }, 503); }
}

/** Recovery is read-only and cannot invoke the verifier. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "total", 10, { stepup: true }); if (denied) return denied;
  const q = req.nextUrl.searchParams;
  if (Array.from(q.keys()).sort().join(",") !== "expectedSha256,requestId") return baseReply({ ok: false, error: "parameters" }, 400);
  try {
    const outcome = await readPetitionBaseValidationIntent(q.get("requestId") ?? "", params.id, q.get("expectedSha256") ?? "", await quemAge(req));
    return baseReply(outcome, outcome.ok ? 200 : baseStatus(outcome.error));
  } catch { return baseReply({ ok: false, error: "unavailable" }, 503); }
}
