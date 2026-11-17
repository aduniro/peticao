import { createHash } from "node:crypto";
import { materialId, materialRevision, materialVersion, type MaterialVersion } from "./materials-contract";
import { renderMaterialPreview } from "./materials-render";

type Actor = { userId: number; sessaoId: number | null; email: string };
type ReadFailure = { ok: false; error: "disabled" | "parameters" | "forbidden" | "not_found" | "conflict" | "request_conflict" | "archived" };
export type ReadMaterialPreviewHistory = (id: string, actor: Actor | null, before: number | null) => Promise<
  ReadFailure | { ok: true; current: MaterialVersion; versions: MaterialVersion[]; nextBefore: number | null }>;
export function materialPreviewQuery(search: URLSearchParams) {
  if ([...search.keys()].some(k => !["versionId", "revision"].includes(k)) ||
      search.getAll("versionId").length !== 1 || search.getAll("revision").length !== 1) return null;
  const versionId = search.get("versionId"), raw = search.get("revision"), revision = Number(raw);
  return materialId(versionId) && raw !== null && /^[1-9][0-9]{0,9}$/.test(raw) && materialRevision(revision) ? { versionId, revision } : null;
}
function checked(v: MaterialVersion) {
  return materialVersion({ id: v.id, material_id: v.materialId, ordinal: v.revision, content: v.content,
    sha256: v.sha256, archived: v.archived, author_id: v.authorId, created_at: v.createdAt });
}
/** One bounded authenticated history read. Never substitutes the observed head for the requested version. */
export async function prepareMaterialPreview(id: string, search: URLSearchParams, actor: Actor | null, readHistory: ReadMaterialPreviewHistory) {
  const query = materialPreviewQuery(search);
  if (!materialId(id) || !query) return { ok: false as const, error: "parameters" as const };
  try {
    const next = query.revision + 1;
    const history = await readHistory(id, actor, materialRevision(next) ? next : null);
    if (!history.ok) return history;
    if (history.versions.length > 50 || history.versions.some(v => v.materialId !== id)) throw new Error("material_history_integrity");
    const matches = history.versions.filter(v => v.id === query.versionId && v.revision === query.revision);
    if (!matches.length) return { ok: false as const, error: "not_found" as const };
    if (matches.length !== 1) throw new Error("material_history_integrity");
    const version = checked(matches[0]), head = checked(history.current);
    if (head.materialId !== id) throw new Error("material_history_integrity");
    const rendered = renderMaterialPreview(version.content);
    const styles = [...rendered.html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    if (styles.length !== 1 || rendered.contentSha256 !== version.sha256) throw new Error("material_render_integrity");
    const styleHash = createHash("sha256").update(styles[0][1]).digest("base64");
    return { ok: true as const, html: rendered.html, headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", pragma: "no-cache", expires: "0",
      "content-security-policy": `default-src 'none'; script-src 'none'; style-src 'sha256-${styleHash}'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
      "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN", "referrer-policy": "no-referrer",
      "x-material-version-id": version.id, "x-material-version-revision": String(version.revision), "x-material-content-sha256": version.sha256,
      "x-material-preview-scope": "exact-historical-version", "x-material-observed-head-version-id": head.id, "x-material-observed-head-revision": String(head.revision),
    } };
  } catch { return { ok: false as const, error: "unavailable" as const }; }
}
