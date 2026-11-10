import { NextRequest,NextResponse } from "next/server";
import {exigirNivel,quemAge} from "@/lib/admin-api";
import {readBatchMultipart,BATCH_PDF_BYTES} from "@/lib/batch-http-input";
import {stagePetitionBase,listStagedPetitionBases,getStagedPetitionBaseRequest} from "@/lib/petition-base-store";
export const dynamic="force-dynamic";
const reply=(value:unknown,status:number)=>NextResponse.json(value,{status,headers:{"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
export async function GET(req:NextRequest){
 const denied=await exigirNivel(req,"total",120,{stepup:true});if(denied)return denied;
 const q=req.nextUrl.searchParams;if(q.size&&(q.size!==1||!q.has('requestId')&&!q.has('cursor')))return reply({ok:false,error:"parameters"},400);
 try{const actor=await quemAge(req),result=q.has('requestId')?await getStagedPetitionBaseRequest(q.get('requestId')!,actor):await listStagedPetitionBases(actor,q.has('cursor')?q.get('cursor')!:undefined);return reply(result,result.ok?200:result.error==='forbidden'?403:result.error==='not_found'?404:result.error==='parameters'?400:409);}catch{return reply({ok:false,error:"unavailable"},503);}
}
export async function POST(req:NextRequest){
 const denied=await exigirNivel(req,"total",10,{stepup:true});if(denied)return denied;
 const actor=await quemAge(req);if(!actor?.userId)return reply({ok:false,error:"forbidden"},403);
 if(process.env.GOVBR_BASE_ENABLED!=="1")return reply({ok:false,error:"disabled"},409);
 if(req.nextUrl.searchParams.size)return reply({ok:false,error:"parameters"},400);
 const body=await readBatchMultipart(req);if(!body.ok)return reply({ok:false,error:"parameters"},body.status);
 const names=Array.from(body.form.keys()).sort();if(names.join(',')!=="file,requestId")return reply({ok:false,error:"parameters"},400);
 const requestId=body.form.get('requestId'),file=body.form.get('file');
 if(typeof requestId!=="string"||!file||typeof file==="string"||file.size<16||file.size>BATCH_PDF_BYTES)return reply({ok:false,error:"parameters"},400);
 try{const result=await stagePetitionBase({requestId,bytes:Buffer.from(await file.arrayBuffer())},actor);return reply(result,result.ok?result.replayed?200:202:result.error==='forbidden'?403:result.error==='parameters'?400:409);}catch{return reply({ok:false,error:"unavailable"},503);}
}
