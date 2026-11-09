import { tx } from "./db";

export type ContactListOptions = { before?: number; kind?: "duvida" | "bug" | "outro"; search?: string; limit?: number };
export type ContactListRow = { id: number; name: string; email: string; kind: string; message: string; locale: string | null; mailed: boolean; mail_error: string | null; created_at: string };
/** Parse only the documented filters; cursors are positions, never authorization. */
export function contactListOptions(raw: { before?: unknown; kind?: unknown; search?: unknown; limit?: unknown }): ContactListOptions | null {
  const before = raw.before === undefined ? undefined : typeof raw.before === "number" ? raw.before : typeof raw.before === "string" && /^[1-9]\d{0,9}$/.test(raw.before) ? Number(raw.before) : NaN;
  const kind = raw.kind === "" ? undefined : raw.kind;
  const search = raw.search === undefined ? "" : typeof raw.search === "string" ? raw.search.trim() : null;
  const limit = raw.limit ?? 25;
  if (before !== undefined && (!Number.isInteger(before) || before < 1 || before > 2147483647) || kind !== undefined && (typeof kind !== "string" || !["duvida", "bug", "outro"].includes(kind))
    || search === null || search.length > 120 || /[\0\r\n]/.test(search) || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) return null;
  return { before, kind: kind as ContactListOptions["kind"], search, limit: Number(limit) };
}

/** Administrative original-contact list; the server page retains its Edição/session gate. No write or inferred email thread. */
export async function listContactPage(options: ContactListOptions = {}) {
  const parsed = contactListOptions(options);
  if (!parsed) return { ok: false as const, error: "parameters" };
  const pattern = parsed.search ? `%${parsed.search.replace(/[\\%_]/g, "\\$&")}%` : null;
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await c.query("SET LOCAL statement_timeout='3000ms'");
    const filter = "($1::text IS NULL OR kind=$1) AND ($2::text IS NULL OR name ILIKE $2 ESCAPE E'\\\\' OR email ILIKE $2 ESCAPE E'\\\\')";
    const total = (await c.query<{ total: number }>(`SELECT count(*)::int total FROM contact_messages WHERE ${filter}`, [parsed.kind ?? null, pattern])).rows[0].total;
    const rows = (await c.query<ContactListRow>(`SELECT id,name,email,kind,message,locale,mailed,mail_error,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at
      FROM contact_messages WHERE ${filter} AND ($3::int IS NULL OR id<$3) ORDER BY id DESC LIMIT $4`, [parsed.kind ?? null, pattern, parsed.before ?? null, parsed.limit! + 1])).rows;
    const records = rows.slice(0, parsed.limit);
    return { ok: true as const, total, records, nextBefore: rows.length > parsed.limit! ? records[records.length - 1].id : null, limit: parsed.limit! };
  });
}
