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

/** Reserve before external I/O. Pending, failed and unavailable checks invalidate earlier cached proof. */
export async function beginPetitionBaseValidation(artifactId: string, expectedSha256: string, actor: SessaoAdmin | null) {
  if (!enabled()) return error("disabled");
  if (!uuid(artifactId) || !hash(expectedSha256)) return error("parameters");
  return tx(async c => {
    if (!await authorized(c, actor)) return error("forbidden");
    if (!enabled()) return error("disabled");
    const current = await binding(c, artifactId); if (!current) return error("profile_unavailable");
    const file = await artifact(c, artifactId); if (!file) return error("not_found");
    if (file.sha256 !== expectedSha256) return { ok: false as const, error: "document_conflict" as const };
    const policy = petitionBaseValidationPolicyFingerprint(); if (!policy) return error("disabled");
    const attemptId = randomUUID();
    await c.query("INSERT INTO petition_base_validation_attempts(id,artifact_id,artifact_sha256,binding_sha256,validator_configuration_sha256,actor_id) VALUES($1,$2,$3,$4,$5,$6)", [attemptId, artifactId, file.sha256, bindingFingerprint(current), policy, actor!.userId]);
    await audit("petition_base_validation_started", null, { attemptId, artifactId, sha256: file.sha256, userId: actor!.userId }, c);
    return { ok: true as const, attemptId, bytes: Buffer.from(file.bytes), binding: { ...current } };
  });
}
/** Latest START order wins, regardless of the order external responses arrive. Historical proof is preserved. */
export async function effectivePetitionBaseValidationIdTx(c: PoolClient, artifactId: string) {
  const row = (await c.query<{ id: string; state: string | null; validation_id: string | null }>("SELECT a.id,r.state,r.validation_id FROM petition_base_validation_attempts a LEFT JOIN petition_base_validation_results r ON r.attempt_id=a.id WHERE a.artifact_id=$1 ORDER BY a.ordinal DESC LIMIT 1", [artifactId])).rows[0];
  return row ? { journaled: true as const, attemptId: row.id, validationId: row.state === "valid" ? row.validation_id : null } : { journaled: false as const, validationId: null };
}
export async function finishPetitionBaseValidation(attemptId: string, outcome: { state: "valid"; validationId: string } | { state: "rejected" | "unavailable" }, actor: SessaoAdmin | null) {
  if (!uuid(attemptId) || !outcome || !["valid", "rejected", "unavailable"].includes(outcome.state) || (outcome.state === "valid" && !uuid(outcome.validationId))) return error("parameters");
  return tx(async c => {
    if (!await authorized(c, actor)) return error("forbidden");
    const attempt = (await c.query<{ artifact_id: string; artifact_sha256: string; binding_sha256: string; validator_configuration_sha256: string }>("SELECT * FROM petition_base_validation_attempts WHERE id=$1 AND actor_id=$2", [attemptId, actor!.userId])).rows[0];
    if (!attempt) return error("not_found");
    const validationId = outcome.state === "valid" ? outcome.validationId : null;
    if (validationId) {
      const current = await binding(c, attempt.artifact_id);
      if (!enabled() || !current || bindingFingerprint(current) !== attempt.binding_sha256 || petitionBaseValidationPolicyFingerprint() !== attempt.validator_configuration_sha256) return error("profile_conflict");
      if (!(await c.query("SELECT 1 FROM petition_base_validations WHERE id=$1 AND artifact_id=$2 AND artifact_sha256=$3 AND binding_sha256=$4 AND validator_configuration_sha256=$5", [validationId, attempt.artifact_id, attempt.artifact_sha256, attempt.binding_sha256, attempt.validator_configuration_sha256])).rowCount) return error("invalid_proof");
    }
    const previous = (await c.query<{ state: string; validation_id: string | null }>("SELECT state,validation_id FROM petition_base_validation_results WHERE attempt_id=$1", [attemptId])).rows[0];
    if (previous && (previous.state !== outcome.state || previous.validation_id !== validationId)) return error("invalid_proof");
    if (!previous) {
      await c.query("INSERT INTO petition_base_validation_results(attempt_id,state,validation_id) VALUES($1,$2,$3)", [attemptId, outcome.state, validationId]);
      await audit("petition_base_validation_finished", null, { attemptId, artifactId: attempt.artifact_id, state: outcome.state, validationId, userId: actor!.userId }, c);
    }
    const effective = await effectivePetitionBaseValidationIdTx(c, attempt.artifact_id);
    return { ok: true as const, isCurrent: effective.journaled && effective.attemptId === attemptId && effective.validationId === validationId && validationId !== null };
  });
}
