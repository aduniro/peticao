import { audit, tx } from "./db";
import { hmac, safeEqual } from "./security";

type Actor = { userId: number; email: string };
type Stored = { value: string; revision: string };
const version = (row: Stored | undefined, actor: Actor) => hmac("batch-sending-control:v1:" + JSON.stringify([actor.userId, actor.email.trim().toLowerCase(), row?.value ?? null, row?.revision ?? null]));
const enabled = (row: Stored | undefined) => {
  if (row && !["true", "false"].includes(row.value)) throw new Error("sending_configuration_invalid");
  return row?.value !== "false";
};

/** Server-rendered control only; the page authorizes Total. A version is never authorization. */
export async function batchSendingControl(actor: Actor) {
  return tx(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await client.query("SET LOCAL statement_timeout='1500ms'");
    const row = (await client.query<Stored>("SELECT value,xmin::text revision FROM settings WHERE key='sending_enabled'")).rows[0];
    return { enabled: enabled(row), version: version(row, actor) };
  });
}

/** Explicit desired state, current account and read version; no mail/document operation. */
export async function changeBatchSending(desired: unknown, expectedVersion: unknown, actor: Actor) {
  if (typeof desired !== "boolean" || typeof expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(expectedVersion)) return { ok: false as const, error: "parameters" };
  if (!actor || !Number.isInteger(actor.userId) || actor.userId <= 0 || actor.userId > 2147483647 || typeof actor.email !== "string" || actor.email.length > 254) return { ok: false as const, error: "forbidden" };
  return tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
    await client.query("SELECT pg_advisory_xact_lock(7003)");
    if (!(await client.query("SELECT 1 FROM admin_users WHERE id=$1 AND email=$2 AND ativo AND nivel='total' FOR SHARE", [actor.userId, actor.email.trim().toLowerCase()])).rowCount) return { ok: false as const, error: "forbidden" };
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('batch-sending-control'))");
    const row = (await client.query<Stored>("SELECT value,xmin::text revision FROM settings WHERE key='sending_enabled' FOR UPDATE")).rows[0];
    const before = enabled(row);
    if (!safeEqual(expectedVersion, version(row, actor))) return { ok: false as const, error: "conflict" };
    const changed = row
      ? await client.query("UPDATE settings SET value=$1 WHERE key='sending_enabled'", [String(desired)])
      : await client.query("INSERT INTO settings(key,value) VALUES('sending_enabled',$1) ON CONFLICT(key) DO NOTHING RETURNING key", [String(desired)]);
    if (!changed.rowCount) return { ok: false as const, error: "conflict" };
    await audit("sending_toggled", null, { enabled: desired, previous: before, userId: actor.userId, por: actor.email.trim().toLowerCase() }, client);
    return { ok: true as const, enabled: desired };
  });
}
