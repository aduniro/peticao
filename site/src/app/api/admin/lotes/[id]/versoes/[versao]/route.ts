import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { batchId } from "@/lib/batch-http-input";
import { readDocumentVersion } from "@/lib/batch-document-history";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string; versao: string } }) {
  const headers = { "cache-control": "private, no-store" };
  const blocked = await exigirNivel(req,"total",120,{stepup:true}); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ok:false},{status:401,headers});
  const id = batchId(params.id); if (id === null) return new NextResponse(null,{status:400,headers});
  try {
    const r = await readDocumentVersion(id,params.versao,actor);
    if (!r.ok) return NextResponse.json(r,{status:r.error==="not_found"?404:r.error==="forbidden"?403:400,headers});
    return new NextResponse(new Uint8Array(r.bytes),{headers:{...headers,"content-type":"application/pdf","content-disposition":`attachment; filename="lote-${id}-versao-${r.metadata.ordinal}-${r.metadata.variant}.pdf"`,"x-content-type-options":"nosniff","x-document-sha256":r.metadata.sha256}});
  } catch { return NextResponse.json({ok:false,error:"unavailable"},{status:503,headers}); }
}
