import { createHash } from "node:crypto";

/** This is an integrity contract, not signature validation or permission to send. */
export type PackageArtifact = { versionId: string; sha256: string; byteLength: number };
export type BasePetitionArtifact = PackageArtifact & { artifactId: string; validationState: "valid"; method: "gov-br-advanced" };
export type BatchPackageManifest = Readonly<{
  version: 2; batchId: number; documentVersion: string;
  batch: Readonly<PackageArtifact>;
  basePetition: Readonly<BasePetitionArtifact>;
  attachments: readonly Readonly<{ role: "batch" | "petition-base"; versionId: string; sha256: string; byteLength: number; filename: string; contentType: "application/pdf" }>[];
}>;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const number = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const digest = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const artifact = (v: PackageArtifact) => !!v && uuid(v.versionId) && hash(v.sha256) && number(v.byteLength) && v.byteLength <= 25*1024*1024;
const project = (v: PackageArtifact): Readonly<PackageArtifact> => Object.freeze({ versionId: v.versionId, sha256: v.sha256, byteLength: v.byteLength });

/** Descriptors must be resolved from validated immutable storage, never copied from HTTP input. */
export function freezeBatchPackage(input: { batchId: number; documentVersion: string; batch: PackageArtifact; basePetition: BasePetitionArtifact }) {
  if (!input || !number(input.batchId) || input.batchId > 2147483647 || !hash(input.documentVersion) || !artifact(input.batch) || !artifact(input.basePetition) || !uuid(input.basePetition.artifactId) || input.basePetition.validationState !== "valid" || input.basePetition.method !== "gov-br-advanced" || input.batch.versionId === input.basePetition.versionId) return { ok: false as const, error: "package_invalid" as const };
  const batch = project(input.batch);
  const basePetition = Object.freeze({ ...project(input.basePetition), artifactId: input.basePetition.artifactId, validationState: "valid" as const, method: "gov-br-advanced" as const });
  const attachments = Object.freeze([
    Object.freeze({ role: "batch" as const, ...batch, filename: `peticao-plv12-lote-${input.batchId}-assinado.pdf`, contentType: "application/pdf" as const }),
    Object.freeze({ role: "petition-base" as const, versionId: basePetition.versionId, sha256: basePetition.sha256, byteLength: basePetition.byteLength, filename: `peticao-base-${basePetition.versionId}.pdf`, contentType: "application/pdf" as const }),
  ]);
  const manifest: BatchPackageManifest = Object.freeze({ version: 2, batchId: input.batchId, documentVersion: input.documentVersion, batch, basePetition, attachments });
  const canonical = JSON.stringify(manifest);
  return { ok: true as const, manifest, canonical, packageDigest: digest(canonical) };
}

/** Both exact PDFs must fit. No implicit substitution, concatenation or attachment dropping. */
export function verifyBatchPackage(manifest: BatchPackageManifest, packageDigest: string, bytes: ReadonlyMap<string, Buffer>, budget: { maxEncodedBytes: number; reservedEnvelopeBytes: number }) {
  if (!manifest || !budget || !(bytes instanceof Map)) return { ok: false as const, error: "package_invalid" as const };
  const frozen = freezeBatchPackage(manifest);
  if (!frozen.ok || !hash(packageDigest) || frozen.packageDigest !== packageDigest || JSON.stringify(manifest) !== frozen.canonical || !number(budget.maxEncodedBytes) || !Number.isSafeInteger(budget.reservedEnvelopeBytes) || budget.reservedEnvelopeBytes < 0 || budget.reservedEnvelopeBytes >= budget.maxEncodedBytes || bytes.size !== 2) return { ok: false as const, error: "package_invalid" as const };
  let encodedBytes = budget.reservedEnvelopeBytes;
  for (const item of manifest.attachments) {
    const value = bytes.get(item.versionId);
    if (!Buffer.isBuffer(value) || value.length !== item.byteLength || value.subarray(0,5).toString() !== "%PDF-" || digest(value) !== item.sha256) return { ok: false as const, error: "package_bytes_mismatch" as const };
    const base64 = 4*Math.ceil(value.length/3);
    encodedBytes += base64 + 2*Math.ceil(base64/76); // Conservative MIME wrapping allowance.
  }
  return encodedBytes <= budget.maxEncodedBytes ? { ok: true as const, encodedBytes } : { ok: false as const, error: "package_too_large" as const };
}

/** v1 keys remain unchanged elsewhere; v2 binds the complete package to the recipient fingerprint. */
export function batchPackageMessageKey(batchId: number, packageDigest: string, recipientFingerprint: string) {
  if (!number(batchId) || batchId > 2147483647 || !hash(packageDigest) || !hash(recipientFingerprint)) throw new Error("invalid_package_message_key");
  return `batch-send:v2:${batchId}:${packageDigest}:${recipientFingerprint}`;
}
