import { createHash } from "node:crypto";
import { materialId, materialVersion, type MaterialVersion } from "./materials-contract";
import { assessMaterialLayout, materialLayoutProfile, type MaterialLayoutManifest } from "./materials-layout";
import { renderMaterialPreview } from "./materials-render";

export type MaterialExportRequest = { schema: 1; exportId: string; format: "pdf" | "png"; version: MaterialVersion; savedVersionEvidenceSha256: string };
export type MaterialExportResources = { sourceCommit: string; rendererSha256: string; htmlSha256: string; assetSetSha256: string; fontSetSha256: string; browserSha256: string };
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function record(v: unknown, keys: string[]): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype || Object.getOwnPropertySymbols(v).length) return null;
  const d = Object.getOwnPropertyDescriptors(v);
  if (Object.values(d).some(p => !("value" in p)) || Object.keys(d).sort().join(",") !== keys.sort().join(",")) return null;
  return v as Record<string, unknown>;
}
export function materialExportRequest(raw: unknown): MaterialExportRequest | null {
  const r = record(raw, ["schema", "exportId", "format", "version", "savedVersionEvidenceSha256"]);
  const v = r && record(r.version, ["id", "materialId", "revision", "content", "sha256", "archived", "authorId", "createdAt"]);
  if (!r || !v || r.schema !== 1 || !materialId(r.exportId) || r.format !== "pdf" && r.format !== "png" || !hash(r.savedVersionEvidenceSha256)) return null;
  try {
    const version = materialVersion({ id: v.id, material_id: v.materialId, ordinal: v.revision, content: v.content, sha256: v.sha256, archived: v.archived, author_id: v.authorId, created_at: v.createdAt });
    return { schema: 1, exportId: r.exportId, format: r.format as "pdf" | "png", version, savedVersionEvidenceSha256: r.savedVersionEvidenceSha256 };
  } catch { return null; }
}
function resources(raw: unknown): MaterialExportResources {
  const r = record(raw, ["sourceCommit", "rendererSha256", "htmlSha256", "assetSetSha256", "fontSetSha256", "browserSha256"]);
  if (!r || typeof r.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(r.sourceCommit) || ![r.rendererSha256, r.htmlSha256, r.assetSetSha256, r.fontSetSha256, r.browserSha256].every(hash)) throw new Error("material_export_resources_invalid");
  return r as MaterialExportResources;
}
/** Print samples use the same fixed numeric geometry rules, not an assertion of PDF fidelity. */
export function requireMaterialExportFit(raw: unknown, provenance: unknown, screenSamples: unknown, printSamples?: unknown) {
  const request = materialExportRequest(raw); if (!request) throw new Error("material_export_request_invalid");
  const resource = resources(provenance), rendered = renderMaterialPreview(request.version.content), profile = materialLayoutProfile(request.version.content.template);
  if (resource.htmlSha256 !== sha(rendered.html)) throw new Error("material_export_html_integrity");
  const manifest: MaterialLayoutManifest = { version: 1, materialVersionId: request.version.id, template: request.version.content.template,
    contentSha256: request.version.sha256, htmlSha256: resource.htmlSha256, rendererSha256: resource.rendererSha256, assetSetSha256: resource.assetSetSha256, fontSetSha256: resource.fontSetSha256, browserSha256: resource.browserSha256, media: "screen", deviceScaleFactor: 1, viewport: profile.viewport };
  const screen = assessMaterialLayout(manifest, screenSamples);
  if (!screen.fitPassed) throw new Error("material_export_screen_fit_refused");
  const printGeometry = request.format === "pdf" ? assessMaterialLayout(manifest, printSamples) : null;
  if (printGeometry && !printGeometry.fitPassed) throw new Error("material_export_print_geometry_refused");
  if (request.format === "png" && printSamples !== undefined) throw new Error("material_export_unexpected_print_samples");
  return { request, resources: resource, screen, printGeometry, exportReady: false as const };
}
/** Candidate receipt only: bytes, exact saved snapshot and measurements; full format/visual review remains mandatory. */
export function materialExportReceipt(raw: unknown, provenance: unknown, screenSamples: unknown, printSamples: unknown, artifact: Uint8Array) {
  const fit = requireMaterialExportFit(raw, provenance, screenSamples, printSamples), { request } = fit;
  if (!(artifact instanceof Uint8Array) || artifact.byteLength < 16 || artifact.byteLength > 32 * 1024 * 1024) throw new Error("material_export_artifact_size");
  const bytes = Buffer.from(artifact), profile = materialLayoutProfile(request.version.content.template); let pngDimensions: { width: number; height: number } | null = null;
  if (request.format === "png") {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("material_export_png_signature");
    pngDimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (Math.abs(pngDimensions.width - profile.width) > 1 || Math.abs(pngDimensions.height - profile.height) > 1) throw new Error("material_export_png_dimensions");
  } else if (!/^%PDF-(1\.[0-7]|2\.0)/.test(bytes.subarray(0, 12).toString("ascii")) || !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"))) throw new Error("material_export_pdf_signature");
  return { schema: 1, exportId: request.exportId, status: "candidate-awaiting-format-and-visual-review" as const, exportReady: false as const,
    materialId: request.version.materialId, versionId: request.version.id, revision: request.version.revision, contentSha256: request.version.sha256,
    versionSnapshotSha256: sha(JSON.stringify(request.version)), savedVersionEvidenceSha256: request.savedVersionEvidenceSha256,
    format: request.format, artifactSha256: sha(bytes), artifactBytes: bytes.length, pngDimensions, resources: fit.resources,
    screenSamplesSha256: fit.screen.samplesSha256, printSamplesSha256: fit.printGeometry?.samplesSha256 ?? null,
    printGateScope: fit.printGeometry ? "fixed-numeric-layout-rules-on-print-media-not-pdf-fidelity" as const : null,
    cryptographicSignature: "not-performed" as const };
}
