import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { authorizeBatchActor, documentVersion, type ApprovalRow } from "./batches";
import type { SessaoAdmin } from "./admin-users";
import { A1_MAX_PDF_BYTES, type A1WorkerBinding } from "./a1-worker-contract";

export const BATCH_A1_POLICY_KEY = "batch_a1_policy_v1";
export const A1_LEASE_SECONDS = 120;
export const BATCH_A1_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS batch_a1_jobs (
    id UUID PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id),
    request_id UUID NOT NULL, request_fingerprint TEXT NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
    actor_id INTEGER NOT NULL REFERENCES admin_users(id), actor_email TEXT NOT NULL,
    session_id INTEGER NOT NULL, authorization_id UUID NOT NULL UNIQUE,
    authorized_at TIMESTAMPTZ NOT NULL, authorization_expires_at TIMESTAMPTZ NOT NULL,
    input_artifact_version_id UUID NOT NULL REFERENCES batch_document_versions(id),
    input_sha256 TEXT NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
    input_byte_length INTEGER NOT NULL CHECK(input_byte_length>0 AND input_byte_length<=26214400),
    document_version TEXT NOT NULL CHECK(document_version ~ '^[a-f0-9]{64}$'),
    list_hash TEXT NOT NULL, batch_revision TEXT NOT NULL,
    credential_version_id UUID NOT NULL, profile_version TEXT NOT NULL,
    trust_store_version TEXT NOT NULL CHECK(trust_store_version ~ '^[a-f0-9]{64}$'),
    expected_cnpj TEXT NOT NULL CHECK(expected_cnpj='15883671000115'),
    certificate_fingerprint_sha256 TEXT NOT NULL CHECK(certificate_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
    policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
    policy_fingerprint TEXT NOT NULL CHECK(policy_fingerprint ~ '^[a-f0-9]{64}$'),
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','validating','succeeded','failed','stale','cancelled')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    lease_token UUID, lease_until TIMESTAMPTZ,
    error_code TEXT CHECK(error_code IS NULL OR error_code IN ('signing_failed','validation_failed','worker_unavailable','result_uncertain','input_mismatch','authorization_changed','policy_changed','document_changed','attempt_limit')),
    output_version_id UUID REFERENCES batch_document_versions(id),
    output_sha256 TEXT CHECK(output_sha256 IS NULL OR output_sha256 ~ '^[a-f0-9]{64}$'),
    validation_report_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(actor_id,request_id),
    UNIQUE(batch_id,input_artifact_version_id,credential_version_id,profile_version,authorization_id),
    CHECK(authorization_expires_at>authorized_at AND authorization_expires_at<=authorized_at+interval '10 minutes'),
    CHECK((state IN ('running','validating') AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
      OR (state NOT IN ('running','validating') AND lease_token IS NULL AND lease_until IS NULL)),
    CHECK((state='succeeded' AND output_version_id IS NOT NULL AND output_sha256 IS NOT NULL AND validation_report_id IS NOT NULL)
      OR (state<>'succeeded' AND output_version_id IS NULL AND output_sha256 IS NULL AND validation_report_id IS NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS batch_a1_active_batch ON batch_a1_jobs(batch_id) WHERE state IN ('queued','running','validating');
  CREATE INDEX IF NOT EXISTS batch_a1_actor_requests ON batch_a1_jobs(actor_id,created_at);
  CREATE OR REPLACE FUNCTION preserve_batch_a1_binding() RETURNS trigger LANGUAGE plpgsql AS $a1_binding$
  BEGIN
    IF (to_jsonb(NEW)-ARRAY['state','revision','attempts','lease_token','lease_until','error_code','output_version_id','output_sha256','validation_report_id','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','attempts','lease_token','lease_until','error_code','output_version_id','output_sha256','validation_report_id','updated_at'])
      THEN RAISE EXCEPTION 'batch_a1_binding_immutable'; END IF;
    RETURN NEW;
  END; $a1_binding$;
  DO $a1_trigger$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='batch_a1_jobs'::regclass AND tgname='batch_a1_binding_immutable') THEN
      CREATE TRIGGER batch_a1_binding_immutable BEFORE UPDATE ON batch_a1_jobs FOR EACH ROW EXECUTE FUNCTION preserve_batch_a1_binding();
    END IF;
  END; $a1_trigger$;
`;

export type A1ServerPolicy = {
  version: 1; revision: number; enabled: boolean; credentialActive: boolean;
  credentialVersionId: string; profileVersion: "pades-basic-unhomologated-v1";
  trustStoreVersion: string; expectedCnpj: "15883671000115"; certificateFingerprintSha256: string;
};
export type A1JobState = "queued" | "running" | "validating" | "succeeded" | "failed" | "stale" | "cancelled";
export type A1JobMetadata = A1WorkerBinding & {
  batchId: number; inputByteLength: number; listHash: string; state: A1JobState;
  revision: number; attempts: number; policyRevision: number;
  authorizationExpiresAt: string; leaseUntil: string | null; errorCode: string | null;
  createdAt: string; updatedAt: string;
};
type Actor = Pick<SessaoAdmin, "userId" | "email" | "sessaoId">;
type JobRow = {
  id: string; batch_id: number; request_fingerprint: string; actor_id: number; actor_email: string; session_id: number;
  input_artifact_version_id: string; input_sha256: string; input_byte_length: number; document_version: string;
  list_hash: string; credential_version_id: string; profile_version: "pades-basic-unhomologated-v1";
  trust_store_version: string; expected_cnpj: "15883671000115"; certificate_fingerprint_sha256: string;
  policy_revision: number; policy_fingerprint: string; state: A1JobState; revision: number; attempts: number;
  authorization_expires_at: Date; lease_token: string | null; lease_until: Date | null; error_code: string | null;
  created_at: Date; updated_at: Date;
};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isInteger(v) && Number(v)>0 && Number(v)<=2147483647;
const digest = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const error = (code: string) => ({ ok: false as const, error: code });
const iso = (d: Date) => d.toISOString();
function metadata(j: JobRow): A1JobMetadata {
  return { jobId:j.id,batchId:j.batch_id,inputArtifactVersionId:j.input_artifact_version_id,inputSha256:j.input_sha256,
    inputByteLength:j.input_byte_length,documentVersion:j.document_version,listHash:j.list_hash,
    credentialVersionId:j.credential_version_id,profileVersion:j.profile_version,trustStoreVersion:j.trust_store_version,
    expectedCnpj:j.expected_cnpj,certificateFingerprintSha256:j.certificate_fingerprint_sha256,
    state:j.state,revision:j.revision,attempts:j.attempts,policyRevision:j.policy_revision,
    authorizationExpiresAt:iso(j.authorization_expires_at),leaseUntil:j.lease_until?iso(j.lease_until):null,
    errorCode:j.error_code,createdAt:iso(j.created_at),updatedAt:iso(j.updated_at) };
}
async function bounded(c: PoolClient) {
  await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
}
async function authorized(c: PoolClient, actor: Actor | null) {
  if (!integer(actor?.sessaoId) || !await authorizeBatchActor(c,actor!)) return null;
  return (await c.query<{ expires_at: Date }>(
    "SELECT LEAST(expira_em,stepup_ate,clock_timestamp()+interval '10 minutes') expires_at FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() AND stepup_ate>clock_timestamp() FOR SHARE",
    [actor!.sessaoId,actor!.userId])).rows[0] ?? null;
}
/** Only trusted server settings are read; no request can enable signing or choose credential paths. */
async function policy(c: PoolClient): Promise<A1ServerPolicy | null> {
  if (process.env.BATCH_A1_ENABLED !== "1") return null;
  const row=(await c.query<{value:string}>("SELECT value FROM settings WHERE key=$1 FOR SHARE",[BATCH_A1_POLICY_KEY])).rows[0];
  try {
    const p=row&&JSON.parse(row.value);
    if (!p || Array.isArray(p) || Object.keys(p).sort().join(',')!==['version','revision','enabled','credentialActive','credentialVersionId','profileVersion','trustStoreVersion','expectedCnpj','certificateFingerprintSha256'].sort().join(',') || p.version!==1 || !integer(p.revision) || p.enabled!==true || p.credentialActive!==true || !uuid(p.credentialVersionId) || p.profileVersion!=="pades-basic-unhomologated-v1" || !sha(p.trustStoreVersion) || p.expectedCnpj!=="15883671000115" || !sha(p.certificateFingerprintSha256)) return null;
    return {version:1,revision:p.revision,enabled:true,credentialActive:true,credentialVersionId:p.credentialVersionId,profileVersion:p.profileVersion,trustStoreVersion:p.trustStoreVersion,expectedCnpj:p.expectedCnpj,certificateFingerprintSha256:p.certificateFingerprintSha256};
  } catch { return null; }
}
async function currentDocument(c: PoolClient, batchId: number) {
  const b=(await c.query<ApprovalRow & {batch_revision:string}>("SELECT *,xmin::text batch_revision FROM batches WHERE id=$1 FOR UPDATE",[batchId])).rows[0];
  if (!b || !['prepared','failed'].includes(b.status) || b.approved_at || b.sent_at || !b.pdf || !sha(b.pdf_sha256) || b.pdf.length>A1_MAX_PDF_BYTES || digest(b.pdf)!==b.pdf_sha256 || b.pdf.subarray(0,5).toString()!=="%PDF-") return null;
  const original=(await c.query<{id:string;bytes:Buffer;sha256:string}>("SELECT id,bytes,sha256 FROM batch_document_versions WHERE batch_id=$1 AND variant='original' AND sha256=$2 AND list_hash=$3 ORDER BY ordinal DESC LIMIT 1 FOR SHARE",[batchId,b.pdf_sha256,b.list_hash])).rows[0];
  if (!original || !original.bytes.equals(b.pdf) || digest(original.bytes)!==original.sha256) return null;
  return { batch:b, original, version:documentVersion(b) };
}
async function stale(c: PoolClient,j: JobRow,code: "authorization_changed"|"policy_changed"|"document_changed"|"attempt_limit") {
  await c.query("UPDATE batch_a1_jobs SET state='stale',revision=revision+1,lease_token=NULL,lease_until=NULL,error_code=$2,updated_at=clock_timestamp() WHERE id=$1",[j.id,code]);
  await audit("batch_a1_job_stale",null,{jobId:j.id,batchId:j.batch_id,reason:code},c);
  return error("stale");
}

export type AdmitA1Job = { batchId:number; requestId:string; expectedDocumentVersion:string; expectedPolicyRevision:number };
/** Explicit administrative intent only. No signing/network/provider call occurs in this transaction. */
export async function admitA1Job(input: AdmitA1Job, actor: Actor | null) {
  if (!input || Object.keys(input).sort().join(',')!==['batchId','requestId','expectedDocumentVersion','expectedPolicyRevision'].sort().join(',') || !integer(input.batchId) || !uuid(input.requestId) || !sha(input.expectedDocumentVersion) || !integer(input.expectedPolicyRevision)) return error("parameters");
  return tx(async c=>{
    await bounded(c);const auth=await authorized(c,actor);if(!auth)return error("forbidden");
    const p=await policy(c);if(!p)return error("disabled");
    const fingerprint=digest(JSON.stringify([input.batchId,input.requestId,input.expectedDocumentVersion,input.expectedPolicyRevision]));
    const existing=(await c.query<JobRow>("SELECT * FROM batch_a1_jobs WHERE actor_id=$1 AND request_id=$2 FOR UPDATE",[actor!.userId,input.requestId])).rows[0];
    if(existing)return existing.request_fingerprint===fingerprint?{ok:true as const,job:metadata(existing),replayed:true}:error("request_conflict");
    if(p.revision!==input.expectedPolicyRevision)return error("policy_conflict");
    const doc=await currentDocument(c,input.batchId);if(!doc || doc.version!==input.expectedDocumentVersion)return error("document_conflict");
    const active=(await c.query<JobRow>("SELECT * FROM batch_a1_jobs WHERE batch_id=$1 AND state IN ('queued','running','validating') FOR UPDATE",[input.batchId])).rows[0];
    if(active){
      const now=Number((await c.query("SELECT extract(epoch FROM clock_timestamp())*1000 ms")).rows[0].ms);
      if(active.authorization_expires_at.getTime()>now)return error("active_job");
      await stale(c,active,"authorization_changed");
    }
    const id=randomUUID();
    const inserted=(await c.query<JobRow>(`INSERT INTO batch_a1_jobs(id,batch_id,request_id,request_fingerprint,actor_id,actor_email,session_id,authorization_id,authorized_at,authorization_expires_at,
      input_artifact_version_id,input_sha256,input_byte_length,document_version,list_hash,batch_revision,credential_version_id,profile_version,trust_store_version,expected_cnpj,certificate_fingerprint_sha256,policy_revision,policy_fingerprint)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [id,input.batchId,input.requestId,fingerprint,actor!.userId,actor!.email.trim().toLowerCase(),actor!.sessaoId,randomUUID(),auth.expires_at,doc.original.id,doc.original.sha256,doc.original.bytes.length,doc.version,doc.batch.list_hash,doc.batch.batch_revision,p.credentialVersionId,p.profileVersion,p.trustStoreVersion,p.expectedCnpj,p.certificateFingerprintSha256,p.revision,digest(JSON.stringify(p))])).rows[0];
    await audit("batch_a1_job_admitted",null,{jobId:id,batchId:input.batchId,inputArtifactVersionId:doc.original.id,inputSha256:doc.original.sha256,documentVersion:doc.version,credentialVersionId:p.credentialVersionId,policyRevision:p.revision,userId:actor!.userId},c);
    return {ok:true as const,job:metadata(inserted),replayed:false};
  });
}

