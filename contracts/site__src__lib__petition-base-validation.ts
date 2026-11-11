import { createHash } from "node:crypto";
import { hmac, safeEqual } from "./security";
import { isValidCpf } from "./cpf";
import { postBoundedValidationPdf } from "./petition-base-validation-http";

/** Our configured adapter contract, not a claim about the public ITI API. */
export type PetitionBaseValidationBinding = Readonly<{
  artifactId: string; petitionTextVersion: string; responsibleId: number; profileRevision: number; expectedSignerCpfHash: string;
}>;
export type PetitionBaseValidationMetadata = Readonly<{
  protocol: "peticao-base-validation"; version: 1; valid: true; sha256: string;
  method: "gov-br-advanced"; signerCpfHash: string; certificateFingerprintSha256: string;
  integrity: true; govBrChainTrusted: true; coverage: "entire-file"; modificationsAllowed: true;
  revocation: "good"; profile: string; validatedAt: string; validatorVersion: string;
}>;
const capability: unique symbol = Symbol("verified-petition-base");
export type VerifiedPetitionBase = Readonly<{ readonly [capability]: true; metadata: PetitionBaseValidationMetadata }>;
const proofs = new WeakMap<object, { binding: string; sha256: string; configuration: string }>();
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const digest = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const name = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,99}$/.test(v);
const unavailable = { ok: false as const, error: "base_validation_unavailable" as const };
const rejected = { ok: false as const, error: "base_validation_rejected" as const };
function bindingHash(v: PetitionBaseValidationBinding) {
  if (!v || Object.keys(v).sort().join(",") !== "artifactId,expectedSignerCpfHash,petitionTextVersion,profileRevision,responsibleId" || !uuid(v.artifactId) || !hash(v.petitionTextVersion) || !hash(v.expectedSignerCpfHash) || !id(v.responsibleId) || !id(v.profileRevision)) return null;
  return digest(JSON.stringify([v.artifactId, v.petitionTextVersion, v.responsibleId, v.profileRevision, v.expectedSignerCpfHash]));
}
function configuration() {
  if (process.env.GOVBR_BASE_VALIDATION_ENABLED !== "1") return null;
  const raw = process.env.GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES, urlValue = process.env.GOVBR_BASE_VALIDATOR_URL, token = process.env.GOVBR_BASE_VALIDATOR_TOKEN || null;
  if (!raw || raw.length > 4096 || !urlValue || urlValue.length > 2048 || token && (token.length > 4096 || /[\u0000-\u001f\u007f]/.test(token))) return null;
  try {
    const url = new URL(urlValue); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash || url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    const accepted: unknown = JSON.parse(raw);
    if (!Array.isArray(accepted) || !accepted.length || accepted.length > 32 || !accepted.every(v => name(v) && !v.startsWith("pades-") && v !== "icp-brasil")) return null;
    const profiles = [...new Set(accepted as string[])].sort();
    return { url: url.href, token, profiles, fingerprint: digest(JSON.stringify([url.href, token && digest(token), profiles])) };
  } catch { return null; }
}
function fresh(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  const at = Date.parse(v), now = Date.now(); return Number.isFinite(at) && new Date(at).toISOString() === v && now - at <= 300_000 && at - now <= 30_000;
}
const pdf = (bytes: Buffer) => Buffer.isBuffer(bytes) && bytes.length >= 16 && bytes.length <= 25 * 1024 * 1024 && bytes.subarray(0, 5).toString() === "%PDF-";
const keys = ["protocol", "version", "valid", "sha256", "method", "signerCpf", "certificateFingerprintSha256", "integrity", "govBrChainTrusted", "coverage", "modificationsAllowed", "revocation", "profile", "validatedAt", "validatorVersion"];
export const petitionBaseValidationReady = () => configuration() !== null;

