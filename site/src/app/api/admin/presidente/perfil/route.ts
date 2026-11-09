import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { configurePresidentProfile, readPresidentProfile } from "@/lib/president-portal-store";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(req: NextRequest) {
  const blocked = await exigirNivel(req,"total",60,{stepup:true}); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ok:false},{status:401,headers});
  try { const r=await readPresidentProfile(actor); return NextResponse.json(r,{status:r.ok?200:403,headers}); }
  catch { return NextResponse.json({ok:false,error:"unavailable"},{status:503,headers}); }
}
export async function POST(req: NextRequest) {
  const blocked = await exigirNivel(req,"total",30,{stepup:true}); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ok:false},{status:401,headers});
  const body=await readLimitedText(req,2048); if (!body.ok) return new NextResponse(null,{status:body.status,headers});
  let input;
  try { input=JSON.parse(body.raw); } catch { return NextResponse.json({ok:false,error:"parameters"},{status:400,headers}); }
  if (!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).some(k=>!["responsibleId","cpf","whatsapp","enabled","expectedRevision"].includes(k))) return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
  try {
    const r=await configurePresidentProfile(actor,input);
    return NextResponse.json(r,{status:r.ok?200:r.error==="parameters"?400:r.error==="forbidden"?403:409,headers});
  } catch { return NextResponse.json({ok:false,error:"unavailable"},{status:503,headers}); }
}