/** Internal trusted runner, not a public request handler. Root must authenticate any future worker transport. */
export async function claimA1Job(jobId: string, expectedRevision: number) {
  if(!uuid(jobId)||!integer(expectedRevision))return error("parameters");
  return tx(async c=>{
    await bounded(c);const seen=(await c.query<JobRow>("SELECT * FROM batch_a1_jobs WHERE id=$1",[jobId])).rows[0];if(!seen)return error("not_found");
    const auth=await authorized(c,{userId:seen.actor_id,email:seen.actor_email,sessaoId:seen.session_id});
    const p=await policy(c);const doc=await currentDocument(c,seen.batch_id);
    const j=(await c.query<JobRow>("SELECT * FROM batch_a1_jobs WHERE id=$1 FOR UPDATE",[jobId])).rows[0];
    if(j.revision!==expectedRevision)return error("conflict");
    if(!['queued','running','validating'].includes(j.state))return error("not_claimable");
    const now=Number((await c.query("SELECT extract(epoch FROM clock_timestamp())*1000 ms")).rows[0].ms);
    if(!auth||j.authorization_expires_at.getTime()<=now)return stale(c,j,"authorization_changed");
    if(!p||digest(JSON.stringify(p))!==j.policy_fingerprint)return stale(c,j,"policy_changed");
    if(!doc||doc.version!==j.document_version||doc.original.id!==j.input_artifact_version_id||doc.original.sha256!==j.input_sha256||doc.original.bytes.length!==j.input_byte_length)return stale(c,j,"document_changed");
    if(j.lease_until&&j.lease_until.getTime()>now)return error("busy");
    if(j.attempts>=3)return stale(c,j,"attempt_limit");
    const token=randomUUID();
    const row=(await c.query<JobRow>("UPDATE batch_a1_jobs SET state='running',revision=revision+1,attempts=attempts+1,lease_token=$2,lease_until=LEAST(clock_timestamp()+interval '120 seconds',authorization_expires_at),error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 AND revision=$3 RETURNING *",[jobId,token,expectedRevision])).rows[0];
    if(!row)return error("conflict");
    await audit("batch_a1_job_claimed",null,{jobId,batchId:j.batch_id,revision:row.revision,attempt:row.attempts,reclaimed:j.state!=='queued'},c);
    const m=metadata(row);
    const binding:A1WorkerBinding={jobId:m.jobId,documentVersion:m.documentVersion,inputArtifactVersionId:m.inputArtifactVersionId,inputSha256:m.inputSha256,credentialVersionId:m.credentialVersionId,profileVersion:m.profileVersion,trustStoreVersion:m.trustStoreVersion,expectedCnpj:m.expectedCnpj,certificateFingerprintSha256:m.certificateFingerprintSha256};
    return {ok:true as const,job:m,binding,leaseToken:token,bytes:Buffer.from(doc.original.bytes)};
  });
}
const failureCodes=["signing_failed","validation_failed","worker_unavailable","result_uncertain","input_mismatch"] as const;
/** Bounded failure metadata only: never store stderr, provider responses, URLs or secret values. */
export async function failA1Job(jobId:string,leaseToken:string,expectedRevision:number,errorCode:typeof failureCodes[number]) {
  if(!uuid(jobId)||!uuid(leaseToken)||!integer(expectedRevision)||!failureCodes.includes(errorCode))return error("parameters");
  return tx(async c=>{
    await bounded(c);const seen=(await c.query<JobRow>("SELECT * FROM batch_a1_jobs WHERE id=$1",[jobId])).rows[0];if(!seen)return error("not_found");
    const auth=await authorized(c,{userId:seen.actor_id,email:seen.actor_email,sessaoId:seen.session_id});const p=await policy(c);const doc=await currentDocument(c,seen.batch_id);
    const j=(await c.query<JobRow>("SELECT * FROM batch_a1_jobs WHERE id=$1 FOR UPDATE",[jobId])).rows[0];
    if(j.revision!==expectedRevision||j.lease_token!==leaseToken||!['running','validating'].includes(j.state))return error("conflict");
    const now=Number((await c.query("SELECT extract(epoch FROM clock_timestamp())*1000 ms")).rows[0].ms);
    if(!j.lease_until||j.lease_until.getTime()<=now)return error("lease_expired");
    if(!auth||j.authorization_expires_at.getTime()<=now)return stale(c,j,"authorization_changed");
    if(!p||digest(JSON.stringify(p))!==j.policy_fingerprint)return stale(c,j,"policy_changed");
    if(!doc||doc.version!==j.document_version||doc.original.id!==j.input_artifact_version_id)return stale(c,j,"document_changed");
    const row=(await c.query<JobRow>("UPDATE batch_a1_jobs SET state='failed',revision=revision+1,lease_token=NULL,lease_until=NULL,error_code=$2,updated_at=clock_timestamp() WHERE id=$1 AND revision=$3 AND lease_token=$4 RETURNING *",[jobId,errorCode,expectedRevision,leaseToken])).rows[0];
    if(!row)return error("conflict");
    await audit("batch_a1_job_failed",null,{jobId,batchId:j.batch_id,errorCode,revision:row.revision},c);
    return {ok:true as const,job:metadata(row)};
  });
}

/** Metadata projection excludes source bytes, lease token, authorization token, email and secrets. */
export async function getA1Job(jobId:string,actor:Actor|null) {
  if(!uuid(jobId))return error("parameters");
  return tx(async c=>{
    await bounded(c);if(!await authorized(c,actor))return error("forbidden");
    const j=(await c.query<JobRow>("SELECT * FROM batch_a1_jobs WHERE id=$1",[jobId])).rows[0];
    return j?{ok:true as const,job:metadata(j)}:error("not_found");
  });
}