/** Only checks exact bytes and signer against a configured trusted verifier. No selection, modification, signing or sending. */
export async function verifyPetitionBasePdf(bytes: Buffer, binding: PetitionBaseValidationBinding, fetcher: typeof fetch = fetch) {
  const config = configuration(), bound = bindingHash(binding);
  if (!config || !bound || !pdf(bytes)) return unavailable;
  const snapshot = Buffer.from(bytes), sha256 = digest(snapshot), expectedCpfHash = binding.expectedSignerCpfHash;
  const report = await postBoundedValidationPdf({ url: config.url, token: config.token, bytes: snapshot }, fetcher);
  if (!report || typeof report !== "object" || Array.isArray(report)) return unavailable;
  const v = report as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) || v.protocol !== "peticao-base-validation" || v.version !== 1 || v.valid !== true || v.sha256 !== sha256 || v.method !== "gov-br-advanced" || typeof v.signerCpf !== "string" || !/^[0-9]{11}$/.test(v.signerCpf) || !isValidCpf(v.signerCpf) || !safeEqual(hmac("president-cpf:v1:" + v.signerCpf), expectedCpfHash) || !hash(v.certificateFingerprintSha256) || v.integrity !== true || v.govBrChainTrusted !== true || v.coverage !== "entire-file" || v.modificationsAllowed !== true || v.revocation !== "good" || typeof v.profile !== "string" || !config.profiles.includes(v.profile) || !fresh(v.validatedAt) || !name(v.validatorVersion)) return rejected;
  if (configuration()?.fingerprint !== config.fingerprint || bindingHash(binding) !== bound || digest(bytes) !== sha256) return rejected;
  const metadata: PetitionBaseValidationMetadata = Object.freeze({ protocol: "peticao-base-validation", version: 1, valid: true, sha256, method: "gov-br-advanced", signerCpfHash: expectedCpfHash, certificateFingerprintSha256: v.certificateFingerprintSha256, integrity: true, govBrChainTrusted: true, coverage: "entire-file", modificationsAllowed: true, revocation: "good", profile: v.profile, validatedAt: v.validatedAt, validatorVersion: v.validatorVersion });
  const proof: VerifiedPetitionBase = Object.freeze({ [capability]: true as const, metadata });
  proofs.set(proof, { binding: bound, sha256, configuration: config.fingerprint });
  return { ok: true as const, proof };
}
export function isVerifiedPetitionBase(proof: unknown, bytes: Buffer, binding: PetitionBaseValidationBinding): proof is VerifiedPetitionBase {
  if (!proof || typeof proof !== "object" || !pdf(bytes)) return false;
  const record = proofs.get(proof); if (!record) return false;
  return record.binding === bindingHash(binding) && record.sha256 === digest(bytes) && record.configuration === configuration()?.fingerprint && fresh((proof as VerifiedPetitionBase).metadata.validatedAt);
}

/** Internal policy identity; never returns a URL or token. A changed verifier requires fresh evidence. */
export const petitionBaseValidationPolicyFingerprint = () => configuration()?.fingerprint ?? null;
/** JSONB may reorder keys. Hash a canonical semantic report together with its verifier policy. */
export function petitionBaseValidationEvidenceDigest(metadata: PetitionBaseValidationMetadata, policyFingerprint: string) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  return digest(JSON.stringify([canonical, policyFingerprint]));
}
/** Accepts only an immutable receipt previously written by the internal verifier, not an HTTP report. */
export function isCurrentStoredPetitionBaseEvidence(metadata: unknown, binding: PetitionBaseValidationBinding, artifactSha256: string, policyFingerprint: string | null, reportDigest: string) {
  const config = configuration();
  if (!config || policyFingerprint !== config.fingerprint || !bindingHash(binding) || !hash(artifactSha256) || !hash(reportDigest) || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const v = metadata as Record<string, unknown>;
  const storedKeys = keys.map(k => k === "signerCpf" ? "signerCpfHash" : k);
  if (Object.keys(v).length !== storedKeys.length || Object.keys(v).some(k => !storedKeys.includes(k)) || v.protocol !== "peticao-base-validation" || v.version !== 1 || v.valid !== true || v.sha256 !== artifactSha256 || v.method !== "gov-br-advanced" || v.signerCpfHash !== binding.expectedSignerCpfHash || !hash(v.certificateFingerprintSha256) || v.integrity !== true || v.govBrChainTrusted !== true || v.coverage !== "entire-file" || v.modificationsAllowed !== true || v.revocation !== "good" || typeof v.profile !== "string" || !config.profiles.includes(v.profile) || !fresh(v.validatedAt) || !name(v.validatorVersion)) return false;
  return petitionBaseValidationEvidenceDigest(v as unknown as PetitionBaseValidationMetadata, config.fingerprint) === reportDigest;
}
