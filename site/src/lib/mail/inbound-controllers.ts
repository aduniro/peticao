import { NextRequest, NextResponse } from "next/server";
import { quemAge } from "../admin-api";
import { PREVIEW_CSP } from "./preview-render";
import { listInboundThreads, listInboundThreadMessages, previewInboundMessage, downloadInboundAttachment } from "./inbound-queries";
const headers={"cache-control":"private, no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
function parameters(req:NextRequest) {
  const account=req.nextUrl.searchParams.get("account")??"",raw=req.nextUrl.searchParams.get("limit");
  if(raw!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw))return null;
  if(["account","limit","cursor"].some(k=>req.nextUrl.searchParams.getAll(k).length>1))return null;
  return {account,limit:raw===null?20:Number(raw),cursor:req.nextUrl.searchParams.get("cursor")??undefined};
}
function reply(r:{ok:boolean;error?:string;state?:string}) {
  return NextResponse.json(r,{status:!r.ok?r.error==="forbidden"?403:r.error==="input"?400:404:r.state==="expired"?410:r.state==="unavailable"?409:200,headers});
}
export async function inboundListController(req:NextRequest,threadRoot?:string) {
  const actor=await quemAge(req);if(!actor)return NextResponse.json({ok:false},{status:401,headers});
  const input=parameters(req);if(!input)return new NextResponse(null,{status:400,headers});
  try{return reply(threadRoot===undefined?await listInboundThreads(input,actor):await listInboundThreadMessages({...input,threadRoot},actor));}
  catch{return NextResponse.json({ok:false,error:"unavailable"},{status:503,headers});}
}
export async function inboundContentController(req:NextRequest,id:string,index?:string) {
  const actor=await quemAge(req);if(!actor)return NextResponse.json({ok:false},{status:401,headers});
  if(index!==undefined&&!/^[0-3]$/.test(index))return new NextResponse(null,{status:400,headers});
  try{
    if(index!==undefined){const r=await downloadInboundAttachment(id,Number(index),actor);if(r.ok&&r.state==="attachment")return new NextResponse(new Uint8Array(r.bytes),{headers:{...headers,"content-type":"application/octet-stream","content-disposition":`attachment; filename="anexo-${r.index+1}.bin"`}});return reply(r);}
    const r=await previewInboundMessage(id,actor);
    return NextResponse.json(r,{status:!r.ok?r.error==="forbidden"?403:r.error==="input"?400:404:r.state==="expired"?410:r.state==="unavailable"?409:200,headers:{...headers,"content-security-policy":PREVIEW_CSP}});
  }catch{return NextResponse.json({ok:false,error:"unavailable"},{status:503,headers});}
}
