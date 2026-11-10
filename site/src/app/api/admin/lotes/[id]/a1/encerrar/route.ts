import { NextRequest,NextResponse } from "next/server";
import { exigirNivel,quemAge } from "@/lib/admin-api";
import { closeExpiredA1Job,getExpiredA1Closure,closeExpiredA1Intent } from "@/lib/batch-a1-jobs";
import { batchId } from "@/lib/batch-http-input";
import { readLimitedText } from "@/lib/http-body";
export const dynamic="force-dynamic";
const reply=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
const status=(e:string)=>e==="parameters"?400:e==="forbidden"?403:e==="not_found"?404:409;
export async function POST(req:NextRequest,{params}:{params:{id:string}}){
 const denied=await exigirNivel(req,"total",30,{stepup:true});if(denied)return denied;
 const actor=await quemAge(req),id=batchId(params.id);if(!actor?.userId)return reply({ok:false,error:"forbidden"},403);
 if(id===null||req.nextUrl.searchParams.size)return reply({ok:false,error:"parameters"},400);
 const body=await readLimitedText(req,2048);if(!body.ok)return reply({ok:false,error:"parameters"},body.status);
 let value:unknown;try{value=JSON.parse(body.raw);}catch{return reply({ok:false,error:"parameters"},400);}
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.hasOwn(value,"batchId"))return reply({ok:false,error:"parameters"},400);
 const input=closeExpiredA1Intent({...value,batchId:id});if(!input)return reply({ok:false,error:"parameters"},400);
 try{const r=await closeExpiredA1Job(input,actor);return reply(r,r.ok?200:status(r.error));}catch{return reply({ok:false,error:"unavailable"},503);}
}
export async function GET(req:NextRequest,{params}:{params:{id:string}}){
 const denied=await exigirNivel(req,"total",120,{stepup:true});if(denied)return denied;
 const actor=await quemAge(req),id=batchId(params.id);if(!actor?.userId)return reply({ok:false,error:"forbidden"},403);
 if(id===null||req.nextUrl.searchParams.size!==1||!req.nextUrl.searchParams.has("requestId"))return reply({ok:false,error:"parameters"},400);
 try{const r=await getExpiredA1Closure(id,req.nextUrl.searchParams.get("requestId")!,actor);return reply(r,r.ok?200:status(r.error));}catch{return reply({ok:false,error:"unavailable"},503);}
}
