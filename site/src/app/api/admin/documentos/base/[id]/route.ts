import {NextRequest,NextResponse} from "next/server";
import {exigirNivel,quemAge} from "@/lib/admin-api";
import {readStagedPetitionBase} from "@/lib/petition-base-store";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest,{params}:{params:{id:string}}){
 const denied=await exigirNivel(req,"total",60,{stepup:true});if(denied)return denied;
 const actor=await quemAge(req);
 const headers={"cache-control":"private, no-store","x-content-type-options":"nosniff","x-robots-tag":"noindex, nofollow"};
 if(!actor?.userId)return NextResponse.json({ok:false,error:"forbidden"},{status:403,headers});
 if(req.nextUrl.searchParams.size)return NextResponse.json({ok:false,error:"parameters"},{status:400,headers});
 try{
  const result=await readStagedPetitionBase(params.id,actor);
  if(!result.ok)return NextResponse.json(result,{status:result.error==='forbidden'?403:result.error==='not_found'?404:result.error==='parameters'?400:409,headers});
  return new NextResponse(new Uint8Array(result.bytes),{headers:{...headers,"content-type":"application/pdf","content-disposition":`attachment; filename="peticao-base-${result.artifactId}.pdf"`}});
 }catch{return NextResponse.json({ok:false,error:"unavailable"},{status:503,headers});}
}
