import { createHash } from "node:crypto";
import { readLimitedText } from "./http-body";
import { A1_MAX_PDF_BYTES, A1_AD_RB_POLICY, isA1ProfileVersion, type A1WorkerBinding } from "./a1-worker-contract";

/** Custom adapter v2 contract. This is not the public ITI API protocol. */
export type A1ValidationMetadata = Readonly<{
  protocol: "peticao-a1-validation"; version: 2; valid: true; sha256: string;
  cnpj: "15883671000115"; certificateFingerprintSha256: string;
  integrity: true; icpBrasilChainTrusted: true; coverage: "entire-file";
  modificationsAllowed: true; revocation: "good"; profile: string;
  policyOid: string; validatedAt: string; validatorVersion: string;
}>;
const verifiedA1: unique symbol = Symbol("verified-a1-pdf");
export type VerifiedA1Pdf = Readonly<{ readonly [verifiedA1]: true; metadata: A1ValidationMetadata }>;
export type A1ValidationResult = { ok: true; proof: VerifiedA1Pdf } | { ok: false; error: "a1_validation_unavailable" | "a1_validation_rejected" };
const proofs = new WeakMap<object, { binding: string; sha256: string; configuration: string }>();
const sha = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const unavailable = { ok: false as const, error: "a1_validation_unavailable" as const };
const rejected = { ok: false as const, error: "a1_validation_rejected" as const };
const MAX_AGE_MS = 5 * 60_000;
const MAX_FUTURE_MS = 30_000;
const keys = ["protocol", "version", "valid", "sha256", "cnpj", "certificateFingerprintSha256", "integrity", "icpBrasilChainTrusted", "coverage", "modificationsAllowed", "revocation", "profile", "policyOid", "validatedAt", "validatorVersion"];
const profilePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/;
function isOid(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 128 || !/^[0-2](?:\.(?:0|[1-9][0-9]*)){2,31}$/.test(value)) return false;
  const parts = value.split(".");
  return parts[0] === "2" || BigInt(parts[1]) <= 39n;
}
function bindingDigest(binding: A1WorkerBinding): string | null {
  if (!binding || binding.expectedCnpj !== "15883671000115" || !isA1ProfileVersion(binding.profileVersion)) return null;
  if (![binding.jobId, binding.inputArtifactVersionId, binding.credentialVersionId].every(value => typeof value === "string" && uuid.test(value)) ||
      ![binding.documentVersion, binding.inputSha256, binding.trustStoreVersion, binding.certificateFingerprintSha256].every(value => typeof value === "string" && sha.test(value))) return null;
  return digest(JSON.stringify([binding.jobId, binding.documentVersion, binding.inputArtifactVersionId, binding.inputSha256, binding.credentialVersionId, binding.profileVersion, binding.trustStoreVersion, binding.expectedCnpj, binding.certificateFingerprintSha256]));
}
function validPdf(bytes: Buffer) {
  return Buffer.isBuffer(bytes) && bytes.length > 5 && bytes.length <= A1_MAX_PDF_BYTES && bytes.subarray(0, 5).toString() === "%PDF-";
}
type Configuration = { url: string; token: string | null; accepted: ReadonlyArray<Readonly<{ profile: string; policyOid: string }>>; fingerprint: string };
/** Trusted server policy only: gate and explicit (profile,OID) pairs, never HTTP fields. */
function configuration(): Configuration | null {
  if (process.env.A1_VALIDATION_ENABLED !== "1") return null;
  const raw = process.env.A1_VALIDATION_ACCEPTED_POLICIES;
  const urlValue = process.env.ICP_VALIDATOR_URL;
  const token = process.env.ICP_VALIDATOR_TOKEN || null;
  if (!raw || raw.length > 16_384 || !urlValue || urlValue.length > 2048 || token && (token.length > 4096 || /[\u0000-\u001f\u007f]/.test(token))) return null;
  try {
    const url = new URL(urlValue);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) return null;
    // HTTP is limited to an explicitly configured local validator, not remote plaintext.
    if (url.protocol === "http:" && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) return null;
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || !values.length || values.length > 32) return null;
    const accepted: Array<{ profile: string; policyOid: string }> = [];
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "policyOid,profile" || typeof value.profile !== "string" || !profilePattern.test(value.profile) || !isOid(value.policyOid)) return null;
      // Worker generic output can never be approved by naming it in this allowlist.
      if (isA1ProfileVersion(value.profile)) return null;
      accepted.push({ profile: value.profile, policyOid: value.policyOid });
    }
    accepted.sort((a, b) => `${a.profile}:${a.policyOid}`.localeCompare(`${b.profile}:${b.policyOid}`));
    return { url: url.href, token, accepted, fingerprint: digest(JSON.stringify([url.href, token && digest(token), accepted])) };
  } catch { return null; }
}
function freshUtc(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const at = Date.parse(value), now = Date.now();
  return Number.isFinite(at) && new Date(at).toISOString() === value && now - at <= MAX_AGE_MS && at - now <= MAX_FUTURE_MS;
}

