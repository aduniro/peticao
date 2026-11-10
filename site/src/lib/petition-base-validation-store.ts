import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { TEXT_VERSION } from "@/content/peticao";
import { audit, tx } from "./db";
import { authorizeBatchActor } from "./batches";
import type { SessaoAdmin } from "./admin-users";
import { isVerifiedPetitionBase, petitionBaseValidationReady, petitionBaseValidationPolicyFingerprint, petitionBaseValidationEvidenceDigest, type PetitionBaseValidationBinding } from "./petition-base-validation";
const digest = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const error = (code: "disabled" | "parameters" | "forbidden" | "not_found" | "profile_unavailable" | "profile_conflict" | "invalid_proof") => ({ ok: false as const, error: code });
const enabled = () => process.env.GOVBR_BASE_ENABLED === "1" && petitionBaseValidationReady();
async function authorized(c: PoolClient, actor: SessaoAdmin | null) {
  await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'; SELECT pg_advisory_xact_lock(7003)");
  if (!actor?.sessaoId || !await authorizeBatchActor(c, actor)) return false;
  return !!(await c.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() AND stepup_ate>now() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount;
}
async function binding(c: PoolClient, artifactId: string): Promise<PetitionBaseValidationBinding | null> {
  const row = (await c.query<{ value: string }>("SELECT value FROM settings WHERE key='president_profile_v1' FOR SHARE")).rows[0];
  if (!row) return null;
  let p;
  try { p = JSON.parse(row.value); } catch { return null; }
  if (!p || p.version !== 1 || p.enabled !== true || !id(p.responsibleId) || !id(p.revision) || !hash(p.cpfHash)) return null;
  if (!(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND ativo FOR SHARE", [p.responsibleId])).rowCount) return null;
  return { artifactId, petitionTextVersion: TEXT_VERSION, responsibleId: p.responsibleId, profileRevision: p.revision, expectedSignerCpfHash: p.cpfHash };
}
function bindingFingerprint(v: PetitionBaseValidationBinding) {
  if (!v || Object.keys(v).sort().join(",") !== "artifactId,expectedSignerCpfHash,petitionTextVersion,profileRevision,responsibleId" || !uuid(v.artifactId) || !hash(v.petitionTextVersion) || !id(v.responsibleId) || !id(v.profileRevision) || !hash(v.expectedSignerCpfHash)) return null;
  return digest(JSON.stringify([v.artifactId, v.petitionTextVersion, v.responsibleId, v.profileRevision, v.expectedSignerCpfHash]));
}
async function artifact(c: PoolClient, artifactId: string) {
  const row = (await c.query<{ bytes: Buffer; sha256: string }>("SELECT bytes,sha256 FROM petition_base_artifacts WHERE id=$1 FOR SHARE", [artifactId])).rows[0];
  if (row && digest(row.bytes) !== row.sha256) throw new Error("petition_base_integrity_mismatch");
  return row ?? null;
}
/** Server-only capture for an external check; no transaction is held during that check. No validation/election is implied. */
export async function capturePetitionBaseValidationInput(artifactId: string, actor: SessaoAdmin | null) {
  if (!enabled()) return error("disabled"); if (!uuid(artifactId)) return error("parameters");
  return tx(async c => {
    if (!await authorized(c, actor)) return error("forbidden");
    const current = await binding(c, artifactId); if (!current) return error("profile_unavailable");
    const file = await artifact(c, artifactId); if (!file) return error("not_found");
    return { ok: true as const, bytes: Buffer.from(file.bytes), binding: { ...current } };
  });
}
/** Append verifier evidence only after rechecking live authorization, profile, text, bytes and configuration. */
export async function persistPetitionBaseValidation(input: { binding: PetitionBaseValidationBinding; proof: unknown }, actor: SessaoAdmin | null) {
  if (!enabled()) return error("disabled");
  if (!input || Object.keys(input).sort().join(",") !== "binding,proof" || !bindingFingerprint(input.binding)) return error("parameters");
  const captured = { ...input.binding }, proof = input.proof;
  return tx(async c => {
    if (!await authorized(c, actor)) return error("forbidden");
    if (!enabled()) return error("disabled");
    const current = await binding(c, captured.artifactId);
    if (!current || bindingFingerprint(current) !== bindingFingerprint(captured)) return error("profile_conflict");
    const file = await artifact(c, captured.artifactId); if (!file) return error("not_found");
    if (!isVerifiedPetitionBase(proof, file.bytes, current)) return error("invalid_proof");
    const policyFingerprint = petitionBaseValidationPolicyFingerprint(); if (!policyFingerprint) return error("invalid_proof");
    const report = JSON.stringify(proof.metadata), reportHash = petitionBaseValidationEvidenceDigest(proof.metadata, policyFingerprint), bound = bindingFingerprint(current)!;
    const previous = (await c.query<{ id: string; created_at: Date; created_by: number }>("SELECT id,created_at,created_by FROM petition_base_validations WHERE artifact_id=$1 AND binding_sha256=$2 AND report_sha256=$3", [current.artifactId, bound, reportHash])).rows[0];
    if (previous) return { ok: true as const, validationId: previous.id, artifactId: current.artifactId, sha256: file.sha256, validationState: "valid" as const, method: "gov-br-advanced" as const, usableInPackage: false as const, createdAt: previous.created_at.toISOString(), createdBy: previous.created_by, replayed: true };
    const validationId = randomUUID();
    const saved = (await c.query<{ created_at: Date }>(`INSERT INTO petition_base_validations(id,artifact_id,artifact_sha256,petition_text_version,responsible_id,profile_revision,signer_cpf_hash,binding_sha256,report_sha256,validator_configuration_sha256,report,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING created_at`, [validationId, current.artifactId, file.sha256, current.petitionTextVersion, current.responsibleId, current.profileRevision, current.expectedSignerCpfHash, bound, reportHash, policyFingerprint, report, actor!.userId])).rows[0];
    await audit("petition_base_validated", null, { validationId, artifactId: current.artifactId, sha256: file.sha256, responsibleId: current.responsibleId, profileRevision: current.profileRevision, petitionTextVersion: current.petitionTextVersion, reportSha256: reportHash, userId: actor!.userId }, c);
    return { ok: true as const, validationId, artifactId: current.artifactId, sha256: file.sha256, validationState: "valid" as const, method: "gov-br-advanced" as const, usableInPackage: false as const, createdAt: saved.created_at.toISOString(), createdBy: actor!.userId, replayed: false };
  });
}
