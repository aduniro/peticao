import { NextRequest,NextResponse } from "next/server";
import { safeEqual } from "@/lib/security";
import { claimJob,completeJob,failJob,heartbeatJob,seedConsolidation } from "@/lib/ncpf-jobs";
import { ncpfEnabled,ncpfQueriesEnabled } from "@/lib/ncpf-store";
import { boundedRequestJson,RequestBodyTooLarge } from "@/lib/bounded-request-body";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest,{params}:{params:{operation:string}}) {
  const key=process.env.NCPF_WORKER_TOKEN ?? '';
  if (key.length<32 || !safeEqual(req.headers.get('authorization') ?? '',`Bearer ${key}`)) return new NextResponse(null,{status:404});
  if(params.operation==='reconcile' && ncpfEnabled()) {await seedConsolidation();return NextResponse.json({ok:true});}
  if (!ncpfQueriesEnabled()) return NextResponse.json({error:'worker_disabled'},{status:503});
  if (Number(req.headers.get('content-length') ?? 0)>24*1024*1024) return new NextResponse(null,{status:413});
  try {
    if (params.operation==='claim') { await seedConsolidation(); return NextResponse.json({job:await claimJob()}); }
    const body=await boundedRequestJson(req,24*1024*1024);
    if (!/^[a-f0-9-]{36}$/.test(body?.id ?? '') || !/^[a-f0-9-]{36}$/.test(body?.leaseToken ?? '')) return new NextResponse(null,{status:400});
    if (params.operation==='heartbeat') return NextResponse.json({ok:await heartbeatJob(body.id,body.leaseToken)});
    if (params.operation==='fail') return NextResponse.json({ok:await failJob(body.id,body.leaseToken,String(body.error))});
    if (params.operation==='complete') {
      if (typeof body.pdfBase64!=='string' || body.pdfBase64.length>23*1024*1024) return new NextResponse(null,{status:413});
      return NextResponse.json(await completeJob(body.id,body.leaseToken,{cpf:body.cpf,documentCpf:body.documentCpf,name:body.name,pdf:Buffer.from(body.pdfBase64,'base64'),fetchedAt:body.fetchedAt,origin:body.origin}));
    }
    return new NextResponse(null,{status:404});
  } catch (error) {
    if(error instanceof RequestBodyTooLarge)return new NextResponse(null,{status:413});
    return NextResponse.json({error:'invalid_or_stale_result'},{status:409});
  }
}
