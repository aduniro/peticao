import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { prepareContactGroupPreview } from "@/lib/contact-group-preview";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 60, { stepup: true });
  if (denied) return denied;
  const actor = await quemAge(req);
  if (!actor) return new NextResponse(null, { status: 401 });
  const reader = req.body?.getReader();
  if (!reader) return new NextResponse(null, { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32768) { await reader.cancel(); return new NextResponse(null, { status: 413 }); }
      chunks.push(chunk.value);
    }
    const result = await prepareContactGroupPreview(JSON.parse(Buffer.concat(chunks).toString("utf8")), actor);
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "forbidden" ? 403 : result.error === "conflict" ? 409 : 400, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return new NextResponse(null, { status: 400 });
    throw error;
  } finally { reader.releaseLock(); }
}
