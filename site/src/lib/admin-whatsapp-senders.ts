import { audit, tx } from "./db";
import { cifrar } from "./crypto-dados";
import { normEmail, type AdminActor } from "./admin-users";
import { normalizarTelefone } from "./whatsapp/telefone";

type Result = { ok: true; id: number; revision: number } | { ok: false; erro: "forbidden" | "label" | "phone" | "limit" | "missing" | "conflict" };
type Change = { action: "toggle" | "remove" | "restore"; id: number; revision: number };
type Sender = { id: number; revision: number; active: boolean; archived_at: Date | null };
const integer = (value: number) => Number.isInteger(value) && value > 0 && value <= 2147483647;
const state = (row: Sender) => ({ revision: row.revision, active: row.active, archived: row.archived_at !== null });

/** Catalogue only. Never contacts a provider or changes the actual WhatsApp sender configuration. */
export async function manageSender(actor: AdminActor, change: Change | { action: "add"; label: string; ddi: unknown; number: unknown }): Promise<Result> {
  if (!integer(actor?.userId) || typeof actor.email !== "string") return { ok: false, erro: "forbidden" };
  let phone = "", label = "";
  if (change.action === "add") {
    label = change.label.trim().slice(0, 60);
    if (!label) return { ok: false, erro: "label" };
    const parsed = normalizarTelefone(change.ddi, change.number);
    if (!parsed.ok) return { ok: false, erro: "phone" };
    phone = parsed.e164;
  } else if (!integer(change.id) || !integer(change.revision)) return { ok: false, erro: "missing" };
  return tx(async c => {
    // Same lock order as account management; also serializes the catalogue capacity check.
    await c.query("SELECT pg_advisory_xact_lock(7003)");
    const owner = await c.query("SELECT id FROM admin_users WHERE id=$1 AND email=$2 AND ativo AND nivel='total' FOR SHARE", [actor.userId, normEmail(actor.email)]);
    if (!owner.rowCount) return { ok: false as const, erro: "forbidden" as const };
    const author = { userId: actor.userId, por: normEmail(actor.email) };
    const capacity = async () => (await c.query("SELECT count(*)::int n FROM whatsapp_senders WHERE archived_at IS NULL")).rows[0].n < 20;
    if (change.action === "add") {
      if (!await capacity()) return { ok: false as const, erro: "limit" as const };
      const row = (await c.query<Sender>("INSERT INTO whatsapp_senders(label,phone_cipher,phone_last4) VALUES($1,'',$2) RETURNING id,revision,active,archived_at", [label, phone.slice(-4)])).rows[0];
      await c.query("UPDATE whatsapp_senders SET phone_cipher=$2 WHERE id=$1", [row.id, cifrar(phone, `wa-sender:${row.id}`)]);
      await audit("whatsapp_sender_added", null, { id: row.id, final: phone.slice(-4), ...author, after: state(row) }, c);
      return { ok: true as const, id: row.id, revision: row.revision };
    }
    const before = (await c.query<Sender>("SELECT id,revision,active,archived_at FROM whatsapp_senders WHERE id=$1 FOR UPDATE", [change.id])).rows[0];
    if (!before) return { ok: false as const, erro: "missing" as const };
    if (before.revision !== change.revision) return { ok: false as const, erro: "conflict" as const };
    if ((change.action === "restore") !== (before.archived_at !== null)) return { ok: false as const, erro: "conflict" as const };
    if (change.action === "restore" && !await capacity()) return { ok: false as const, erro: "limit" as const };
    const expression = change.action === "toggle" ? "active=NOT active" : change.action === "remove" ? "archived_at=now()" : "archived_at=NULL";
    const after = (await c.query<Sender>(`UPDATE whatsapp_senders SET ${expression},revision=revision+1 WHERE id=$1 RETURNING id,revision,active,archived_at`, [change.id])).rows[0];
    const event = change.action === "toggle" ? "whatsapp_sender_toggled" : change.action === "remove" ? "whatsapp_sender_removed" : "whatsapp_sender_restored";
    await audit(event, null, { id: before.id, ...author, before: state(before), after: state(after) }, c);
    return { ok: true as const, id: after.id, revision: after.revision };
  });
}
