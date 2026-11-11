import { createHash } from "node:crypto";

/** Structured authoring only. Rendering/export/publication are separate, not implemented here. */
export const MATERIAL_TEMPLATES = ["poster-a4-v1", "flyer-mono-cut-v1", "social-square-v1"] as const;
export const MATERIAL_ASSETS = ["adunir", "adunir-andes", "andes"] as const;
export type MaterialContent = {
  template: typeof MATERIAL_TEMPLATES[number];
  assetKey: typeof MATERIAL_ASSETS[number];
  title: string; body: string; callToAction: string; footer: string;
};
export type MaterialMutation =
  | { operation: "create"; requestId: string; content: MaterialContent }
  | { operation: "revise"; requestId: string; materialId: string; expectedRevision: number; content: MaterialContent }
  | { operation: "archive"; requestId: string; materialId: string; expectedRevision: number };
export const materialId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export const materialRevision = (v: unknown): v is number => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 2147483646;
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype &&
    Object.getOwnPropertySymbols(v).length === 0 && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => "value" in d);
}
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(",") === keys.sort().join(",");
function text(v: unknown, max: number, required: boolean) {
  return typeof v === "string" && (!required || v.trim().length > 0) && Buffer.byteLength(v, "utf8") <= max &&
    !/[<>\u0000-\u0008\u000b-\u001f\u007f\ud800-\udfff]/u.test(v);
}
export function materialContent(v: unknown): MaterialContent | null {
  if (!record(v) || !exact(v, ["template", "assetKey", "title", "body", "callToAction", "footer"]) ||
      !MATERIAL_TEMPLATES.includes(v.template as MaterialContent["template"]) || !MATERIAL_ASSETS.includes(v.assetKey as MaterialContent["assetKey"]) ||
      !text(v.title, 240, true) || !text(v.body, v.template === "social-square-v1" ? 1400 : 6000, true) ||
      !text(v.callToAction, 320, true) || !text(v.footer, 600, false)) return null;
  // Exact values are preserved; a renderer must use text nodes and trusted asset mappings.
  return { template: v.template as MaterialContent["template"], assetKey: v.assetKey as MaterialContent["assetKey"], title: v.title as string,
    body: v.body as string, callToAction: v.callToAction as string, footer: v.footer as string };
}
export function materialMutation(v: unknown): MaterialMutation | null {
  if (!record(v) || !materialId(v.requestId)) return null;
  if (v.operation === "create" && exact(v, ["operation", "requestId", "content"])) {
    const content = materialContent(v.content); return content ? { operation: "create", requestId: v.requestId, content } : null;
  }
  if (!materialId(v.materialId) || !materialRevision(v.expectedRevision)) return null;
  if (v.operation === "archive" && exact(v, ["operation", "requestId", "materialId", "expectedRevision"])) return {
    operation: "archive", requestId: v.requestId, materialId: v.materialId, expectedRevision: v.expectedRevision,
  };
  if (v.operation === "revise" && exact(v, ["operation", "requestId", "materialId", "expectedRevision", "content"])) {
    const content = materialContent(v.content); return content ? { operation: "revise", requestId: v.requestId, materialId: v.materialId, expectedRevision: v.expectedRevision, content } : null;
  }
  return null;
}
export const materialDigest = (v: MaterialContent) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const materialRequestDigest = (v: MaterialMutation) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export type MaterialVersion = { id: string; materialId: string; revision: number; content: MaterialContent; sha256: string; archived: boolean; authorId: number; createdAt: string };
export function materialVersion(row: Record<string, unknown>): MaterialVersion {
  const content = materialContent(row.content);
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  if (!materialId(row.id) || !materialId(row.material_id) || !materialRevision(row.ordinal) || !content ||
      typeof row.archived !== "boolean" || !Number.isInteger(row.author_id) || Number(row.author_id) < 1 ||
      typeof createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) || row.sha256 !== materialDigest(content)) throw new Error("material_version_integrity");
  return { id: row.id, materialId: row.material_id, revision: row.ordinal, content, sha256: row.sha256 as string, archived: row.archived,
    authorId: Number(row.author_id), createdAt };
}
export function materialListQuery(search: URLSearchParams): { archived: boolean; before: string | null } | null {
  if ([...search.keys()].some(k => !["archived", "before"].includes(k)) || [...new Set(search.keys())].some(k => search.getAll(k).length !== 1)) return null;
  const archived = search.get("archived"), before = search.get("before");
  return archived !== null && !["0", "1"].includes(archived) || before !== null && !materialId(before) ? null : { archived: archived === "1", before };
}
