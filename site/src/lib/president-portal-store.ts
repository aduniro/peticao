import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { authorizeBatchActor } from "./batches";
import type { SessaoAdmin } from "./admin-users";
import { cifrar } from "./crypto-dados";
import { hmac, safeEqual, sha256 } from "./security";
import { isValidCpf, onlyDigits } from "./cpf";
import { verifyIdentity } from "./identity";
import { defaultProvider, type CpfProvider } from "./cpf-check";
import { normalizeRegistryBirth, parseBirth } from "./birth";
import { config } from "./config";
import { issuePresidentChallenge, confirmPresidentChallenge, presidentDocumentRevision, type PresidentChallengeStore, type PresidentDocumentRevision } from "./president-portal-contract";

const PROFILE = "president_profile_v1";
const unavailable = { ok: false as const, error: "unavailable" as const };
type Profile = { version: 1; revision: number; responsibleId: number; cpfHash: string; whatsappCipher: string | null; enabled: boolean };
type Account = { id: number; nome: string; email: string };
type Challenge = { id: string; batch_id: number; responsible_id: number; issued_by: number; profile_revision: number; responsible_fingerprint: string; document_version: string; password_hash: string; state: string; attempts: number; expires_at: Date; lease_token: string | null; lease_until: Date | null };
const validId = (n: number) => Number.isInteger(n) && n > 0 && n <= 2147483647;
const cpfHash = (cpf: string) => hmac(`president-cpf:v1:${cpf}`);
async function bounded(client: PoolClient) {
  await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
  await client.query("SELECT pg_advisory_xact_lock(7003)");
}
async function authorized(client: PoolClient, actor: SessaoAdmin | null) {
  if (!actor?.sessaoId || !await authorizeBatchActor(client, actor)) return false;
  return !!(await client.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() AND stepup_ate>now() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount;
}
async function profile(client: PoolClient): Promise<Profile | null> {
  const row = (await client.query<{ value: string }>("SELECT value FROM settings WHERE key=$1 FOR SHARE", [PROFILE])).rows[0];
  if (!row) return null;
  try {
    const p = JSON.parse(row.value) as Profile;
    return p.version === 1 && validId(p.revision) && validId(p.responsibleId) && typeof p.enabled === "boolean" && /^[a-f0-9]{64}$/.test(p.cpfHash) && (p.whatsappCipher === null || typeof p.whatsappCipher === "string") ? p : null;
  } catch { return null; }
}
async function account(client: PoolClient, id: number) {
  return (await client.query<Account>("SELECT id,nome,email FROM admin_users WHERE id=$1 AND ativo FOR SHARE", [id])).rows[0] ?? null;
}
const fingerprint = (p: Profile, user: Account) => sha256(JSON.stringify([p.revision, p.responsibleId, p.cpfHash, user.nome, user.email]));

/** Versioned owner configuration. Names/email come from an existing active account. */
export async function configurePresidentProfile(actor: SessaoAdmin, input: { responsibleId: number; cpf?: string; whatsapp?: string; enabled: boolean; expectedRevision: number }) {
  if (!validId(input.responsibleId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 2147483647 || input.cpf !== undefined && (typeof input.cpf !== "string" || input.cpf.length > 20 || !isValidCpf(input.cpf)) || typeof input.enabled !== "boolean" || input.whatsapp !== undefined && (typeof input.whatsapp !== "string" || input.whatsapp.length > 32 || input.whatsapp !== "" && !/^\+[1-9][0-9]{7,14}$/.test(input.whatsapp))) return { ok: false as const, error: "parameters" };
  return tx(async client => {
    await bounded(client);
    if (!await authorized(client, actor)) return { ok: false as const, error: "forbidden" };
    const current = await profile(client), existing = (await client.query("SELECT 1 FROM settings WHERE key=$1", [PROFILE])).rowCount;
    if (existing && !current || (current?.revision ?? 0) !== input.expectedRevision) return { ok: false as const, error: "conflict" };
    if (!await account(client, input.responsibleId)) return { ok: false as const, error: "parameters" };
    const sameResponsible = current?.responsibleId === input.responsibleId;
    if (input.cpf === undefined && !sameResponsible) return { ok: false as const, error: "parameters" };
    const revision = input.expectedRevision + 1;
    const value: Profile = { version: 1, revision, responsibleId: input.responsibleId, cpfHash: input.cpf === undefined ? current!.cpfHash : cpfHash(onlyDigits(input.cpf)), whatsappCipher: input.whatsapp === undefined ? sameResponsible ? current!.whatsappCipher : null : input.whatsapp ? cifrar(input.whatsapp, `president-profile:${input.responsibleId}`) : null, enabled: input.enabled };
    await client.query("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2", [PROFILE, JSON.stringify(value)]);
    await client.query("UPDATE president_challenges SET state='revoked',lease_token=NULL,lease_until=NULL WHERE state IN ('issued','verifying')");
    await audit("president_profile_configured", null, { userId: actor.userId, por: actor.email, responsibleId: value.responsibleId, revision, enabled: value.enabled }, client);
    return { ok: true as const, revision };
  });
}

export async function readPresidentProfile(actor: SessaoAdmin) {
  return tx(async client => {
    await bounded(client);
    if (!await authorized(client, actor)) return { ok: false as const, error: "forbidden" };
    const p = await profile(client), user = p && await account(client, p.responsibleId);
    return { ok: true as const, profile: p && user ? { revision: p.revision, responsibleId: p.responsibleId, name: user.nome, email: user.email, enabled: p.enabled, hasCpf: true, hasWhatsapp: !!p.whatsappCipher } : null };
  });
}

async function document(client: PoolClient, id: number): Promise<PresidentDocumentRevision | null> {
  const row = (await client.query<{ id: number; seq: number; kind: "partial" | "final"; list_hash: string; pdf: Buffer | null; pdf_sha256: string | null; signed_pdf: Buffer | null; signed_pdf_sha256: string | null; signature_kind: string | null }>("SELECT id,seq,kind,list_hash,pdf,pdf_sha256,signed_pdf,signed_pdf_sha256,signature_kind FROM batches WHERE id=$1 AND status IN ('prepared','failed') AND approved_at IS NULL FOR SHARE", [id])).rows[0];
  if (!row?.pdf || !safeEqual(bytesHash(row.pdf), row.pdf_sha256 ?? "") || row.signed_pdf && !safeEqual(bytesHash(row.signed_pdf), row.signed_pdf_sha256 ?? "")) return null;
  return { batchId: row.id, seq: row.seq, kind: row.kind, listHash: row.list_hash, originalPdf: row.pdf, signedPdf: row.signed_pdf, signatureKind: row.signature_kind };
}
const bytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function binding(client: PoolClient, row: Challenge) {
  if (!(await client.query("SELECT 1 FROM admin_users WHERE id=$1 AND ativo AND nivel='total' FOR SHARE", [row.issued_by])).rowCount) return false;
  const p = await profile(client), user = p && await account(client, p.responsibleId);
  if (!p?.enabled || !user || p.responsibleId !== row.responsible_id || p.revision !== row.profile_revision || !safeEqual(fingerprint(p, user), row.responsible_fingerprint)) return false;
  const doc = await document(client, row.batch_id);
  return !!doc && safeEqual(presidentDocumentRevision(doc), row.document_version);
}

/** Actual PostgreSQL state machine. No provider call occurs while holding a transaction. */
export function postgresPresidentChallengeStore(actor: SessaoAdmin | null = null): PresidentChallengeStore {
  return {
    async issue(input) {
      return tx(async client => {
        await bounded(client);
        if (!await authorized(client, actor) || input.issuedBy !== actor!.userId) return false;
        const p = await profile(client), user = p && await account(client, p.responsibleId), doc = await document(client, input.batchId);
        if (!p?.enabled || !user || !doc || p.responsibleId !== input.responsibleId || !safeEqual(presidentDocumentRevision(doc), input.documentVersion)) return false;
        const now = Number((await client.query("SELECT extract(epoch FROM clock_timestamp())*1000 ms")).rows[0].ms);
        if (Math.abs(input.createdAt - now) > 30_000 || input.expiresAt - input.createdAt !== 600_000) return false;
        await client.query("UPDATE president_challenges SET state='revoked',lease_token=NULL,lease_until=NULL WHERE batch_id=$1 AND state IN ('issued','verifying')", [input.batchId]);
        await client.query("INSERT INTO president_challenges(id,batch_id,responsible_id,issued_by,profile_revision,responsible_fingerprint,document_version,token_hash,password_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [input.id,input.batchId,p.responsibleId,input.issuedBy,p.revision,fingerprint(p,user),input.documentVersion,input.tokenHash,input.passwordHash,new Date(input.createdAt).toISOString(),new Date(input.expiresAt).toISOString()]);
        await audit("president_challenge_issued", null, { challengeId: input.id, batchId: input.batchId, responsibleId: p.responsibleId, userId: actor!.userId, por: actor!.email, documentVersion: input.documentVersion, profileRevision: p.revision }, client);
        return true;
      });
    },
    async claim(input) {
      return tx(async client => {
        await bounded(client);
        const row = (await client.query<Challenge>("SELECT * FROM president_challenges WHERE token_hash=$1 FOR UPDATE", [input.tokenHash])).rows[0];
        const now = Date.now();
        if (!row || !["issued", "verifying"].includes(row.state) || row.expires_at.getTime() <= now || row.attempts >= 5 || row.state === "verifying" && row.lease_until!.getTime() > now || !await binding(client,row)) return null;
        const matches = safeEqual(row.password_hash, input.passwordHash), attempts = row.attempts + 1;
        await client.query("UPDATE president_challenges SET attempts=$2,state=$3,lease_token=$4,lease_until=$5 WHERE id=$1", [row.id,attempts,matches ? "verifying" : attempts >= 5 ? "rejected" : "issued",matches ? input.leaseId : null,matches ? new Date(Math.min(now+30_000,row.expires_at.getTime())).toISOString() : null]);
        if (!matches) { await audit("president_challenge_rejected",null,{challengeId:row.id,batchId:row.batch_id,attempt:attempts},client); return null; }
        return { id: row.id, responsibleId: row.responsible_id, documentVersion: row.document_version };
      });
    },
    async finish(input) {
      return tx(async client => {
        await bounded(client);
        const row = (await client.query<Challenge>("SELECT * FROM president_challenges WHERE id=$1 FOR UPDATE", [input.id])).rows[0], now = Date.now();
        if (!row || row.state !== "verifying" || row.lease_token !== input.leaseId || row.lease_until!.getTime() <= now || row.expires_at.getTime() <= now || !safeEqual(row.document_version,input.documentVersion) || !await binding(client,row)) return null;
        const receiptId = input.verified ? randomUUID() : null;
        await client.query("UPDATE president_challenges SET state=$2,lease_token=NULL,lease_until=NULL,receipt_id=$3,confirmed_at=$4 WHERE id=$1", [row.id,input.verified ? "consumed" : row.attempts >= 5 ? "rejected" : "issued",receiptId,input.verified ? new Date(now).toISOString() : null]);
        await audit(input.verified ? "president_document_confirmed" : "president_identity_rejected", null, { challengeId: row.id, batchId: row.batch_id, responsibleId: row.responsible_id, documentVersion: row.document_version, receiptId, assurance: "own-confirmation", icpBrasil: false, govBr: false }, client);
        return receiptId ? { receiptId } : null;
      });
    },
  };
}

export async function issueConfiguredPresidentChallenge(batchId: number, actor: SessaoAdmin, provider: CpfProvider | null = defaultProvider()) {
  if (!validId(batchId) || !provider) return unavailable;
  try {
    const data = await tx(async client => { await bounded(client); if (!await authorized(client,actor)) return null; const p=await profile(client),doc=await document(client,batchId); return p?.enabled && doc ? {document:doc,responsibleId:p.responsibleId,issuedBy:actor.userId} : null; });
    return data ? issuePresidentChallenge(data,{store:postgresPresidentChallengeStore(actor),key:config.pepper()}) : unavailable;
  } catch { return unavailable; }
}

/** Existing identity verifier, with a configured subject binding and ephemeral CPF/birth. */
export async function confirmConfiguredPresidentChallenge(input: { token: string; password: string; cpf: string; birthDate: string }, provider: CpfProvider | null = defaultProvider()) {
  if (!provider) return unavailable;
  try {
    const key = config.pepper();
    return await confirmPresidentChallenge(input,{store:postgresPresidentChallengeStore(),key,verifyIdentity:async value => {
      const p = await tx(async client => { await bounded(client); const p=await profile(client),user=p && await account(client,p.responsibleId); return p?.enabled && user && p.responsibleId===value.responsibleId ? {p,user} : null; });
      if (!p || !isValidCpf(value.cpf) || !safeEqual(cpfHash(value.cpf),p.p.cpfHash)) return false;
      const birth = normalizeRegistryBirth(value.birthDate); if (!birth || !parseBirth(birth)) return false;
      return (await verifyIdentity({cpf:value.cpf,method:"nascimento",value:birth,declaredName:p.user.nome,provider})).ok;
    }});
  } catch { return unavailable; }
}
