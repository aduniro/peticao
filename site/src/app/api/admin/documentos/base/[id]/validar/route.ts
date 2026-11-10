import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { capturePetitionBaseValidationInput, persistPetitionBaseValidation } from "@/lib/petition-base-validation-store";
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
    const actor = await quemAge(req), captured = await capturePetitionBaseValidationInput(params.id, actor);
    if (!captured.ok) return baseReply(captured, baseStatus(captured.error));
    if (createHash("sha256").update(captured.bytes).digest("hex") !== body.value.expectedSha256) return baseReply({ ok: false, error: "document_conflict" }, 409);
    const verified = await verifyPetitionBasePdf(captured.bytes, captured.binding);
    if (!verified.ok) return baseReply({ ok: false, error: "validation_unavailable" }, 409);
    const saved = await persistPetitionBaseValidation({ binding: captured.binding, proof: verified.proof }, actor);
    return baseReply(saved, saved.ok ? saved.replayed ? 200 : 201 : baseStatus(saved.error));
  } catch { return baseReply({ ok: false, error: "unavailable" }, 503); }
}
