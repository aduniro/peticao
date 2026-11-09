import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { authorizeBatchActor, documentVersion, type ApprovalRow } from "./batches";
import type { SessaoAdmin } from "./admin-users";

const validId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const validHash = (hash: string) => /^[a-f0-9]{64}$/.test(hash);
const key = (id: string) => `document_publication:v1:${id}`;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const unavailable = { ok:false as const };
type Release = { version:1; revision:number; sha256:string; enabled:boolean };
type VersionRow = { id:string; batch_id:number; ordinal:number; variant:"original"|"signed"; bytes:Buffer; sha256:string; list_hash:string; signature_kind:string|null; captured_at:Date };
const allowedKinds = new Set(["none","icp-brasil","externa-nao-validada"]);
function release(value: string | undefined): Release | null {
  try { const r=JSON.parse(value ?? "null") as Release; return r?.version===1 && Number.isSafeInteger(r.revision) && r.revision>0 && validHash(r.sha256) && typeof r.enabled==="boolean" ? r : null; }
  catch { return null; }
}
async function bounded(client:PoolClient) { await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'"); }

/** Approval to send alone is insufficient: only the latest exact selected binary is eligible. */
async function eligible(client:PoolClient,id:string,sha256:string) {
  const v=(await client.query<VersionRow>("SELECT id,batch_id,ordinal,variant,bytes,sha256,list_hash,signature_kind,captured_at FROM batch_document_versions WHERE id=$1",[id])).rows[0];
  if (!v || v.sha256!==sha256 || digest(v.bytes)!==sha256) return null;
  const b=(await client.query<ApprovalRow>("SELECT * FROM batches WHERE id=$1 FOR SHARE",[v.batch_id])).rows[0];
  if (!b?.pdf || !b.approved_at || !["prepared","failed","sent"].includes(b.status) || !Number.isFinite(Date.parse(b.approved_at)) || new Date(b.approved_at).toISOString()!==b.approved_at) return null;
  const selected=b.signed_pdf ?? b.pdf, variant=b.signed_pdf ? "signed" : "original";
  if (variant!==v.variant || !selected.equals(v.bytes) || v.list_hash!==b.list_hash || digest(b.pdf)!==b.pdf_sha256 || b.signed_pdf && digest(b.signed_pdf)!==b.signed_pdf_sha256) return null;
  if ((await client.query("SELECT 1 FROM batch_document_versions WHERE batch_id=$1 AND variant=$2 AND ordinal>$3 LIMIT 1",[v.batch_id,v.variant,v.ordinal])).rowCount) return null;
  if (!(await client.query("SELECT 1 FROM batch_document_versions WHERE id=$1 AND captured_at<=$2::timestamptz",[id,b.approved_at])).rowCount) return null;
  const approvals=(await client.query<{document_version:string;sent_sha256:string}>("SELECT data::jsonb->>'documentVersion' document_version,data::jsonb->>'sentSha256' sent_sha256 FROM audit_log WHERE event='batch_approved' AND data::jsonb->>'batchId'=$1 ORDER BY id LIMIT 2",[String(v.batch_id)])).rows;
  if (approvals.length!==1 || approvals[0].document_version!==documentVersion(b) || approvals[0].sent_sha256!==sha256) return null;
  return { versionId:v.id,sha256,byteLength:v.bytes.length,variant:v.variant,approvalRecorded:true as const,signature:{recordedKind:allowedKinds.has(v.signature_kind ?? "") ? v.signature_kind! : "unknown",onlineValidationPerformed:false as const} };
}

/** Explicit administrative release, with live account/session/stepup and CAS; no UI or delivery. */
export async function setDocumentPublication(input:{versionId:string;sha256:string;enabled:boolean;expectedRevision:number},actor:SessaoAdmin) {
  if (!validId(input.versionId) || !validHash(input.sha256) || typeof input.enabled!=="boolean" || !Number.isInteger(input.expectedRevision) || input.expectedRevision<0 || input.expectedRevision>=2147483647) return {ok:false as const,error:"parameters" as const};
  return tx(async client=>{
    await bounded(client);
    if (!await authorizeBatchActor(client,actor) || !actor.sessaoId || !(await client.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() AND stepup_ate>now() FOR SHARE",[actor.sessaoId,actor.userId])).rowCount) return {ok:false as const,error:"forbidden" as const};
    const stored=(await client.query<{value:string}>("SELECT value FROM settings WHERE key=$1 FOR UPDATE",[key(input.versionId)])).rows[0],current=release(stored?.value);
    if (stored && !current || (current?.revision ?? 0)!==input.expectedRevision || current && current.sha256!==input.sha256) return {ok:false as const,error:"conflict" as const};
    if (input.enabled && !await eligible(client,input.versionId,input.sha256)) return {ok:false as const,error:"ineligible" as const};
    if (!input.enabled && !current) return {ok:false as const,error:"ineligible" as const};
    const revision=input.expectedRevision+1,value:Release={version:1,revision,sha256:input.sha256,enabled:input.enabled};
    await client.query("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2",[key(input.versionId),JSON.stringify(value)]);
    await audit("document_publication_changed",null,{versionId:input.versionId,sha256:input.sha256,enabled:input.enabled,revision,userId:actor.userId,por:actor.email},client);
    return {ok:true as const,revision};
  });
}

/** No database lookup while disabled; no binary, identity, audit payload or inferred online validation. */
export async function publicDocumentVerification(versionId:string,sha256:string) {
  if (process.env.DOCUMENT_VERIFICATION_PUBLIC!=="1" || !validId(versionId) || !validHash(sha256)) return unavailable;
  try {
    return await tx(async client=>{
      await bounded(client);
      const stored=(await client.query<{value:string}>("SELECT value FROM settings WHERE key=$1 FOR SHARE",[key(versionId)])).rows[0],r=release(stored?.value);
      if (!r?.enabled || r.sha256!==sha256) return unavailable;
      const events=(await client.query<{data:string}>("SELECT data FROM audit_log WHERE event='document_publication_changed' AND data::jsonb->>'versionId'=$1 ORDER BY id DESC LIMIT 1",[versionId])).rows;
      const event=events[0] && JSON.parse(events[0].data);
      if (!event || event.revision!==r.revision || event.enabled!==true || event.sha256!==sha256) return unavailable;
      const metadata=await eligible(client,versionId,sha256);
      return metadata ? {ok:true as const,metadata} : unavailable;
    });
  } catch { return unavailable; }
}

/** The caller supplies a configured HTTPS origin, never request Host/forwarded headers. */
export function documentVerificationUrl(base:string,versionId:string,sha256:string) {
  if (!validId(versionId) || !validHash(sha256)) return null;
  try {
    const url=new URL(base);
    if (url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash || url.port && url.port!=="443" || !url.hostname.includes(".") || url.hostname.endsWith(".") || /(^|\.)(localhost|local|internal)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[")) return null;
    url.pathname=`/api/documentos/verificar/${versionId}`;url.searchParams.set("sha256",sha256);
    return url.href;
  } catch { return null; }
}
