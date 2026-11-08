/** Browser-safe response contract. Never import the server-side encryption module into an editor. */
export type SharedDraftView = {
  revision: number; state: "empty" | "stored" | "discarded" | "expired" | "unavailable";
  input: { assunto: string; corpo: string } | null; author: string | null; updatedAt: string | null; expiresAt: string | null;
};
export function parseDraftView(value: unknown): SharedDraftView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, any>;
  if (!Number.isSafeInteger(v.revision) || v.revision < 0 || v.revision > 2147483647 || !["empty", "stored", "discarded", "expired", "unavailable"].includes(v.state)) return null;
  if (v.state === "empty" ? v.revision !== 0 : v.revision === 0) return null;
  if (v.author !== null && (typeof v.author !== "string" || v.author.length > 300)) return null;
  if ([v.updatedAt, v.expiresAt].some(x => x !== null && (typeof x !== "string" || !Number.isFinite(Date.parse(x))))) return null;
  if (v.state === "stored") {
    const i = v.input;
    if (!i || typeof i !== "object" || Array.isArray(i) || typeof i.assunto !== "string" || i.assunto.length > 150 || /[\r\n\0]/.test(i.assunto) || typeof i.corpo !== "string" || i.corpo.length > 5000 || i.corpo.includes("\0")) return null;
  } else if (v.input !== null) return null;
  return { revision: v.revision, state: v.state, input: v.input ? { assunto: v.input.assunto, corpo: v.input.corpo } : null, author: v.author, updatedAt: v.updatedAt, expiresAt: v.expiresAt };
}
