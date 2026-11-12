import { mailQueueTable } from "./mail/queue-scope";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { brasilia } from "./time";
import { KNOWN_DOMAINS, editDistance } from "./email-typos";
import { pendingEmailBefore, encodePendingEmailBefore, pendingEmailCount, pendingEmailQuery, pendingEmailSearch, pendingEmailTimestamp, validPendingEmailActor, latestPendingEmailSignal, PENDING_EMAIL_FILTER_KEYS, PENDING_EMAIL_STATES, type PendingEmailActor, type PendingEmailOptions, type PendingEmailFilters, type PendingEmailRow, type PendingEmailReadResult, type PendingEmailExportResult, type PendingEmailFailure, type PendingEmailSignal, type PendingEmailCounts, type PendingEmailFacets, type PendingEmailState } from "./pending-email-admin-contract";
const DEADLINE = 10000, SOURCE_BYTES = 128 * 1024 * 1024, JSON_BYTES = 16 * 1024 * 1024, EXPORT_BYTES = 64 * 1024 * 1024;
const fail = (error: PendingEmailFailure["error"]): PendingEmailFailure => ({ ok: false, error });
const count = (v: unknown) => { const n = pendingEmailCount(v); if (n === null) throw new Error("invalid_pending_count"); return n; };
const checkpoint = (start: number) => { if (performance.now() - start > DEADLINE) throw new Error("pending_read_deadline"); };
const text = (v: unknown, max: number) => { if (typeof v !== "string" || v.length > max) throw new Error("pending_text_budget"); return v; };
const nullableDate = (v: unknown) => v === null ? null : pendingEmailTimestamp(v);
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function validPendingEmailOptions(raw: unknown): raw is PendingEmailOptions {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["before", "limit", "filters"].includes(k))) return false;
    const o = raw as PendingEmailOptions;
    if (o.filters !== undefined && (!o.filters || typeof o.filters !== "object" || Array.isArray(o.filters) || Object.keys(o.filters).some(k => !PENDING_EMAIL_FILTER_KEYS.includes(k as typeof PENDING_EMAIL_FILTER_KEYS[number])) || Object.values(o.filters).some(v => typeof v !== "string"))) return false;
    if (o.before !== undefined && typeof o.before !== "string" || o.limit !== undefined && typeof o.limit !== "number") return false;
    const parsed = pendingEmailSearch(new URLSearchParams(pendingEmailQuery(o)));
    return parsed.ok && (o.before === undefined || o.before === parsed.options.before) && (o.limit === undefined || o.limit === parsed.options.limit) && Object.entries(o.filters ?? {}).every(([k,v]) => (parsed.options.filters as Record<string,string>)[k] === v);
  } catch { return false; }
}
async function authorize(c: PoolClient, actor: PendingEmailActor) {
  if (!(await c.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel=ANY($3::text[]) FOR SHARE", [actor.userId, actor.email.toLowerCase(), ["edicao", "exclusao", "total"]])).rowCount) return false;
  return !!(await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount;
}
async function begin(c: PoolClient, actor: PendingEmailActor) {
  await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); await c.query("SET LOCAL lock_timeout='1000ms'"); await c.query("SET LOCAL statement_timeout='10000ms'");
  return authorize(c, actor);
}
const iso = (s: string) => `to_char(${s} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const READ_SQL = `WITH pending AS (
 SELECT id,xmin::text version,name,email,category,COALESCE(institution,university,'') institution,created_at,lower(trim(email)) address FROM signatures WHERE status='pending'
), addresses AS (SELECT DISTINCT address FROM pending), signals AS (
 SELECT lower(trim(l.to_addr)) address,'accepted' state,l.ts signal_at,l.provider,'legacy_log' source,NULL::text adverse_type,''::text reason FROM mail_log l JOIN addresses e ON e.address=lower(trim(l.to_addr)) WHERE l.kind='confirmacao' AND l.status='sent'
 UNION ALL SELECT lower(trim(g.email)),v.state,v.signal_at,g.provider,'legacy_engagement',NULL,'' FROM mail_engagement g JOIN addresses e ON e.address=lower(trim(g.email)) CROSS JOIN LATERAL(VALUES('delivered',g.delivered_at),('opened',g.opened_at),('clicked',g.clicked_at))v(state,signal_at) WHERE v.signal_at IS NOT NULL
 UNION ALL SELECT lower(trim(e.email)),'adverse',e.ts,e.provider,'legacy_event',e.type,COALESCE(e.reason,'') FROM mail_events e JOIN addresses p ON p.address=lower(trim(e.email))
 UNION ALL SELECT lower(trim(m.to_addr)),'accepted',a.finished_at,a.provider,'message_attempt',NULL,'' FROM mail_message_attempts a JOIN mail_messages m ON m.id=a.message_id JOIN addresses e ON e.address=lower(trim(m.to_addr)) WHERE m.kind='confirmacao' AND a.state='accepted' AND a.finished_at IS NOT NULL
 UNION ALL SELECT lower(trim(e.recipient)),CASE WHEN e.event_type IN('delivered','opened','clicked') THEN e.event_type ELSE 'adverse' END,e.occurred_at,e.provider,'message_event',CASE WHEN e.event_type IN('hard_bounce','soft_bounce','blocked','complaint') THEN e.event_type ELSE NULL END,'' FROM mail_message_events e JOIN addresses p ON p.address=lower(trim(e.recipient))
), signals_summary AS (
 SELECT address,${iso("max(signal_at) FILTER(WHERE state='accepted')")} accepted_at,${iso("max(signal_at) FILTER(WHERE state='delivered')")} delivered_at,${iso("max(signal_at) FILTER(WHERE state='opened')")} opened_at,${iso("max(signal_at) FILTER(WHERE state='clicked')")} clicked_at,bool_or(source='legacy_engagement') legacy_first FROM signals GROUP BY address
), latest_signal AS (
 SELECT DISTINCT ON(address) address,jsonb_build_object('state',state,'at',${iso("signal_at")},'provider',provider,'source',source) signal FROM signals ORDER BY address,signal_at DESC,CASE state WHEN 'adverse' THEN 5 WHEN 'clicked' THEN 4 WHEN 'opened' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END DESC,provider DESC,source DESC
), adverse AS (
 SELECT DISTINCT ON(address) address,adverse_type,${iso("signal_at")} adverse_at,provider,reason FROM signals WHERE state='adverse' ORDER BY address,signal_at DESC,provider DESC,source DESC,adverse_type DESC,reason DESC
), provider_rows AS (
 SELECT address,provider FROM signals UNION SELECT lower(trim(l.to_addr)),l.provider FROM mail_log l JOIN addresses e ON e.address=lower(trim(l.to_addr)) WHERE l.kind='confirmacao'
), providers AS (SELECT address,array_agg(DISTINCT provider ORDER BY provider) providers FROM provider_rows GROUP BY address), queue_rows AS (
 SELECT lower(trim(q.to_addr)) address,'outbox' source FROM ${mailQueueTable()} q JOIN addresses e ON e.address=lower(trim(q.to_addr)) WHERE q.kind='confirmacao' AND q.status='pending'
 UNION SELECT lower(trim(m.to_addr)),'journal' FROM mail_messages m JOIN addresses e ON e.address=lower(trim(m.to_addr)) WHERE m.kind='confirmacao' AND m.status='queued'
), queued AS (SELECT address,array_agg(DISTINCT source ORDER BY source) sources FROM queue_rows GROUP BY address), latest_message AS (
 SELECT DISTINCT ON(lower(trim(m.to_addr))) lower(trim(m.to_addr)) address,m.id::text,${iso("m.created_at")} created_at,m.status FROM mail_messages m JOIN addresses e ON e.address=lower(trim(m.to_addr)) WHERE m.kind='confirmacao' ORDER BY lower(trim(m.to_addr)),m.created_at DESC,m.id DESC
)
SELECT p.*,g.accepted_at,g.delivered_at,g.opened_at,g.clicked_at,COALESCE(g.legacy_first,false) legacy_first,CASE WHEN a.signal IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(a.signal) END signal_list,
 b.adverse_type,b.adverse_at,b.provider adverse_provider,b.reason adverse_reason,COALESCE(r.providers,'{}') providers,COALESCE(q.sources,'{}') queue_sources,
 s.reason suppression_reason,m.id message_id,m.created_at message_created,m.status message_status
FROM pending p LEFT JOIN signals_summary g USING(address) LEFT JOIN latest_signal a USING(address) LEFT JOIN adverse b USING(address) LEFT JOIN providers r USING(address) LEFT JOIN queued q USING(address) LEFT JOIN email_suppressions s ON lower(trim(s.email))=p.address LEFT JOIN latest_message m USING(address) ORDER BY p.id DESC`;

export function pendingEmailMatches(row: PendingEmailRow, filters: PendingEmailFilters = {}, ignore?: keyof PendingEmailFilters): boolean {
  for (const [key, value] of Object.entries(filters)) {
    if (key === ignore) continue;
    if (key === "q" && !normalize(row.name + " " + row.email).includes(normalize(value))) return false;
    if (key === "category" && row.category !== value || key === "institution" && row.instituicao !== value || key === "domain" && row.dominio !== value || key === "provider" && !row.providers.includes(value) || key === "state" && row.state !== value) return false;
    const actual = key === "suppressed" ? row.suppressed : key === "queued" ? row.queued : key === "hasSuggestion" ? row.sugestao !== null : key === "hasAdverse" ? row.hasAdverse : key === "hasAcceptance" ? row.hasAcceptance : key === "adverseOrSuppressed" ? row.hasAdverse || row.suppressed : null;
    if (actual !== null && actual !== (value === "yes")) return false;
  }
  return true;
}
function counts(rows: readonly PendingEmailRow[]): PendingEmailCounts {
  const result: PendingEmailCounts = { total: rows.length, byState: Object.fromEntries(PENDING_EMAIL_STATES.map(s => [s,0])) as Record<PendingEmailState,number>, suppressed: 0, queued: 0, withSuggestion: 0, withAcceptance: 0, withAdverse: 0 };
  for (const r of rows) { result.byState[r.state]++; if(r.suppressed)result.suppressed++;if(r.queued)result.queued++;if(r.sugestao)result.withSuggestion++;if(r.hasAcceptance)result.withAcceptance++;if(r.hasAdverse)result.withAdverse++; }
  return result;
}
function facets(rows: readonly PendingEmailRow[], filters: PendingEmailFilters): PendingEmailFacets {
  const result = {} as PendingEmailFacets;
  for (const key of ["category", "institution", "domain", "provider", "state"] as const) {
    const map = new Map<string,number>();
    for (const row of rows) if (pendingEmailMatches(row,filters,key)) {
      const values = key === "category" ? [row.category] : key === "institution" ? [row.instituicao] : key === "domain" ? [row.dominio] : key === "state" ? [row.state] : row.providers;
      for (const value of new Set(values)) if (value) map.set(value,(map.get(value) ?? 0)+1);
    }
    result[key] = [...map].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value,"pt"));
  }
  return result;
}
/** Pure indexed equivalent of suggestDomain; category/domain memoization is scoped to one RR read. */
export function createPendingLocalSuggestion(known: readonly string[],tick:()=>void=()=>{}):(domain:string,category:string)=>string|null {
  const cache = new Map<string,string|null>(),knownSet=new Set(known),byLength=new Map<number,number[]>(),byStem=new Map<string,number[]>();
  known.forEach((domain,i)=>{const length=byLength.get(domain.length)??[];length.push(i);byLength.set(domain.length,length);const stem=domain.split(".")[0],same=byStem.get(stem)??[];same.push(i);byStem.set(stem,same);});
  // Same heuristic as suggestDomain, indexed to avoid scanning/editing the whole catalog per address.
  // Checkpoints also bound CPU for the unusual case of many distinct malformed domains.
  return (rawDomain:string,category:string):string|null=>{
    const domain=rawDomain.trim().toLowerCase().replace(/\.$/,""),key=category+":"+domain;
    if(cache.has(key))return cache.get(key)!;
    if(domain.length<4||!domain.includes(".")||knownSet.has(domain)){cache.set(key,null);return null;}
    const stem=domain.split(".")[0],candidates=new Set<number>();
    for(let len=Math.max(0,domain.length-2);len<=domain.length+2;len++)for(const i of byLength.get(len)??[])candidates.add(i);
    if(stem.length>=3)for(const i of byStem.get(stem)??[])candidates.add(i);
    let best:{domain:string;score:number}|null=null;
    for(const i of [...candidates].sort((a,b)=>a-b)){tick();const candidate=known[i],distance=editDistance(domain,candidate),sameStem=stem.length>=3&&candidate.split(".")[0]===stem,score=sameStem?0.5+distance/100:distance<=2?distance:Infinity;if(score!==Infinity&&(!best||score<best.score))best={domain:candidate,score};}
    const result=best?.domain??null;cache.set(key,result);return result;
  };
}
async function readRows(c: PoolClient, start: number): Promise<{ rows: PendingEmailRow[]; total: number; asOf: string }> {
  checkpoint(start);
  const preflight = (await c.query("SELECT count(*)::text total,COALESCE(sum(512+octet_length(json_build_array(name,email,category,institution,university,created_at)::text)),0)::text bytes FROM signatures WHERE status='pending'")).rows[0];
  if(count(preflight.bytes)>SOURCE_BYTES)throw new Error("pending_source_budget");checkpoint(start);
  const raw = (await c.query(READ_SQL)).rows; checkpoint(start);
  if(raw.length!==count(preflight.total)||Buffer.byteLength(JSON.stringify(raw),"utf8")>SOURCE_BYTES)throw new Error("pending_incomplete_source");
  const curated = (await c.query("SELECT lower(domain) domain,status FROM institutional_domains ORDER BY domain")).rows;
  checkpoint(start);
  const frequent = (await c.query("SELECT lower(split_part(email,'@',2)) domain FROM signatures WHERE status='confirmed' GROUP BY 1 HAVING count(*)>=3 ORDER BY 1")).rows;checkpoint(start);
  if(Buffer.byteLength(JSON.stringify([curated,frequent]),"utf8")>8*1024*1024)throw new Error("pending_catalog_budget");
  const blocked = new Set(curated.filter(r=>r.status!=="approved").map(r=>text(r.domain,254)));
  const known = [...new Set([...KNOWN_DOMAINS,...curated.filter(r=>r.status==="approved").map(r=>text(r.domain,254)),...frequent.map(r=>text(r.domain,254))])].filter(d=>{checkpoint(start);const labels=d.split(".");return d&&!labels.some((_,i)=>blocked.has(labels.slice(i).join(".")));});
  if(Buffer.byteLength(JSON.stringify(known),"utf8")>8*1024*1024)throw new Error("pending_catalog_budget");
  const suggestLocal=createPendingLocalSuggestion(known,()=>checkpoint(start));
  const rows: PendingEmailRow[] = raw.map(r=>{
    checkpoint(start);
    const email=text(r.email,254),category=text(r.category,100),at=email.lastIndexOf("@"),domain=at>=0?email.slice(at+1).trim().toLowerCase():"";
    const target=suggestLocal(domain,category),proposed=target&&at>0?email.slice(0,at).toLowerCase()+"@"+target:null,suggestion=proposed&&proposed.length<=254?proposed:null;
    if(!Array.isArray(r.signal_list)||!Array.isArray(r.providers)||!Array.isArray(r.queue_sources))throw new Error("invalid_pending_signals");
    const lastSignal=latestPendingEmailSignal(r.signal_list as PendingEmailSignal[]),state=lastSignal?.state??"unrecorded",providers=r.providers.map((v:unknown)=>text(v,100)),queueSources=r.queue_sources;
    if(queueSources.some((v:unknown)=>v!=="outbox"&&v!=="journal"))throw new Error("invalid_pending_queue_source");
    const suppressionReason=r.suppression_reason===null?null:text(r.suppression_reason,16384),hasAdverse=r.adverse_type!==null;
    if(!Number.isInteger(r.id)||r.id<1||r.id>2147483647||typeof r.version!=="string"||!/^[1-9][0-9]{0,9}$/.test(r.version)||typeof r.legacy_first!=="boolean")throw new Error("invalid_pending_identity");
    const created=text(r.created_at,40);pendingEmailTimestamp(created);
    const message=r.message_id===null?null:{id:text(r.message_id,36),createdAt:pendingEmailTimestamp(r.message_created),status:r.message_status};
    if(message&&(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(message.id)||!["prepared","sending","accepted","rejected","indeterminate","queued"].includes(message.status)))throw new Error("invalid_pending_message");
    // MUDAR AQUI: presentation only; evidence scope and chronology, never a claim of non-receipt.
    const labels:Record<PendingEmailState,string>={clicked:"clicou",opened:"abriu",delivered:"entregue",adverse:"devolvido",accepted:"aceito",unrecorded:"sem registro"};
    return {id:r.id,version:text(r.version,10),name:text(r.name,512),email,category,instituicao:text(r.institution,512),criada:created,criadaTxt:brasilia(created,true),motivo:labels[state],detalhe:lastSignal?`${labels[state]} (${lastSignal.provider}) em ${lastSignal.at}`:"Sem registro nos provedores consultados",provedor:lastSignal?.provider??"",dominio:domain,sugestao:suggestion,motivoSugestao:suggestion?`${domain} parece erro de digitação de ${target}`:null,suggestionSource:suggestion?"local_catalog":"none",state,hasAcceptance:r.accepted_at!==null,hasAdverse,providers,suppressed:suppressionReason!==null,suppressionReason,queued:queueSources.length>0,queueSources,evidence:{scope:r.signal_list.length||providers.length||suppressionReason!==null||queueSources.length||message?"address_aggregate":"none",registrationLink:"email_only",lastSignal,lastAcceptedAt:nullableDate(r.accepted_at),deliveredAt:nullableDate(r.delivered_at),openedAt:nullableDate(r.opened_at),clickedAt:nullableDate(r.clicked_at),lastAdverse:hasAdverse?{type:r.adverse_type,at:pendingEmailTimestamp(r.adverse_at),provider:text(r.adverse_provider,100),reason:text(r.adverse_reason,16384)}:null,legacyEngagementFirstOnly:r.legacy_first,latestConfirmationMessage:message}};
  });
  if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error("incomplete_pending_rows");checkpoint(start);
  return {rows,total:count(preflight.total),asOf:pendingEmailTimestamp((await c.query("SELECT transaction_timestamp() stamp")).rows[0].stamp)};
}
export async function readPendingEmailPage(actor: PendingEmailActor, options: PendingEmailOptions = {}): Promise<PendingEmailReadResult|PendingEmailFailure> {
  if(!validPendingEmailActor(actor))return fail("forbidden");if(!validPendingEmailOptions(options))return fail("invalid");
  try{return await tx(async c=>{const start=performance.now();if(!await begin(c,actor))return fail("forbidden");const source=await readRows(c,start),filters=options.filters??{},matched=source.rows.filter(r=>pendingEmailMatches(r,filters)),before=options.before===undefined?null:pendingEmailBefore(options.before),limit=options.limit??50,candidates=matched.filter(r=>before===null||r.id<before),rows=candidates.slice(0,limit);
    const result:PendingEmailReadResult={ok:true,asOf:source.asOf,unit:"pending_registration",summary:{global:counts(source.rows),filtered:counts(matched)},coverage:{pending:source.total,matched:matched.length,totalRowsReturned:rows.length,complete:true,facetsComplete:true},rows,next:candidates.length>limit?encodePendingEmailBefore(rows.at(-1)!.id):null,facets:facets(source.rows,{})};
    if(Buffer.byteLength(JSON.stringify(result),"utf8")>JSON_BYTES)throw new Error("pending_json_budget");checkpoint(start);if(!await authorize(c,actor))return fail("forbidden");checkpoint(start);return result;});}catch{return fail("unavailable");}
}
export async function readPendingEmailExport(actor:PendingEmailActor,options:{filters?:PendingEmailFilters}={}):Promise<PendingEmailExportResult|PendingEmailFailure>{
  if(!validPendingEmailActor(actor))return fail("forbidden");if(!options||Object.keys(options).some(k=>k!=="filters")||!validPendingEmailOptions(options))return fail("invalid");
  try{return await tx(async c=>{const start=performance.now();if(!await begin(c,actor))return fail("forbidden");const source=await readRows(c,start),rows=source.rows.filter(r=>pendingEmailMatches(r,options.filters));const result:PendingEmailExportResult={ok:true,asOf:source.asOf,unit:"pending_registration",rows,total:rows.length};if(Buffer.byteLength(JSON.stringify(result),"utf8")>EXPORT_BYTES)throw new Error("pending_export_budget");checkpoint(start);if(!await authorize(c,actor))return fail("forbidden");checkpoint(start);return result;});}catch{return fail("unavailable");}
}
export async function auditPendingEmailExport(actor:PendingEmailActor,data:{rows:number;bytes:number;sha256:string;asOf:string}):Promise<boolean>{
  if(!validPendingEmailActor(actor)||!data||typeof data!=="object"||Object.keys(data).sort().join(",")!=="asOf,bytes,rows,sha256"||typeof data.rows!=="number"||typeof data.bytes!=="number"||pendingEmailCount(data.rows)===null||pendingEmailCount(data.bytes)===null||!/^[a-f0-9]{64}$/.test(data.sha256))return false;
  try{pendingEmailTimestamp(data.asOf);return await tx(async c=>{await c.query("SET LOCAL lock_timeout='1000ms'");await c.query("SET LOCAL statement_timeout='5000ms'");if(!await authorize(c,actor))return false;await audit("export_internal_base",null,{...data,scope:"pending_emails_complete_filtered",unit:"pending_registration",meaning:"file_prepared_not_delivery",actorId:actor.userId,sessionId:actor.sessaoId},c);if(!await authorize(c,actor))throw new Error("pending_export_authorization_changed");return true;});}catch{return false;}
}
