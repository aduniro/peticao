import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { admitA1Job, getA1Availability, getA1JobByRequest } from "@/lib/batch-a1-jobs";
import { a1ValidationReady } from "@/lib/a1-validation";
import { ownUuid } from "@/lib/president-own-document-contract";
import { ownAwareA1Intent } from "@/lib/president-own-a1-contract";
import { batchId } from "@/lib/batch-http-input";
import { readLimitedText } from "@/lib/http-body";

export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const statusFor = (error: string) => error === "forbidden" ? 403 : error === "not_found" ? 404 : error === "parameters" ? 400 : 409;

/** Readiness and last persisted outcome; a read can never sign, approve or send. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "total", 120, { stepup: true }); if (denied) return denied;
  const actor = await quemAge(req), id = batchId(params.id);
  if (!actor?.userId) return reply({ ok: false, error: "forbidden" }, 403);
  if (id === null) return reply({ ok: false, error: "parameters" }, 400);
  const query = req.nextUrl.searchParams;
  if (query.size && (query.size !== 1 || !query.has("requestId") && !query.has("expectedOwnArtifactId"))) return reply({ ok: false, error: "parameters" }, 400);
  try {
    if (query.has("requestId")) {
      const result = await getA1JobByRequest(id, query.get("requestId")!, actor);
      return reply(result, result.ok ? 200 : statusFor(result.error));
    }
    const ownId=query.get("expectedOwnArtifactId");
    if(ownId!==null&&!ownUuid(ownId))return reply({ok:false,error:"parameters"},400);
    const result = await getA1Availability(id, actor,ownId??undefined);
    return reply(result.ok ? { ...result, available: result.available && a1ValidationReady() } : result, result.ok ? 200 : statusFor(result.error));
  } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}

/** Explicit admission only. The authenticated durable runner performs the operation later. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "total", 30, { stepup: true }); if (denied) return denied;
  const actor = await quemAge(req), id = batchId(params.id);
  if (!actor?.userId) return reply({ ok: false, error: "forbidden" }, 403);
  if (id === null || req.nextUrl.searchParams.size) return reply({ ok: false, error: "parameters" }, 400);
  const body = await readLimitedText(req, 2048); if (!body.ok) return reply({ ok: false, error: "parameters" }, body.status);
  let value: unknown;
  try { value = JSON.parse(body.raw); } catch { return reply({ ok: false, error: "parameters" }, 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return reply({ ok: false, error: "parameters" }, 400);
  const input=ownAwareA1Intent({ ...value, batchId:id });
  // Route IDs are authoritative; body must not smuggle its own batchId.
  if (Object.hasOwn(value,"batchId") || !input) return reply({ok:false,error:"parameters"},400);
  if (!a1ValidationReady()) return reply({ ok: false, error: "disabled" }, 409);
  try {
    const result = await admitA1Job(input, actor);
    return reply(result, result.ok ? result.replayed ? 200 : 202 : statusFor(result.error));
  } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
