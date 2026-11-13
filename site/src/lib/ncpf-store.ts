import { createHash, randomUUID } from "node:crypto";
import { query, tx } from "./db";
import { encryptCpfCache, decryptCpfCache } from "./cpf-cache-crypto";
import { onlyDigits, isValidCpf } from "./cpf";
import { classifyCpfName } from "./cpf-name";
import { hmac, newToken, sha256 } from "./security";
import type { SignInput } from "./signatures";
import type { PoolClient } from "pg";
import { purgeSignupEphemera } from "./signup-ephemeral-gc";

export const NCPF_DAYS = 30;
export const NCPF_INTENT_MS = 15 * 60_000;
export const ncpfEnabled = () => process.env.NCPF_ENABLED === "1";
export const ncpfQueriesEnabled = () => ncpfEnabled() && process.env.NCPF_QUERY_ENABLED === "1";
const context = (hash: string, id: string) => `ncpf:v1:${hash}:${id}`;
export type Evidence = { id: string; name: string; cpf: string; fetchedAt: string; expiresAt: string };
type EvidenceRow = { id: string; cpf_hash: string; payload: string; fetched_at: Date; last_verified_at: Date; expires_at: Date };
function decoded(row: EvidenceRow): Evidence | null {
  const plain = decryptCpfCache(row.payload, context(row.cpf_hash, row.id));
  if (!plain) return null;
  try { const r = JSON.parse(plain); if(typeof r.name!=="string" || !r.name.trim() || typeof r.cpf!=="string" || !isValidCpf(r.cpf))return null;return { id: row.id, name: r.name, cpf: r.cpf, fetchedAt: new Date(row.last_verified_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() }; } catch { return null; }
}
export async function findEvidence(cpf: string, id?: string, client?:PoolClient, allowExpiredProjection=false): Promise<Evidence | null> {
  const row = (await query<EvidenceRow>(`SELECT id,cpf_hash,payload,fetched_at,last_verified_at,expires_at FROM ncpf_evidence
    WHERE cpf_hash=$1 AND ${id ? "id=$2" : allowExpiredProjection ? "true" : "expires_at>now()"} ORDER BY last_verified_at DESC,created_at DESC LIMIT 1`, id ? [hmac(cpf), id] : [hmac(cpf)],client)).rows[0];
  const value = row && decoded(row);
  return value && value.cpf === cpf ? value : null;
}

/** Only called by the authenticated source worker/importer, never by public form data. */
export async function saveTrtEvidence(a: { cpf: string; documentCpf: string; name: string; pdf: Buffer; fetchedAt: string; origin: string }, client?:PoolClient): Promise<Evidence> {
  const cpf = onlyDigits(a.cpf), docCpf = onlyDigits(a.documentCpf), fetched = new Date(a.fetchedAt);
  if (!isValidCpf(cpf) || cpf !== docCpf || !a.name.trim() || a.name.length > 250 || !Number.isFinite(fetched.getTime()) || fetched.getTime() > Date.now() + 60_000 || fetched.getTime() < Date.now() - NCPF_DAYS * 86400_000) throw new Error("invalid_trt_evidence");
  if (!a.pdf.subarray(0, 5).equals(Buffer.from("%PDF-")) || a.pdf.length > 16 * 1024 * 1024) throw new Error("invalid_trt_document");
  const url = new URL(a.origin);
  if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "trt3.jus.br" || url.hostname.endsWith(".trt3.jus.br"))) throw new Error("invalid_trt_origin");
  const id = randomUUID(), hash = hmac(cpf), digest = createHash("sha256").update(a.pdf).digest("hex"), expires = new Date(fetched.getTime() + NCPF_DAYS * 86400_000);
  const payload = encryptCpfCache(JSON.stringify({ cpf, name: a.name.trim(), origin: a.origin }), context(hash, id));
  const save=async(c:PoolClient)=>{
    const r = (await query<EvidenceRow>(`INSERT INTO ncpf_evidence(id,cpf_hash,payload,document_sha256,document_bytes,fetched_at,expires_at,last_verified_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$6) ON CONFLICT(cpf_hash,document_sha256) DO UPDATE
      SET last_verified_at=greatest(ncpf_evidence.last_verified_at,EXCLUDED.last_verified_at),expires_at=greatest(ncpf_evidence.expires_at,EXCLUDED.expires_at)
      RETURNING id,cpf_hash,payload,fetched_at,last_verified_at,expires_at`, [id,hash,payload,digest,a.pdf,fetched,expires],c)).rows[0];
    await c.query('INSERT INTO ncpf_evidence_observations(evidence_id,verified_at,origin_digest) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[r.id,fetched,hmac(a.origin)]);
    const value = decoded(r); if (!value) throw new Error("evidence_decryption_failed");return value;
  };
  return client?save(client):tx(save);
}

