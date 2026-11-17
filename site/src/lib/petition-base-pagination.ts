/** Read-only inventory cursors. They are coordinates, never authorization or signature evidence. */
export type BaseInventoryCursor = { uploadedAt: string; artifactId: string };
export type BaseInventoryArtifact = { artifactId: string; sha256: string; byteLength: number; lastValidationId: string | null; uploadedAt: string };
export type BaseInventoryPage = { artifacts: BaseInventoryArtifact[]; hasMore: boolean; nextCursor: string | null };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function baseInventoryTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(value) || value.startsWith("0000")) return false;
  const milliseconds = value.slice(0, 23) + "Z";
  return Number.isFinite(Date.parse(milliseconds)) && new Date(milliseconds).toISOString() === milliseconds;
}
export function parseBaseInventoryCursor(value: unknown): BaseInventoryCursor | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const match = /^pbase1:(.{27}):([a-f0-9-]{36})$/.exec(value);
  return match && baseInventoryTimestamp(match[1]) && uuid(match[2]) ? { uploadedAt: match[1], artifactId: match[2] } : null;
}
export function baseInventoryCursor(row: BaseInventoryCursor): string {
  if (!baseInventoryTimestamp(row.uploadedAt) || !uuid(row.artifactId)) throw new Error("invalid_base_inventory_cursor");
  return `pbase1:${row.uploadedAt}:${row.artifactId}`;
}
export function compareBaseInventoryRows(a: BaseInventoryCursor, b: BaseInventoryCursor) {
  return a.uploadedAt < b.uploadedAt ? -1 : a.uploadedAt > b.uploadedAt ? 1 : a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0;
}
/** Caller keeps its existing list and cursor on failure. Never accept a response for a replaced cursor. */
export function appendBaseInventoryPage(current: BaseInventoryPage, next: BaseInventoryPage, requestedCursor: string): BaseInventoryPage | null {
  if (!current.hasMore || current.nextCursor !== requestedCursor || !parseBaseInventoryCursor(requestedCursor)) return null;
  const combined = [...current.artifacts], byId = new Map(combined.map((item, index) => [item.artifactId, index]));
  for (const item of next.artifacts) {
    const index = byId.get(item.artifactId);
    if (index !== undefined) {
      const old = combined[index];
      if (old.sha256 !== item.sha256 || old.byteLength !== item.byteLength || old.uploadedAt !== item.uploadedAt) return null;
      // Duplicate immutable bytes are one row; the newest explicit read may update validation metadata.
      combined[index] = { ...item };continue;
    }
    if (combined.length && compareBaseInventoryRows(combined[combined.length - 1], item) <= 0) return null;
    byId.set(item.artifactId, combined.length);combined.push({ ...item });
  }
  if (next.hasMore && (next.nextCursor === requestedCursor || next.nextCursor === null)) return null;
  return { artifacts: combined, hasMore: next.hasMore, nextCursor: next.nextCursor };
}
