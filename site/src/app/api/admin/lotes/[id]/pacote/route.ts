import { NextRequest } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { batchId } from "@/lib/batch-http-input";
import { prepareBatchPackage, getBatchPackageReview } from "@/lib/batch-package-store";
import { baseReply, baseStatus, readBaseCommand } from "@/lib/petition-base-http";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "total", 120, { stepup: true }); if (denied) return denied;
  const id = batchId(params.id); if (id === null || req.nextUrl.searchParams.size) return baseReply({ ok: false, error: "parameters" }, 400);
  try { const result = await getBatchPackageReview(id, await quemAge(req)); return baseReply(result, result.ok ? 200 : baseStatus(result.error)); }
  catch { return baseReply({ ok: false, error: "unavailable" }, 503); }
}
/** Freezes exact attachments for review; never calls approval or transport. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "total", 20, { stepup: true }); if (denied) return denied;
  const id = batchId(params.id); if (id === null || req.nextUrl.searchParams.size) return baseReply({ ok: false, error: "parameters" }, 400);
  const body = await readBaseCommand(req, ["requestId", "expectedDocumentVersion", "expectedSelectionId", "expectedPackageRevision"]);
  if (!body.ok) return baseReply({ ok: false, error: "parameters" }, body.status);
  try {
    const input = body.value as Omit<Parameters<typeof prepareBatchPackage>[0], "batchId">;
    const result = await prepareBatchPackage({ ...input, batchId: id }, await quemAge(req));
    return baseReply(result, result.ok ? result.replayed ? 200 : 201 : baseStatus(result.error));
  } catch { return baseReply({ ok: false, error: "unavailable" }, 503); }
}
