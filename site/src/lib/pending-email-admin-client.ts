import { pendingEmailSearch, pendingEmailBefore, pendingEmailTimestamp, PENDING_EMAIL_LIMITS as L, PENDING_EMAIL_STATES as STATES, type PendingEmailOptions, type PendingEmailReadResult } from "./pending-email-admin-contract";
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,names:string)=>Object.keys(v).sort().join(",")===names.split(",").sort().join(",");
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length<=max&&!v.includes("\u0000");
const date=(v:unknown):v is string=>{if(!text(v,L.date))return false;try{pendingEmailTimestamp(v);return true;}catch{return false;}};
const nullableDate=(v:unknown)=>v===null||date(v);
const state=(v:unknown):boolean=>STATES.includes(v as typeof STATES[number]);
const cursor=(v:unknown)=>text(v,L.cursor)&&/^[A-Za-z0-9_-]+$/.test(v);
function counts(v:unknown):v is PendingEmailReadResult["summary"]["global"] {
 if(!obj(v)||!keys(v,"total,byState,suppressed,queued,withSuggestion,withAcceptance,withAdverse")||!count(v.total)||!obj(v.byState)||!keys(v.byState,STATES.join(","))||!Object.values(v.byState).every(count)||![v.suppressed,v.queued,v.withSuggestion,v.withAcceptance,v.withAdverse].every(x=>count(x)&&x<=(v.total as number)))return false;
 return Object.values(v.byState).reduce<number>((a,b)=>a+(b as number),0)===v.total;
}
/** Explicit fields only: e-mail-level history never becomes proof of one confirmation message. */
export function parsePendingEmailReadResult(v:unknown,options:PendingEmailOptions={}):PendingEmailReadResult|null {
 const limit=options.limit??50;
 if(!obj(v)||!keys(v,"ok,asOf,unit,summary,coverage,rows,next,facets")||v.ok!==true||!date(v.asOf)||v.unit!=="pending_registration"||!obj(v.summary)||!keys(v.summary,"global,filtered")||!counts(v.summary.global)||!counts(v.summary.filtered)||!obj(v.coverage)||!keys(v.coverage,"pending,matched,totalRowsReturned,complete,facetsComplete")||v.coverage.complete!==true||v.coverage.facetsComplete!==true||v.coverage.pending!==v.summary.global.total||v.coverage.matched!==v.summary.filtered.total||v.summary.filtered.total>v.summary.global.total||!Array.isArray(v.rows)||v.rows.length>limit||v.rows.length>v.summary.filtered.total||v.coverage.totalRowsReturned!==v.rows.length||v.next!==null&&!cursor(v.next)||v.next!==null&&(v.rows.length!==limit||v.next===options.before)||!obj(v.facets)||!keys(v.facets,"category,institution,domain,provider,state"))return null;
 for(const k of ["suppressed","queued","withSuggestion","withAcceptance","withAdverse"] as const)if(v.summary.filtered[k]>v.summary.global[k])return null;
 for(const k of STATES)if(v.summary.filtered.byState[k]>v.summary.global.byState[k])return null;
 if(!options.before&&v.rows.length!==Math.min(limit,v.summary.filtered.total))return null;
 if(!options.before&&(v.summary.filtered.total>limit)!==(v.next!==null))return null;
 let previous=options.before?pendingEmailBefore(options.before)??0:2147483648;const rowKeys="id,version,name,email,category,instituicao,criada,criadaTxt,motivo,detalhe,provedor,dominio,sugestao,motivoSugestao,suggestionSource,state,hasAcceptance,hasAdverse,providers,suppressed,suppressionReason,queued,queueSources,evidence";
 for(const r of v.rows){
  if(!obj(r)||!keys(r,rowKeys)||!Number.isInteger(r.id)||(r.id as number)<1||(r.id as number)>=previous||!text(r.version,20)||!/^\d+$/.test(r.version)||!text(r.name,L.name)||!text(r.email,L.email)||!["servidor","apoiador","estrangeiro"].includes(String(r.category))||!text(r.instituicao,L.institution)||!date(r.criada)||!text(r.criadaTxt,L.label)||!text(r.motivo,L.label)||!text(r.detalhe,L.detail)||!text(r.provedor,L.provider)||!text(r.dominio,L.email)||!state(r.state)||typeof r.hasAcceptance!=="boolean"||typeof r.hasAdverse!=="boolean"||!Array.isArray(r.providers)||!r.providers.every(p=>text(p,L.provider))||new Set(r.providers).size!==r.providers.length||typeof r.suppressed!=="boolean"||r.suppressionReason!==null&&!text(r.suppressionReason,L.reason)||typeof r.queued!=="boolean"||!Array.isArray(r.queueSources)||!r.queueSources.every(s=>s==="outbox"||s==="journal")||new Set(r.queueSources).size!==r.queueSources.length||r.queued!==(r.queueSources.length>0)||r.sugestao!==null&&!text(r.sugestao,L.email)||r.motivoSugestao!==null&&!text(r.motivoSugestao,L.detail)||!["none","local_catalog"].includes(String(r.suggestionSource))||(r.sugestao===null)!==(r.suggestionSource==="none"))return null;
  const f=options.filters??{};
  if(f.category&&r.category!==f.category||f.institution&&r.instituicao!==f.institution||f.domain&&r.dominio!==f.domain||f.provider&&!r.providers.includes(f.provider)||f.state&&r.state!==f.state)return null;
  for(const [filter,actual]of [[f.suppressed,r.suppressed],[f.queued,r.queued],[f.hasSuggestion,r.sugestao!==null],[f.hasAdverse,r.hasAdverse],[f.hasAcceptance,r.hasAcceptance],[f.adverseOrSuppressed,r.hasAdverse||r.suppressed]] as const)if(filter!==undefined&&(filter==="yes")!==actual)return null;
  previous=r.id as number;const e=r.evidence;
  if(!obj(e)||!keys(e,"scope,registrationLink,lastSignal,lastAcceptedAt,deliveredAt,openedAt,clickedAt,lastAdverse,legacyEngagementFirstOnly,latestConfirmationMessage")||!["none","address_aggregate"].includes(String(e.scope))||e.registrationLink!=="email_only"||![e.lastAcceptedAt,e.deliveredAt,e.openedAt,e.clickedAt].every(nullableDate)||typeof e.legacyEngagementFirstOnly!=="boolean")return null;
  if(e.lastSignal!==null){const s=e.lastSignal;if(!obj(s)||!keys(s,"state,at,provider,source")||!state(s.state)||s.state==="unrecorded"||!date(s.at)||!text(s.provider,L.provider)||!["legacy_log","legacy_engagement","legacy_event","message_attempt","message_event"].includes(String(s.source))||s.state!==r.state||e.scope!=="address_aggregate")return null;}else if(r.state!=="unrecorded")return null;
  if(e.lastAdverse!==null){const a=e.lastAdverse;if(!obj(a)||!keys(a,"type,at,provider,reason")||!["hard_bounce","soft_bounce","blocked","complaint"].includes(String(a.type))||!date(a.at)||!text(a.provider,L.provider)||!text(a.reason,L.reason)||e.scope!=="address_aggregate")return null;}
  if(r.hasAcceptance!==(e.lastAcceptedAt!==null)||r.hasAdverse!==(e.lastAdverse!==null))return null;
  if(e.latestConfirmationMessage!==null){const m=e.latestConfirmationMessage;if(!obj(m)||!keys(m,"id,createdAt,status")||!text(m.id,100)||!date(m.createdAt)||!["prepared","sending","accepted","rejected","indeterminate","queued"].includes(String(m.status)))return null;}
 }
 if(v.next!==null&&pendingEmailBefore(v.next)!==previous)return null;
 for(const [key,facets]of Object.entries(v.facets)){if(!Array.isArray(facets))return null;const seen=new Set<string>();for(const facet of facets){if(!obj(facet)||!keys(facet,"value,count")||!text(facet.value,key==="institution"?L.institution:key==="provider"?L.provider:L.email)||seen.has(facet.value)||!count(facet.count)||facet.count>v.summary.global.total||key==="state"&&!state(facet.value))return null;seen.add(facet.value);}}
 const rows=v.rows as PendingEmailReadResult["rows"],facets=v.facets as PendingEmailReadResult["facets"];
 for(const key of STATES){if(rows.filter(r=>r.state===key).length>v.summary.filtered.byState[key])return null;const entry=facets.state.find(f=>f.value===key);if(v.summary.global.byState[key]>0&&!entry||entry&&entry.count!==v.summary.global.byState[key])return null;}
 for(const [key,value]of [["suppressed",rows.filter(r=>r.suppressed).length],["queued",rows.filter(r=>r.queued).length],["withSuggestion",rows.filter(r=>r.sugestao!==null).length],["withAcceptance",rows.filter(r=>r.hasAcceptance).length],["withAdverse",rows.filter(r=>r.hasAdverse).length]] as const)if(value>v.summary.filtered[key])return null;
 for(const r of rows){for(const [key,values]of [["category",[r.category]],["institution",[r.instituicao]],["domain",[r.dominio]],["provider",r.providers],["state",[r.state]]] as const)for(const value of values)if(value&&!facets[key].some(f=>f.value===value))return null;}
 return v as unknown as PendingEmailReadResult;
}
export type PendingEmailJsonRead = { ok: true; value: unknown } | { ok: false; kind: "invalid" | "http" | "uncertain" | "aborted"; status?: number };
/** Internal JSON reader; the public query helper must validate the final server contract before consuming value. One GET only. */
export async function readPendingEmailJson(params: URLSearchParams, signal?: AbortSignal, transport: typeof fetch = fetch, timeoutMs = 15_000): Promise<PendingEmailJsonRead> {
  if (signal?.aborted) return { ok: false, kind: "aborted" };
  const controller = new AbortController();let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined, resolveAbort: ((value: PendingEmailJsonRead) => void) | undefined;
  const abort = () => { controller.abort();void reader?.cancel().catch(() => {});resolveAbort?.({ ok: false, kind: "aborted" }); };
  const aborted = new Promise<PendingEmailJsonRead>(resolve => { resolveAbort = resolve; });signal?.addEventListener("abort",abort,{once:true});
  const work = async (): Promise<PendingEmailJsonRead> => {
    try {
      const response = await transport(`/api/admin/emails/pendentes?${params}`,{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{accept:"application/json"},signal:controller.signal});
      if (!response.ok) { void response.body?.cancel().catch(() => {});return {ok:false,kind:"http",status:response.status}; }
      const length = response.headers.get("content-length"), max = 32 * 1024 * 1024;
      if (!response.body || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { void response.body?.cancel().catch(() => {});return {ok:false,kind:"invalid"}; }
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){void reader.cancel().catch(()=>{});return{ok:false,kind:"invalid"};}chunks.push(part.value);}
      const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
      try{const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));return{ok:true,value};}catch{return{ok:false,kind:"invalid"};}
    }catch{return{ok:false,kind:signal?.aborted?"aborted":"uncertain"};}finally{try{reader?.releaseLock();}catch{/* cancelled reader */}}
  };
  try{return await Promise.race([work(),aborted,new Promise<PendingEmailJsonRead>(resolve=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});resolve({ok:false,kind:"uncertain"});},Math.max(1,Math.min(30000,timeoutMs)));})]);}
  finally{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}

export type PendingEmailRead={ok:true;data:PendingEmailReadResult}|{ok:false;kind:"invalid"|"http"|"uncertain"|"aborted";status?:number};
export async function readPendingEmails(params:URLSearchParams,signal?:AbortSignal,transport:typeof fetch=fetch,timeoutMs=15000):Promise<PendingEmailRead>{
 const parsed=pendingEmailSearch(params);if(!parsed.ok||parsed.format!=="json")return{ok:false,kind:"invalid"};
 const result=await readPendingEmailJson(params,signal,transport,timeoutMs);if(!result.ok)return result;
 const data=parsePendingEmailReadResult(result.value,parsed.options);return data?{ok:true,data}:{ok:false,kind:"invalid"};
}
