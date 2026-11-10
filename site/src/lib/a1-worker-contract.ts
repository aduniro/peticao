import { createHash } from "node:crypto";

/** Technical worker result only. This module cannot classify an artifact as ICP-Brasil. */
export const A1_MAX_PDF_BYTES = 25 * 1024 * 1024;
export const A1_PROFILE_VERSIONS = ["pades-basic-unhomologated-v1", "pades-ad-rb-declared-unhomologated-v1"] as const;
export type A1ProfileVersion = typeof A1_PROFILE_VERSIONS[number];
export function isA1ProfileVersion(value: unknown): value is A1ProfileVersion {
  return typeof value === "string" && A1_PROFILE_VERSIONS.some(profile => profile === value);
}
/** Pinned public policy artifact: declaration only, not source authentication or homologation. */
export const A1_AD_RB_POLICY = Object.freeze({
  oid: "2.16.76.1.7.1.11.1.3",
  hashSha256: "23e4be4b9b362172e4ebb0e72b86a133ece5aad843d8651c6e38a0ba3f08fc60",
  artifactSha256: "23da544aef71f7a75dc85fa6e17a83875741e4baef41ec178258a5c86ace54dd",
});
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
export type A1WorkerBinding = {
  jobId: string; documentVersion: string; inputArtifactVersionId: string;
  inputSha256: string; credentialVersionId: string; profileVersion: A1ProfileVersion; trustStoreVersion: string; expectedCnpj: "15883671000115"; certificateFingerprintSha256: string;
};
export type A1WorkerReport = {
  version: 1; engine: "pyHanko"; engineVersion: "0.31.0"; integrity: true;
  chainTrusted: true; holderCnpj: "15883671000115"; coverage: "ENTIRE_FILE";
  docmdpOk: true; fingerprintSha256: string; trustStoreVersion: string;
  profile: A1ProfileVersion; signaturePolicy?: typeof A1_AD_RB_POLICY; environment: "synthetic-test" | "production";
  revocation: "not-required-synthetic-test" | "crl-required-validation-passed";
  timestamp: "not-requested"; icpBrasilQualified: false; homologated: false;
};
const bindingKeys = ["jobId", "documentVersion", "inputArtifactVersionId", "inputSha256", "credentialVersionId", "profileVersion", "trustStoreVersion", "expectedCnpj", "certificateFingerprintSha256"] as const;
function validBinding(binding: A1WorkerBinding) {
  return bindingKeys.every(key => typeof binding[key] === "string" &&
    (key === "profileVersion" ? isA1ProfileVersion(binding[key]) : key === "expectedCnpj" ? binding[key] === "15883671000115" : (key === "documentVersion" || key === "inputSha256" || key === "trustStoreVersion" || key === "certificateFingerprintSha256" ? sha : uuid).test(binding[key])));
}
function boundedPdf(bytes: Buffer) {
  return Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= A1_MAX_PDF_BYTES && bytes.subarray(0, 5).toString() === "%PDF-";
}
export function createA1WorkerRequest(binding: A1WorkerBinding, bytes: Buffer) {
  if (!validBinding(binding) || !boundedPdf(bytes) || hash(bytes) !== binding.inputSha256) throw new Error("invalid_a1_worker_input");
  // Explicit projection prevents caller-supplied credential paths from entering the protocol.
  return { version: 1 as const, jobId: binding.jobId, documentVersion: binding.documentVersion, inputArtifactVersionId: binding.inputArtifactVersionId, inputSha256: binding.inputSha256, credentialVersionId: binding.credentialVersionId, profileVersion: binding.profileVersion, trustStoreVersion: binding.trustStoreVersion, expectedCnpj: binding.expectedCnpj, certificateFingerprintSha256: binding.certificateFingerprintSha256, pdfBase64: bytes.toString("base64") };
}
export function parseA1WorkerResponse(raw: string, binding: A1WorkerBinding, original: Buffer):
  { ok: true; bytes: Buffer; sha256: string; report: A1WorkerReport; icpBrasilQualified: false } | { ok: false; error: "a1_worker_unavailable" } {
  const unavailable = { ok: false as const, error: "a1_worker_unavailable" as const };
  if (!validBinding(binding) || !boundedPdf(original) || hash(original) !== binding.inputSha256 ||
      Buffer.byteLength(raw) > Math.ceil(A1_MAX_PDF_BYTES / 3) * 4 + 16_384) return unavailable;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1 || value.ok !== true ||
        !bindingKeys.every(key => value[key] === binding[key]) || typeof value.pdfBase64 !== "string" ||
        typeof value.outputSha256 !== "string" || !sha.test(value.outputSha256)) return unavailable;
    const bytes = Buffer.from(value.pdfBase64, "base64");
    if (!boundedPdf(bytes) || bytes.toString("base64") !== value.pdfBase64 || bytes.length <= original.length ||
        !bytes.subarray(0, original.length).equals(original) || hash(bytes) !== value.outputSha256) return unavailable;
    const report = value.report;
    const allowedResponse = ["version", "ok", ...bindingKeys, "outputSha256", "pdfBase64", "report"];
    if (Object.keys(value).some(key => !allowedResponse.includes(key))) return unavailable;
    const allowedReport = ["version", "engine", "engineVersion", "integrity", "chainTrusted", "holderCnpj", "coverage", "docmdpOk", "fingerprintSha256", "trustStoreVersion", "profile", "environment", "revocation", "timestamp", "icpBrasilQualified", "homologated", "signaturePolicy"];
    if (report && Object.keys(report).some(key => !allowedReport.includes(key))) return unavailable;
    if (binding.profileVersion === "pades-ad-rb-declared-unhomologated-v1") {
      const policy = report?.signaturePolicy;
      if (!policy || typeof policy !== "object" || Array.isArray(policy) || Object.keys(policy).sort().join(",") !== "artifactSha256,hashSha256,oid" || policy.oid !== A1_AD_RB_POLICY.oid || policy.hashSha256 !== A1_AD_RB_POLICY.hashSha256 || policy.artifactSha256 !== A1_AD_RB_POLICY.artifactSha256) return unavailable;
    } else if (report && Object.prototype.hasOwnProperty.call(report, "signaturePolicy")) return unavailable;
    if (!report || Array.isArray(report) || report.version !== 1 || report.engine !== "pyHanko" ||
        report.engineVersion !== "0.31.0" || report.integrity !== true || report.chainTrusted !== true ||
        report.holderCnpj !== "15883671000115" || report.coverage !== "ENTIRE_FILE" || report.docmdpOk !== true ||
        typeof report.fingerprintSha256 !== "string" || !sha.test(report.fingerprintSha256) ||
        typeof report.trustStoreVersion !== "string" || !sha.test(report.trustStoreVersion) || report.trustStoreVersion !== binding.trustStoreVersion || report.fingerprintSha256 !== binding.certificateFingerprintSha256 ||
        report.profile !== binding.profileVersion || !["synthetic-test", "production"].includes(report.environment) ||
        report.revocation !== (report.environment === "synthetic-test" ? "not-required-synthetic-test" : "crl-required-validation-passed") ||
        report.timestamp !== "not-requested" || report.icpBrasilQualified !== false || report.homologated !== false) return unavailable;
    return { ok: true, bytes, sha256: value.outputSha256, report, icpBrasilQualified: false };
  } catch { return unavailable; }
}
