import { mailDeliverySearch,mailDeliveryTimestamp,MAIL_DELIVERY_STATES,type MailDeliveryOptions,type MailDeliveryReadResult,type MailDeliveryRow } from "./mail-delivery-admin-contract";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,list:string)=>Object.keys(v).sort().join(",")===list.split(",").sort().join(",");
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length<=max&&!v.includes("\u0000");
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const date=(v:unknown,empty=false):v is string=>{if(v===""&&empty)return true;try{mailDeliveryTimestamp(v);return typeof v==="string";}catch{return false;}};
const compareC=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);for(let n=0;n<Math.min(x.length,y.length);n++)if(x[n]!==y[n])return x[n]-y[n];return x.length-y.length;};
const states=(v:unknown)=>MAIL_DELIVERY_STATES.includes(v as typeof MAIL_DELIVERY_STATES[number]);
function inventory(v:unknown):v is MailDeliveryReadResult["inventory"]{return object(v)&&keys(v,"records,registrations,pending,confirmed,unregisteredAddresses")&&Object.values(v).every(count)&&(v.pending as number)+(v.confirmed as number)===v.registrations&&(v.registrations as number)+(v.unregisteredAddresses as number)===v.records;}
function summary(v:unknown):v is MailDeliveryReadResult["summary"]{return object(v)&&keys(v,"total,registrations,pending,confirmed,unregisteredAddresses,byState")&&[v.total,v.registrations,v.pending,v.confirmed,v.unregisteredAddresses].every(count)&&(v.pending as number)+(v.confirmed as number)===v.registrations&&(v.registrations as number)+(v.unregisteredAddresses as number)===v.total&&object(v.byState)&&keys(v.byState,MAIL_DELIVERY_STATES.join(","))&&Object.values(v.byState).every(count)&&Object.values(v.byState).reduce<number>((a,b)=>a+(b as number),0)===v.total;}
/** Strict row projection; a registration and an unrelated address are different inventory units. */
export function parseMailDeliveryResult(value:unknown,options:MailDeliveryOptions={}):MailDeliveryReadResult|null{
 const page=options.page??1,limit=options.limit??50,provider=options.filters?.provedor??null;
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger((page-1)*limit))return null;
 if(!object(value)||!keys(value,"ok,asOf,unit,total,pagina,limite,linhas,inventory,summary,providerScope,coverage")||value.ok!==true||!date(value.asOf)||value.unit!=="registration_or_unregistered_address"||!count(value.total)||value.pagina!==page||value.limite!==limit||value.providerScope!==provider||!inventory(value.inventory)||!summary(value.summary)||value.summary.total!==value.total||value.summary.total>value.inventory.records||!object(value.coverage)||!keys(value.coverage,"inventoryRecords,matched,totalRowsReturned,complete,signalsComplete")||value.coverage.inventoryRecords!==value.inventory.records||value.coverage.matched!==value.total||value.coverage.complete!==true||value.coverage.signalsComplete!==true||!Array.isArray(value.linhas)||value.coverage.totalRowsReturned!==value.linhas.length||value.linhas.length!==Math.min(limit,Math.max(0,value.total-(page-1)*limit)))return null;
 for(const key of ["registrations","pending","confirmed","unregisteredAddresses"] as const)if(value.summary[key]>value.inventory[key])return null;
 const ids=new Set<string>();let previous:MailDeliveryRow|undefined;
 for(const row of value.linhas){
  if(!object(row)||!keys(row,"recordKey,rowKind,cadastroId,email,nome,categoria,instituicao,cargo,campus,universidade,cidadeUf,pais,cadastro,cadastradoEm,confirmadoEm,whatsapp,envios,ultimoEnvio,ultimoTipo,provedores,situacao,entregueEm,abertoEm,clicouEm,devolucao,devolucaoMotivo,devolucaoEm,evidence")||!text(row.recordKey,267)||ids.has(row.recordKey)||!text(row.email,254)||row.email!==row.email.trim().toLowerCase()||!["nome","categoria","instituicao","cargo","campus","universidade","cidadeUf","pais"].every(k=>text(row[k],512))||!text(row.whatsapp,64)||!count(row.envios)||!text(row.ultimoTipo,512)||!text(row.provedores,16384)||!states(row.situacao)||!["cadastradoEm","confirmadoEm","ultimoEnvio","entregueEm","abertoEm","clicouEm","devolucaoEm"].every(k=>date(row[k],true))||!["","hard_bounce","soft_bounce","blocked","complaint"].includes(String(row.devolucao))||!text(row.devolucaoMotivo,16384))return null;
  if(row.rowKind==="registration"){if(!Number.isInteger(row.cadastroId)||(row.cadastroId as number)<1||(row.cadastroId as number)>2147483647||row.recordKey!==`registration:${row.cadastroId}`||!["aguardando","confirmado"].includes(String(row.cadastro))||!["servidor","apoiador","estrangeiro"].includes(String(row.categoria))||!date(row.cadastradoEm))return null;}
  else if(row.rowKind!=="unregistered_address"||row.cadastroId!==null||row.recordKey!==`unregistered:${row.email}`||row.cadastro!==""||row.categoria!==""||row.cadastradoEm!==""||row.confirmadoEm!=="")return null;
  const e=row.evidence;if(!object(e)||!keys(e,"scope,registrationLink,messageKinds,providerScope,providersAll,lastSignal,relationToCurrentConfirmation,timestamps,legacyEngagementFirstOnly,acceptedLogRecords,acceptedJournalAttempts,sendCountMeaning,contactState")||!["none","address_aggregate"].includes(String(e.scope))||e.registrationLink!==(row.rowKind==="registration"?"email_only":"none")||e.messageKinds!=="all"||e.providerScope!==provider||!Array.isArray(e.providersAll)||!e.providersAll.every(v=>text(v,100))||new Set(e.providersAll).size!==e.providersAll.length||provider!==null&&!e.providersAll.includes(provider)||e.relationToCurrentConfirmation!=="not_proven"||e.timestamps!=="earliest_recorded_history"||typeof e.legacyEngagementFirstOnly!=="boolean"||!count(e.acceptedLogRecords)||!count(e.acceptedJournalAttempts)||row.envios!==e.acceptedLogRecords||e.sendCountMeaning!=="legacy_accepted_log_records_not_unique_messages"||!["absent","withheld_no_opt_in","available","unavailable"].includes(String(e.contactState))||(e.contactState==="available")!==(row.whatsapp!==""))return null;
  if(e.lastSignal!==null){const s=e.lastSignal;if(!object(s)||!keys(s,"state,at,provider,source")||!["accepted","delivered","opened","clicked","adverse"].includes(String(s.state))||!date(s.at)||!text(s.provider,100)||provider!==null&&s.provider!==provider||!e.providersAll.includes(s.provider)||!["legacy_log","legacy_engagement","legacy_event","message_attempt","message_event"].includes(String(s.source))||e.scope!=="address_aggregate")return null;}
  if(e.lastSignal===null){if(row.situacao!=="sem_registro")return null;}
  else {const labels:Record<string,string>={accepted:"aceito",delivered:"entregue",opened:"abriu",clicked:"clicou",adverse:"devolvido"};if(row.situacao!==labels[String((e.lastSignal as Record<string,unknown>).state)])return null;}
  const f=options.filters??{};if(f.situacao&&row.situacao!==f.situacao||f.cadastro&&(f.cadastro==="sem"?row.rowKind!=="unregistered_address":row.cadastro!==f.cadastro)||f.categoria&&row.categoria!==f.categoria)return null;
  const current=row as unknown as MailDeliveryRow;if(previous){const oldDate=previous.ultimoEnvio,newDate=current.ultimoEnvio;if(oldDate===""&&newDate!==""||oldDate!==""&&newDate!==""&&oldDate<newDate||oldDate===newDate&&(compareC(previous.email,current.email)>0||previous.email===current.email&&(previous.cadastroId??0)<(current.cadastroId??0)))return null;}
  previous=current;ids.add(row.recordKey);
 }
 const lines=value.linhas as MailDeliveryRow[];
 for(const state of MAIL_DELIVERY_STATES)if(lines.filter(r=>r.situacao===state).length>value.summary.byState[state])return null;
 for(const [key,number]of [["registrations",lines.filter(r=>r.rowKind==="registration").length],["pending",lines.filter(r=>r.cadastro==="aguardando").length],["confirmed",lines.filter(r=>r.cadastro==="confirmado").length],["unregisteredAddresses",lines.filter(r=>r.rowKind==="unregistered_address").length]] as const)if(number>value.summary[key])return null;
 return value as unknown as MailDeliveryReadResult;
}
export type DeliveryJsonRead = { ok: true; value: unknown } | { ok: false; kind: "invalid" | "http" | "uncertain" | "aborted"; status?: number };
/** Internal JSON reader; the public query helper must validate the final server contract before consuming value. One GET only. */
export async function readDeliveryJson(params: URLSearchParams, signal?: AbortSignal, transport: typeof fetch = fetch, timeoutMs = 15_000): Promise<DeliveryJsonRead> {
  if (signal?.aborted) return { ok: false, kind: "aborted" };
  const controller = new AbortController();let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined, resolveAbort: ((value: DeliveryJsonRead) => void) | undefined;
  const abort = () => { controller.abort();void reader?.cancel().catch(() => {});resolveAbort?.({ ok: false, kind: "aborted" }); };
  const aborted = new Promise<DeliveryJsonRead>(resolve => { resolveAbort = resolve; });signal?.addEventListener("abort",abort,{once:true});
  const work = async (): Promise<DeliveryJsonRead> => {
    try {
      const response = await transport(`/api/admin/emails/entregas?${params}`,{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{accept:"application/json"},signal:controller.signal});
      if (!response.ok) { void response.body?.cancel().catch(() => {});return {ok:false,kind:"http",status:response.status}; }
      const length = response.headers.get("content-length"), max = 32 * 1024 * 1024;
      if (!response.body || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { void response.body?.cancel().catch(() => {});return {ok:false,kind:"invalid"}; }
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){void reader.cancel().catch(()=>{});return{ok:false,kind:"invalid"};}chunks.push(part.value);}
      const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
      try{const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));return{ok:true,value};}catch{return{ok:false,kind:"invalid"};}
    }catch{return{ok:false,kind:signal?.aborted?"aborted":"uncertain"};}finally{try{reader?.releaseLock();}catch{/* cancelled reader */}}
  };
  try{return await Promise.race([work(),aborted,new Promise<DeliveryJsonRead>(resolve=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});resolve({ok:false,kind:"uncertain"});},Math.max(1,Math.min(30000,timeoutMs)));})]);}
  finally{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}

export type DeliveryRead={ok:true;data:MailDeliveryReadResult}|{ok:false;kind:"invalid"|"http"|"uncertain"|"aborted";status?:number};
export async function readMailDelivery(params:URLSearchParams,signal?:AbortSignal,transport:typeof fetch=fetch,timeoutMs=15000):Promise<DeliveryRead>{
 const parsed=mailDeliverySearch(params);if(!parsed.ok||parsed.format!=="json")return{ok:false,kind:"invalid"};
 const request=new URLSearchParams(params);request.set("formato","json");const result=await readDeliveryJson(request,signal,transport,timeoutMs);if(!result.ok)return result;
 const data=parseMailDeliveryResult(result.value,parsed.options);return data?{ok:true,data}:{ok:false,kind:"invalid"};
}