/** Readiness only: no network, file access, certificate use or disclosure of configuration. */
export function a1ValidationReady(): boolean {
  return configuration() !== null;
}

/** Production proof is minted only after the independent configured adapter v2 verifies exact bytes. */
export async function verifyA1Pdf(bytes: Buffer, binding: A1WorkerBinding, fetchImpl: typeof fetch = fetch): Promise<A1ValidationResult> {
  const config = configuration(), bound = bindingDigest(binding);
  if (!config || !bound || !validPdf(bytes)) return unavailable;
  const snapshot = Buffer.from(bytes), outputHash = digest(snapshot), fingerprint = binding.certificateFingerprintSha256;
  try {
    const response = await fetchImpl(config.url, {
      method: "POST", headers: { "content-type": "application/pdf", accept: "application/json", ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
      body: new Uint8Array(snapshot), signal: AbortSignal.timeout(30_000), redirect: "error", cache: "no-store",
    });
    if (!response.ok || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) return unavailable;
    const body = await readLimitedText(response, 64 * 1024);
    if (!body.ok) return rejected;
    const value: unknown = JSON.parse(body.raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return rejected;
    const report = value as Record<string, unknown>;
    if (Object.keys(report).length !== keys.length || Object.keys(report).some(key => !keys.includes(key)) ||
        report.protocol !== "peticao-a1-validation" || report.version !== 2 || report.valid !== true ||
        report.sha256 !== outputHash || report.cnpj !== binding.expectedCnpj ||
        report.certificateFingerprintSha256 !== fingerprint || report.integrity !== true ||
        report.icpBrasilChainTrusted !== true || report.coverage !== "entire-file" ||
        report.modificationsAllowed !== true || report.revocation !== "good" ||
        typeof report.profile !== "string" || typeof report.policyOid !== "string" ||
        !config.accepted.some(pair => pair.profile === report.profile && pair.policyOid === report.policyOid) ||
        binding.profileVersion === "pades-ad-rb-declared-unhomologated-v1" && report.policyOid !== A1_AD_RB_POLICY.oid ||
        !freshUtc(report.validatedAt) || typeof report.validatorVersion !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,99}$/.test(report.validatorVersion)) return rejected;
    // Reject configuration or caller data changed during external verification.
    if (configuration()?.fingerprint !== config.fingerprint || bindingDigest(binding) !== bound || digest(bytes) !== outputHash) return rejected;
    const metadata: A1ValidationMetadata = Object.freeze({
      protocol: "peticao-a1-validation", version: 2, valid: true, sha256: outputHash, cnpj: "15883671000115",
      certificateFingerprintSha256: fingerprint, integrity: true, icpBrasilChainTrusted: true,
      coverage: "entire-file", modificationsAllowed: true, revocation: "good", profile: report.profile,
      policyOid: report.policyOid, validatedAt: report.validatedAt, validatorVersion: report.validatorVersion,
    });
    const proof: VerifiedA1Pdf = Object.freeze({ [verifiedA1]: true as const, metadata });
    proofs.set(proof, { binding: bound, sha256: outputHash, configuration: config.fingerprint });
    return { ok: true, proof };
  } catch { return unavailable; }
}

/** JSON, spread copies, symbol copying and TypeScript casts cannot reconstruct this process-local capability. */
export function isVerifiedA1Pdf(proof: unknown, bytes: Buffer, binding: A1WorkerBinding): proof is VerifiedA1Pdf {
  if (!proof || typeof proof !== "object" || !validPdf(bytes)) return false;
  const record = proofs.get(proof);
  if (!record || (proof as VerifiedA1Pdf)[verifiedA1] !== true) return false;
  return record.binding === bindingDigest(binding) && record.sha256 === digest(bytes) &&
    record.configuration === configuration()?.fingerprint && freshUtc((proof as VerifiedA1Pdf).metadata.validatedAt);
}
