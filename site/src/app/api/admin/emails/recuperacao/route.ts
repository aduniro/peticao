import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { mailRecoveryStatus, listMailRecovery, settleAcceptedQueue } from "@/lib/mail/recovery";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});
const id=(raw:string|null)=>raw&&/^[1-9]\d{0,9}$/.test(raw)&&Number(raw)<=2147483647?Number(raw):undefined;
export async function GET(req:NextRequest) {
  const denied=await exigirNivel(req,"total",60,{stepup:true});if(denied)return denied;
  const q=req.nextUrl.searchParams;
  if(q.has("id")){
    if(q.size!==1||q.getAll("id").length!==1||id(q.get("id"))===undefined)return reply({ok:false,error:"parameters"},400);
    const result=await mailRecoveryStatus(id(q.get("id")));return reply(result,result.ok?200:404);
  }
  if([...q.keys()].some(k=>!["before","limit"].includes(k)||q.getAll(k).length!==1)||q.has("before")&&id(q.get("before"))===undefined||q.has("limit")&&!/^[1-9]\d?$/.test(q.get("limit")!))return reply({ok:false,error:"parameters"},400);
  const result=await listMailRecovery({before:q.has("before")?id(q.get("before")):undefined,limit:q.has("limit")?Number(q.get("limit")):undefined});
  return reply(result,result.ok?200:400);
}
export async function POST(req:NextRequest) {
  const denied=await exigirNivel(req,"total",30,{stepup:true});if(denied)return denied;
  const actor=await quemAge(req);if(!actor?.userId)return reply({ok:false,error:"account_required"},403);
  const raw=await req.text();if(raw.length>256)return reply({ok:false,error:"parameters"},400);
  let b:any;try{b=JSON.parse(raw);}catch{return reply({ok:false,error:"parameters"},400);}
  if(!b||Array.isArray(b)||typeof b!=="object"||Object.keys(b).length!==1||!("id" in b)||!Number.isInteger(b.id))return reply({ok:false,error:"parameters"},400);
  try {
    const result=await settleAcceptedQueue(b.id,{userId:actor.userId,email:actor.email});
    return reply(result,result.ok?200:result.error==="parameters"?400:result.error==="not_found"?404:result.error==="forbidden"?403:409);
  }catch{return reply({ok:false,error:"unavailable"},503);}
}
