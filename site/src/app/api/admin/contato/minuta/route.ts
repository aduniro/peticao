import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { suggestContactReply, validateReplySuggestion } from "@/lib/contact-triage/suggestion";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});
const status=(r:{ok:boolean;error?:string})=>r.ok?200:r.error==="parameters"?400:r.error==="not_found"?404:409;
export async function GET(req:NextRequest) {
  const denied=await exigirNivel(req,"edicao",30);if(denied)return denied;
  const q=req.nextUrl.searchParams,raw=q.get("contato");
  if(q.size!==1||q.getAll("contato").length!==1||!raw||!/^[1-9]\d{0,9}$/.test(raw))return reply({ok:false,error:"parameters"},400);
  try{const r=await suggestContactReply(Number(raw));return reply(r,status(r));}catch{return reply({ok:false,error:"unavailable"},503);}
}
export async function POST(req:NextRequest) {
  const denied=await exigirNivel(req,"edicao",30);if(denied)return denied;
  const body=await readLimitedText(req,1024);if(!body.ok)return reply({ok:false,error:"parameters"},body.status);
  let b:any;try{b=JSON.parse(body.raw);}catch{return reply({ok:false,error:"parameters"},400);}
  if(!b||Array.isArray(b)||typeof b!=="object"||Object.keys(b).sort().join(",")!=="contato,proof")return reply({ok:false,error:"parameters"},400);
  try{const r=await validateReplySuggestion(b.contato,b.proof);return reply(r,status(r));}catch{return reply({ok:false,error:"unavailable"},503);}
}
