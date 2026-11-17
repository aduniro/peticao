import { historySearch,validHistoryKey,validHistoryUuid,validHistoryEventId,MESSAGE_STATES,MAIL_CHANNELS,CONTENT_STATES,ATTEMPT_STATES,EVENT_STATES,type HistoryRequest,type HistoryPage,type HistoryDetail,type HistoryCollectionPage,type HistoryRow,type HistoryAttempt,type HistoryEvent } from "./mail-history-admin-contract";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,names:string)=>Object.keys(v).sort().join(",")===names.split(",").sort().join(",");
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length<=max&&!v.includes("\u0000");
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const one=(v:unknown,values:readonly string[])=>typeof v==="string"&&values.includes(v);
const date=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v)&&!v.startsWith("0000")&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
type Cursor={at:string;key:string;collection?:"attempts"|"events";id?:string};
/** Pure cursor checks preserve microseconds and the message/collection scope; no Date millisecond reconstruction. */
export function historyClientCursor(raw:unknown,request:HistoryRequest):Cursor|null{
 if(!text(raw,800)||!/^[A-Za-z0-9_-]+$/.test(raw)||request.mode==="detail")return null;
 try{const bytes=Uint8Array.from(atob(raw.replace(/-/g,"+").replace(/_/g,"/")),ch=>ch.charCodeAt(0)),decoded:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(!object(decoded)||!date(decoded.at)||!validHistoryKey(decoded.key))return null;
  const canonical=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(decoded)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");if(canonical!==raw)return null;
  if(request.mode==="list")return keys(decoded,"at,key")?{at:decoded.at,key:decoded.key}:null;
  return keys(decoded,"v,key,collection,at,id")&&decoded.v===1&&decoded.key===request.key&&decoded.collection===request.collection&&(request.collection==="attempts"?validHistoryUuid(decoded.id):validHistoryEventId(decoded.id))?{at:decoded.at,key:decoded.key,collection:request.collection,id:decoded.id as string}:null;
 }catch{return null;}
}
function row(raw:unknown):raw is HistoryRow{
 if(!object(raw)||!keys(raw,"record_key,source,created_at,kind,channel,to_addr,status,content_state,previous_id")||!validHistoryKey(raw.record_key)||!date(raw.created_at)||!text(raw.kind,100)||!one(raw.channel,MAIL_CHANNELS)||!text(raw.to_addr,254)||!one(raw.status,MESSAGE_STATES)||!one(raw.content_state,CONTENT_STATES)||raw.previous_id!==null&&!validHistoryUuid(raw.previous_id))return false;
 return raw.source==="message"?raw.record_key.startsWith("message:"):raw.source==="legacy_attempt"&&raw.record_key.startsWith("legacy:")&&raw.content_state==="unavailable"&&raw.previous_id===null;
}
function attempt(raw:unknown):raw is HistoryAttempt{return object(raw)&&keys(raw,"id,provider,from_addr,state,started_at,finished_at,provider_id,error_code")&&validHistoryUuid(raw.id)&&text(raw.provider,100)&&text(raw.from_addr,512)&&one(raw.state,ATTEMPT_STATES)&&date(raw.started_at)&&(raw.finished_at===null||date(raw.finished_at))&&(raw.provider_id===null||text(raw.provider_id,200))&&(raw.error_code===null||typeof raw.error_code==="string"&&/^[a-z0-9_]{1,50}$/.test(raw.error_code));}
function event(raw:unknown):raw is HistoryEvent{return object(raw)&&keys(raw,"id,provider,event_type,occurred_at,received_at,attempt_id")&&validHistoryEventId(raw.id)&&text(raw.provider,100)&&one(raw.event_type,EVENT_STATES)&&date(raw.occurred_at)&&date(raw.received_at)&&(raw.attempt_id===null||validHistoryUuid(raw.attempt_id));}
const older=(at:string,id:string,prevAt:string,prevId:string,bigint=false)=>at<prevAt||at===prevAt&&(bigint?BigInt(id)<BigInt(prevId):id<prevId);
function items(raw:unknown,request:Extract<HistoryRequest,{mode:"collection"}>,next:unknown,total:unknown):raw is HistoryAttempt[]|HistoryEvent[]{
 const limit=request.options.limit??100;if(!Array.isArray(raw)||raw.length>limit||!count(total)||raw.length>total||next!==null&&!historyClientCursor(next,request)||next!==null&&(raw.length!==limit||next===request.options.before))return false;
 if(!request.options.before&&(raw.length!==Math.min(limit,total)||(total>limit)!==(next!==null)))return false;
 let previous=request.options.before?historyClientCursor(request.options.before,request):null;if(request.options.before&&!previous)return false;const seen=new Set<string>();
 for(const value of raw){if(!(request.collection==="attempts"?attempt(value):event(value)))return false;const item=value as HistoryAttempt&HistoryEvent,at=request.collection==="attempts"?item.started_at:item.occurred_at;if(seen.has(item.id)||previous&&!older(at,item.id,previous.at,previous.id!,request.collection==="events"))return false;seen.add(item.id);previous={key:request.key,collection:request.collection,at,id:item.id};}
 if(next!==null){const cursor=historyClientCursor(next,request);if(!previous||!cursor||previous.at!==cursor.at||previous.id!==cursor.id)return false;}return true;
}
export function parseHistoryPage(raw:unknown,request:Extract<HistoryRequest,{mode:"list"}>):HistoryPage|null{
 const limit=request.options.limit??30;if(!object(raw)||!keys(raw,"ok,asOf,total,records,next,coverage")||raw.ok!==true||!date(raw.asOf)||!count(raw.total)||!Array.isArray(raw.records)||raw.records.length>limit||raw.records.length>raw.total||!object(raw.coverage)||!keys(raw.coverage,"total,returned,complete")||raw.coverage.total!==raw.total||raw.coverage.returned!==raw.records.length||raw.coverage.complete!==true||raw.next!==null&&(!historyClientCursor(raw.next,request)||raw.records.length!==limit||raw.next===request.options.before))return null;
 if(!request.options.before&&(raw.records.length!==Math.min(limit,raw.total)||(raw.total>limit)!==(raw.next!==null)))return null;
 let previous=request.options.before?historyClientCursor(request.options.before,request):null;if(request.options.before&&!previous)return null;const seen=new Set<string>();
 for(const item of raw.records){if(!row(item)||seen.has(item.record_key)||previous&&!older(item.created_at,item.record_key,previous.at,previous.key))return null;const f=request.options;if(f.recipient&&item.to_addr.toLowerCase()!==f.recipient.toLowerCase()||f.kind&&item.kind!==f.kind||f.channel&&item.channel!==f.channel||f.status&&item.status!==f.status)return null;seen.add(item.record_key);previous={at:item.created_at,key:item.record_key};}
 if(raw.next!==null){const next=historyClientCursor(raw.next,request);if(!previous||!next||previous.key!==next.key||previous.at!==next.at)return null;}return raw as unknown as HistoryPage;
}
export function parseHistoryDetail(raw:unknown,key:string):HistoryDetail|null{
 if(!object(raw)||!keys(raw,"ok,key,asOf,source,record,content_state,attempts,events,attempts_truncated,events_truncated,attemptsPage,eventsPage")||raw.ok!==true||raw.key!==key||!validHistoryKey(key)||!date(raw.asOf)||!object(raw.record)||!one(raw.content_state,CONTENT_STATES)||typeof raw.attempts_truncated!=="boolean"||typeof raw.events_truncated!=="boolean")return null;
 const r=raw.record;
 if(raw.source==="message"){if(!key.startsWith("message:")||!keys(r,"id,created_at,kind,channel,to_addr,status,previous_id,content_state")||r.id!==key.slice(8)||!one(r.status,MESSAGE_STATES)||r.content_state!==raw.content_state||r.previous_id!==null&&!validHistoryUuid(r.previous_id))return null;}
 else if(raw.source!=="legacy_attempt"||!key.startsWith("legacy:")||!keys(r,"id,created_at,kind,channel,to_addr,provider,from_addr,status")||r.id!==Number(key.slice(7))||!text(r.provider,100)||r.from_addr!==null&&!text(r.from_addr,512)||!text(r.status,100)||raw.content_state!=="unavailable")return null;
 if(!date(r.created_at)||!text(r.kind,100)||!one(r.channel,MAIL_CHANNELS)||!text(r.to_addr,254))return null;
 for(const collection of ["attempts","events"] as const){const meta=raw[collection+"Page"];if(!object(meta)||!keys(meta,"total,returned,next,complete")||!count(meta.total)||meta.complete!==true||!Array.isArray(raw[collection])||meta.returned!==(raw[collection] as unknown[]).length)return null;
  if(raw.source==="legacy_attempt"){if(meta.total!==0||meta.returned!==0||meta.next!==null||raw[collection+"_truncated"]!==false)return null;}
  else if(!items(raw[collection],{mode:"collection",key,collection,options:{limit:100}},meta.next,meta.total)||raw[collection+"_truncated"]!==(meta.next!==null))return null;
 }
 return raw as unknown as HistoryDetail;
}
export function parseHistoryCollection(raw:unknown,request:Extract<HistoryRequest,{mode:"collection"}>):HistoryCollectionPage|null{
 if(!object(raw)||!keys(raw,"ok,key,collection,asOf,total,items,next,coverage")||raw.ok!==true||raw.key!==request.key||raw.collection!==request.collection||!date(raw.asOf)||!count(raw.total)||!object(raw.coverage)||!keys(raw.coverage,"total,returned,complete")||raw.coverage.total!==raw.total||!Array.isArray(raw.items)||raw.coverage.returned!==raw.items.length||raw.coverage.complete!==true||!items(raw.items,request,raw.next,raw.total))return null;
 return raw as unknown as HistoryCollectionPage;
}
export type HistoryJsonRead = { ok: true; value: unknown } | { ok: false; kind: "invalid" | "http" | "uncertain" | "aborted"; status?: number };
/** Internal JSON reader; the public query helper must validate the final server contract before consuming value. One GET only. */
export async function readHistoryJson(params: URLSearchParams, signal?: AbortSignal, transport: typeof fetch = fetch, timeoutMs = 15_000): Promise<HistoryJsonRead> {
  if (signal?.aborted) return { ok: false, kind: "aborted" };
  const controller = new AbortController();let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined, resolveAbort: ((value: HistoryJsonRead) => void) | undefined;
  const abort = () => { controller.abort();void reader?.cancel().catch(() => {});resolveAbort?.({ ok: false, kind: "aborted" }); };
  const aborted = new Promise<HistoryJsonRead>(resolve => { resolveAbort = resolve; });signal?.addEventListener("abort",abort,{once:true});
  const work = async (): Promise<HistoryJsonRead> => {
    try {
      const response = await transport(`/api/admin/emails/mensagens?${params}`,{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{accept:"application/json"},signal:controller.signal});
      if (!response.ok) { void response.body?.cancel().catch(() => {});return {ok:false,kind:"http",status:response.status}; }
      const length = response.headers.get("content-length"), max = 4 * 1024 * 1024;
      if (!response.body || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { void response.body?.cancel().catch(() => {});return {ok:false,kind:"invalid"}; }
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){void reader.cancel().catch(()=>{});return{ok:false,kind:"invalid"};}chunks.push(part.value);}
      const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
      try{const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));return{ok:true,value};}catch{return{ok:false,kind:"invalid"};}
    }catch{return{ok:false,kind:signal?.aborted?"aborted":"uncertain"};}finally{try{reader?.releaseLock();}catch{/* cancelled reader */}}
  };
  try{return await Promise.race([work(),aborted,new Promise<HistoryJsonRead>(resolve=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});resolve({ok:false,kind:"uncertain"});},Math.max(1,Math.min(30000,timeoutMs)));})]);}
  finally{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}

export type HistoryRead={ok:true;mode:"list";data:HistoryPage}|{ok:true;mode:"detail";data:HistoryDetail}|{ok:true;mode:"collection";data:HistoryCollectionPage}|{ok:false;kind:"invalid"|"http"|"uncertain"|"aborted";status?:number};
export async function readHistoryMetadata(params:URLSearchParams,signal?:AbortSignal,transport:typeof fetch=fetch,timeoutMs=15000):Promise<HistoryRead>{
 const request=historySearch(params);if(!request||request.mode!=="detail"&&request.options.before&&!historyClientCursor(request.options.before,request))return{ok:false,kind:"invalid"};
 const result=await readHistoryJson(params,signal,transport,timeoutMs);if(!result.ok)return result;
 if(request.mode==="list"){const data=parseHistoryPage(result.value,request);return data?{ok:true,mode:"list",data}:{ok:false,kind:"invalid"};}
 if(request.mode==="detail"){const data=parseHistoryDetail(result.value,request.key);return data?{ok:true,mode:"detail",data}:{ok:false,kind:"invalid"};}
 const data=parseHistoryCollection(result.value,request);return data?{ok:true,mode:"collection",data}:{ok:false,kind:"invalid"};
}
