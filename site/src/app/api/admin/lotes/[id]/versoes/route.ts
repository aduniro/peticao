import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { batchId } from "@/lib/batch-http-input";
import { listDocumentVersions } from "@/lib/batch-document-history";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const headers = { "cache-control": "private, no-store" };
  const blocked = await exigirNivel(req,"total",120,{stepup:true}); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ok:false},{status:401,headers});
  const id = batchId(params.id), cursor = req.nextUrl.searchParams.get("antes");
  const before = cursor === null ? undefined : batchId(cursor);
  if (id === null || before === null) return new NextResponse(null,{status:400,headers});
  try {
    const r = await listDocumentVersions(id,actor,before);
    return NextResponse.json(r,{status:r.ok?200:r.error==="forbidden"?403:400,headers});
  } catch { return NextResponse.json({ok:false,error:"unavailable"},{status:503,headers}); }
}
