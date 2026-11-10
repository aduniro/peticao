import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { TEXT_VERSION } from "@/content/peticao";
import { audit, tx } from "./db";
import { authorizeBatchActor } from "./batches";
import type { SessaoAdmin } from "./admin-users";
import { petitionBaseValidationReady, petitionBaseValidationPolicyFingerprint, isCurrentStoredPetitionBaseEvidence, type PetitionBaseValidationBinding } from "./petition-base-validation";
const digest = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const error = (code: "disabled" | "parameters" | "forbidden" | "not_found" | "request_conflict" | "revision_conflict" | "validation_unavailable" | "profile_conflict") => ({ ok: false as const, error: code });
async function authorized(c: PoolClient, actor: SessaoAdmin | null) {
  await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'; SELECT pg_advisory_xact_lock(7003)");
  if (!actor?.sessaoId || !await authorizeBatchActor(c, actor)) return false;
  return !!(await c.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() AND stepup_ate>clock_timestamp() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount;
}
async function currentBinding(c: PoolClient, artifactId: string): Promise<PetitionBaseValidationBinding | null> {
  const row = (await c.query<{ value: string }>("SELECT value FROM settings WHERE key='president_profile_v1' FOR SHARE")).rows[0]; if (!row) return null;
  let value; try { value = JSON.parse(row.value); } catch { return null; }
  if (!value || value.version !== 1 || value.enabled !== true || !id(value.responsibleId) || !id(value.revision) || !hash(value.cpfHash)) return null;
  if (!(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND ativo FOR SHARE", [value.responsibleId])).rowCount) return null;
  return { artifactId, petitionTextVersion: TEXT_VERSION, responsibleId: value.responsibleId, profileRevision: value.revision, expectedSignerCpfHash: value.cpfHash };
}
const bindingFingerprint = (b: PetitionBaseValidationBinding) => digest(JSON.stringify([b.artifactId, b.petitionTextVersion, b.responsibleId, b.profileRevision, b.expectedSignerCpfHash]));
type Selection = { id: string; revision: number; previous_revision: number | null; validation_id: string; artifact_id: string; artifact_sha256: string; petition_text_version: string; responsible_id: number; profile_revision: number; validator_configuration_sha256: string; request_id: string; request_fingerprint: string; actor_id: number; created_at: Date };
const projection = (r: Selection) => ({ selectionId: r.id, revision: r.revision, previousRevision: r.previous_revision, validationId: r.validation_id, artifactId: r.artifact_id, sha256: r.artifact_sha256, petitionTextVersion: r.petition_text_version, responsibleId: r.responsible_id, profileRevision: r.profile_revision, createdBy: r.actor_id, createdAt: r.created_at.toISOString(), usableInPackage: false as const });
/** An old or out-of-order response must resolve its own intent, never today's latest selection. */
export async function getPetitionBaseSelectionRequest(requestId: string, actor: SessaoAdmin | null) {
  if (!uuid(requestId)) return error("parameters");
  return tx(async c => {
    if (!await authorized(c, actor)) return error("forbidden");
    const row = (await c.query<Selection>("SELECT * FROM petition_base_selections WHERE actor_id=$1 AND request_id=$2", [actor!.userId, requestId])).rows[0];
    if (!row) return error("not_found");
    const latest = (await c.query<{ revision: number }>("SELECT revision FROM petition_base_selections ORDER BY revision DESC LIMIT 1")).rows[0];
    return { ok: true as const, requestId, selection: projection(row), isCurrent: latest?.revision === row.revision };
  });
}
/** Explicit review of exact bytes, with CAS and actor-scoped request identity. Never signs, modifies a PDF or sends. */
export async function selectPetitionBase(input: { requestId: string; expectedRevision: number; validationId: string; reviewedSha256: string; expectedTextVersion: string }, actor: SessaoAdmin | null) {
  if (process.env.GOVBR_BASE_ENABLED !== "1" || !petitionBaseValidationReady()) return error("disabled");
  if (!input || Object.keys(input).sort().join(",") !== "expectedRevision,expectedTextVersion,requestId,reviewedSha256,validationId" || !uuid(input.requestId) || !uuid(input.validationId) || !hash(input.reviewedSha256) || !hash(input.expectedTextVersion) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 2147483647) return error("parameters");
  const intent = { ...input }, requestFingerprint = digest(JSON.stringify([input.expectedRevision, input.validationId, input.reviewedSha256, input.expectedTextVersion]));
  return tx(async c => {
    if (!await authorized(c, actor)) return error("forbidden");
    if (process.env.GOVBR_BASE_ENABLED !== "1" || !petitionBaseValidationReady()) return error("disabled");
    const latest = (await c.query<Selection>("SELECT * FROM petition_base_selections ORDER BY revision DESC LIMIT 1")).rows[0];
    const previous = (await c.query<Selection>("SELECT * FROM petition_base_selections WHERE actor_id=$1 AND request_id=$2", [actor!.userId, intent.requestId])).rows[0];
    if (previous) return previous.request_fingerprint === requestFingerprint ? { ok: true as const, selection: projection(previous), isCurrent: previous.revision === latest?.revision, replayed: true } : error("request_conflict");
    if ((latest?.revision ?? 0) !== intent.expectedRevision) return error("revision_conflict");
    if (intent.expectedTextVersion !== TEXT_VERSION) return error("profile_conflict");
    const evidence = (await c.query<{ artifact_id: string; artifact_sha256: string; petition_text_version: string; responsible_id: number; profile_revision: number; binding_sha256: string; report_sha256: string; validator_configuration_sha256: string | null; report: unknown; bytes: Buffer; sha256: string }>("SELECT v.*,a.bytes,a.sha256 FROM petition_base_validations v JOIN petition_base_artifacts a ON a.id=v.artifact_id WHERE v.id=$1 FOR SHARE", [intent.validationId])).rows[0];
    if (!evidence || evidence.artifact_sha256 !== intent.reviewedSha256 || evidence.sha256 !== intent.reviewedSha256 || digest(evidence.bytes) !== intent.reviewedSha256) return error("validation_unavailable");
    const binding = await currentBinding(c, evidence.artifact_id);
    if (!binding || bindingFingerprint(binding) !== evidence.binding_sha256 || evidence.petition_text_version !== TEXT_VERSION || evidence.responsible_id !== binding.responsibleId || evidence.profile_revision !== binding.profileRevision) return error("profile_conflict");
    if (!isCurrentStoredPetitionBaseEvidence(evidence.report, binding, evidence.sha256, evidence.validator_configuration_sha256, evidence.report_sha256)) return error("validation_unavailable");
    const policyFingerprint = petitionBaseValidationPolicyFingerprint(); if (!policyFingerprint) return error("validation_unavailable");
    const selectionId = randomUUID(), revision = intent.expectedRevision + 1;
    const saved = (await c.query<Selection>(`INSERT INTO petition_base_selections(id,revision,previous_revision,validation_id,artifact_id,artifact_sha256,petition_text_version,responsible_id,profile_revision,validator_configuration_sha256,request_id,request_fingerprint,actor_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [selectionId, revision, latest?.revision ?? null, intent.validationId, evidence.artifact_id, evidence.sha256, TEXT_VERSION, binding.responsibleId, binding.profileRevision, policyFingerprint, intent.requestId, requestFingerprint, actor!.userId])).rows[0];
    await audit("petition_base_selected", null, { selectionId, revision, previousRevision: latest?.revision ?? null, validationId: intent.validationId, artifactId: evidence.artifact_id, reviewedSha256: evidence.sha256, petitionTextVersion: TEXT_VERSION, responsibleId: binding.responsibleId, profileRevision: binding.profileRevision, userId: actor!.userId }, c);
    return { ok: true as const, selection: projection(saved), isCurrent: true, replayed: false };
  });
}
/** Metadata read remains available with the verifier disabled; historical decisions never become a new selection. */
export async function currentPetitionBaseSelection(actor: SessaoAdmin | null) {
  if (process.env.GOVBR_BASE_ENABLED !== "1") return error("disabled");
  return tx(async c => {
    if (!await authorized(c, actor)) return error("forbidden");
    const row = (await c.query<Selection>("SELECT * FROM petition_base_selections ORDER BY revision DESC LIMIT 1")).rows[0];
    if (!row) return { ok: true as const, selection: null };
    const binding = await currentBinding(c, row.artifact_id);
    const evidenceBinding = (await c.query<{ binding_sha256: string }>("SELECT binding_sha256 FROM petition_base_validations WHERE id=$1", [row.validation_id])).rows[0]?.binding_sha256;
    const currentBindingMatches = !!binding && bindingFingerprint(binding) === evidenceBinding && row.petition_text_version === TEXT_VERSION && row.responsible_id === binding.responsibleId && row.profile_revision === binding.profileRevision && row.validator_configuration_sha256 === petitionBaseValidationPolicyFingerprint();
    return { ok: true as const, selection: projection(row), currentBindingMatches };
  });
}