export function inputBinding(input: SignInput, whatsapp: string | null = null): string {
  return hmac(JSON.stringify(["ncpf-input:v1", Object.keys(input).sort().map(k => [k,(input as any)[k]]), whatsapp]));
}
export type Intent = { id: string; cpf_hash: string; binding_hash: string; security_passed: boolean; evidence_id: string | null; declared_name: string; job_id: string | null };
export async function readIntent(token: unknown, input: SignInput, visitor = "", whatsapp: string | null = null): Promise<Intent | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || !input.cpf) return null;
  const r = (await query<Intent>(`SELECT id,cpf_hash,binding_hash,security_passed,evidence_id,declared_name,job_id FROM ncpf_intents
    WHERE token_hash=$1 AND expires_at>now() AND binding_hash=$2 AND visitor_hash=$3 AND cpf_hash=$4`, [sha256(token),inputBinding(input,whatsapp),hmac(`visitor:${visitor}`),hmac(input.cpf)])).rows[0];
  return r ?? null;
}
/** Existing open tabs only carry their opaque identity ticket, not the new field. */
export async function readIntentFromTicket(ticket:string,input:SignInput,visitor="",whatsapp:string|null=null):Promise<Intent|null> {
  const rows=(await query<Intent&{visitor_hash:string}>(`SELECT id,cpf_hash,binding_hash,security_passed,evidence_id,declared_name,job_id,visitor_hash FROM ncpf_intents
    WHERE ticket_hash=$1 AND expires_at>now() ORDER BY created_at DESC`,[sha256(ticket)])).rows;
  const row=rows.find(r=>r.binding_hash===inputBinding(input,whatsapp)&&r.visitor_hash===hmac(`visitor:${visitor}`)&&r.cpf_hash===hmac(input.cpf!));
  if(rows.length&&!row)throw new Error('ncpf_ticket_data_changed');
  return row??null;
}
export async function bindIntentTicket(token:string,ticket:string) {
  await query('UPDATE ncpf_intents SET ticket_hash=COALESCE(ticket_hash,$2) WHERE token_hash=$1 AND expires_at>now()',[sha256(token),sha256(ticket)]);
}
export async function enqueueCpf(cpf: string, purpose: "interactive" | "consolidation" = "interactive"): Promise<string> {
  if (!isValidCpf(cpf)) throw new Error("invalid_cpf_job");
  return tx(async c => {
    const hash = hmac(cpf); await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`ncpf:${hash}`]);
    const active = (await c.query<{id:string}>("SELECT id FROM ncpf_jobs WHERE cpf_hash=$1 AND state IN ('queued','running','retry') FOR UPDATE", [hash])).rows[0];
    if (active) {
      if (purpose === "interactive") await c.query("UPDATE ncpf_jobs SET purpose='interactive' WHERE id=$1",[active.id]);
      return active.id;
    }
    const id = randomUUID();
    await c.query("INSERT INTO ncpf_jobs(id,cpf_hash,payload,purpose) VALUES($1,$2,$3,$4)",[id,hash,encryptCpfCache(cpf,context(hash,id)),purpose]);
    await c.query("SELECT pg_notify('ncpf_jobs','ready')"); return id;
  });
}
export async function makeIntent(a: { input: SignInput; visitor?: string; whatsapp?: string | null; securityPassed: boolean; jobId?: string; evidenceId?: string; apiName?:string }): Promise<string> {
  const token = newToken(),id=randomUUID();
  await purgeSignupEphemera().catch(()=>{});
  await query(`INSERT INTO ncpf_intents(id,token_hash,binding_hash,cpf_hash,declared_name,visitor_hash,security_passed,job_id,evidence_id,expires_at,api_name_payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id,sha256(token),inputBinding(a.input,a.whatsapp),hmac(a.input.cpf!),a.input.name,hmac(`visitor:${a.visitor ?? ""}`),a.securityPassed,a.jobId ?? null,a.evidenceId ?? null,new Date(Date.now()+NCPF_INTENT_MS),a.apiName?encryptCpfCache(a.apiName,`ncpf-api:${id}`):null]);
  return token;
}
export async function intentStatus(token: string, visitor = "") {
  const r = (await query<Intent>(`SELECT id,cpf_hash,binding_hash,security_passed,evidence_id,declared_name,job_id FROM ncpf_intents
    WHERE token_hash=$1 AND visitor_hash=$2 AND expires_at>now()`,[sha256(token),hmac(`visitor:${visitor}`)])).rows[0];
  if (!r) return { state: "expired" } as const;
  const row = (await query<EvidenceRow>(`SELECT id,cpf_hash,payload,fetched_at,last_verified_at,expires_at FROM ncpf_evidence WHERE cpf_hash=$1 AND ${r.evidence_id?'id=$2':'expires_at>now()'} ORDER BY last_verified_at DESC LIMIT 1`,r.evidence_id?[r.cpf_hash,r.evidence_id]:[r.cpf_hash])).rows[0];
  const evidence = row && decoded(row);
  if (evidence) {
    const match = classifyCpfName(evidence.name,r.declared_name);
    if (match === "mismatch") {
      await tx(async c=>{
        const once=await c.query("UPDATE ncpf_intents SET rejected_recorded=true WHERE id=$1 AND NOT rejected_recorded RETURNING cpf_hash",[r.id]);
        if (once.rowCount) await c.query("INSERT INTO identity_attempts(cpf_hash,method,ok,ts) VALUES($1,'nome',false,$2)",[r.cpf_hash,new Date().toISOString()]);
      });
      return { state: "rejected" } as const;
    }
    await query("UPDATE ncpf_intents SET evidence_id=$2 WHERE id=$1",[r.id,evidence.id]);
    return { state: "ready" } as const;
  }
  const job = r.job_id && (await query<{state:string}>("SELECT state FROM ncpf_jobs WHERE id=$1",[r.job_id])).rows[0];
  return { state: !ncpfQueriesEnabled() || job && (job.state === "not_found" || job.state === "retry") ? "unavailable" : "pending" } as const;
}

export async function consolidateEvidence(evidence: Evidence, client?:PoolClient): Promise<number> {
  const apply=async (c:PoolClient) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`ncpf-projection:${hmac(evidence.cpf)}`]);
    const latest=(await c.query<{id:string}>("SELECT id FROM ncpf_evidence WHERE cpf_hash=$1 ORDER BY last_verified_at DESC,created_at DESC LIMIT 1",[hmac(evidence.cpf)])).rows[0];
    if(latest?.id!==evidence.id)return 0;
    const rows = (await c.query<{id:number;name:string}>("SELECT id,name FROM signatures WHERE cpf_hash=$1 AND status='confirmed' AND name<>$2 FOR UPDATE",[hmac(evidence.cpf),evidence.name])).rows;
    for (const r of rows) {
      await c.query("INSERT INTO signature_name_history(signature_id,previous_name,selected_name,evidence_id) VALUES($1,$2,$3,$4)",[r.id,r.name,evidence.name,evidence.id]);
      await c.query("UPDATE signatures SET name=$2,name_source='trt3',name_evidence_id=$3 WHERE id=$1",[r.id,evidence.name,evidence.id]);
    }
    await c.query("UPDATE signatures SET name_source='trt3',name_evidence_id=$2,name_projected_at=now() WHERE cpf_hash=$1 AND status='confirmed'",[hmac(evidence.cpf),evidence.id]);
    return rows.length;
  };
  return client?apply(client):tx(apply);
}
