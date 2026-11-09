import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { listDomainCatalog, manageDomainCatalog } from "@/lib/admin-domain-catalog";

export const dynamic = "force-dynamic";
const response = (result: { ok: boolean; error?: string }) => NextResponse.json(result, { status: result.ok ? 200 : result.error === "forbidden" ? 403 : result.error === "conflict" ? 409 : result.error === "not_found" ? 404 : 400 });

export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao");
  if (denied) return denied;
  const actor = await quemAge(req);
  if (!actor) return new NextResponse(null, { status: 401 });
  const params = req.nextUrl.searchParams;
  const numeric = (key: string) => params.has(key) ? /^[1-9][0-9]{0,9}$/.test(params.get(key)!) ? Number(params.get(key)) : NaN : undefined;
  return response(await listDomainCatalog(actor, { filter: (params.get("filter") ?? "active") as "active", after: params.get("after") ?? undefined, limit: numeric("limit") }));
}

export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao");
  if (denied) return denied;
  const actor = await quemAge(req);
  if (!actor) return new NextResponse(null, { status: 401 });
  // Bounded body, no arbitrary field/cell editor or form compatibility changes.
  const reader = req.body?.getReader();
  if (!reader) return new NextResponse(null, { status: 400 });
  let length = 0, chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 4096) { await reader.cancel(); return new NextResponse(null, { status: 413 }); }
      chunks.push(chunk.value);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["domain", "version", "requestId", "operation", "metadata"].includes(k))) return new NextResponse(null, { status: 400 });
    if (raw.operation === "archive" || raw.operation === "restore") {
      const extra = await exigirNivel(req, "exclusao", 120, { stepup: true });
      if (extra) return extra;
    }
    return response(await manageDomainCatalog(raw as Parameters<typeof manageDomainCatalog>[0], actor));
  } catch (error) {
    if (error instanceof SyntaxError) return new NextResponse(null, { status: 400 });
    throw error;
  } finally { reader.releaseLock(); }
}
