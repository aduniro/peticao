import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "../db";
import { hmac } from "../security";
import { ADMIN_CONTENT_RETENTION_DAYS } from "../admin-retention-policy";
import { decryptInbound, encryptInbound, inboundWire } from "./inbound-codec";
import { parseInboundMail, verifyInboundRelay } from "./inbound-contract";

export type InboundRelayConfig = { enabled: boolean; account: string; recipients: readonly string[]; key: Buffer | null };
const fingerprint = (purpose: string, account: string, value: string) => hmac(`mail-inbound:v1:${purpose}:` + JSON.stringify([account, value]));

/** Durable reception only. No reply, model, subprocess, fetch or signer mutation.
 * Header correlation groups messages; it does NOT verify a sender's identity.
 */
export async function acceptInboundMail(raw: Buffer, timestamp: string | null, signature: string | null, configuration: InboundRelayConfig, nowMs = Date.now()) {
  if (!configuration.enabled || !/^[a-zA-Z0-9_-]{1,80}$/.test(configuration.account)) return { ok: false as const, error: "disabled" as const };
  const authentication = verifyInboundRelay(raw, timestamp, signature, configuration.key, nowMs);
  if (!authentication.ok) return authentication;
  const parsed = parseInboundMail(raw, configuration.recipients);
  if (!parsed.ok) return parsed;
  const mail = parsed.mail;
  if (mail.account !== configuration.account) return { ok: false as const, error: "recipient" as const };
  const externalKey = fingerprint("external", mail.account, mail.externalId);
  const contentHash = fingerprint("content", mail.account, inboundWire(mail).toString("utf8"));
  const messageKey = mail.messageId && fingerprint("message", mail.account, mail.messageId);
  const parentKey = mail.inReplyTo && fingerprint("message", mail.account, mail.inReplyTo);
  const senderHash = fingerprint("sender", mail.account, mail.from);
  const recipientsHash = fingerprint("recipients", mail.account, JSON.stringify([...mail.to].sort()));
  return tx(async c => {
    await c.query("SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'");
    await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", [`mail-inbound:${mail.account}:${externalKey}`]);
    const existing = (await c.query<{ id: string; thread_root: string; content_hash: string }>("SELECT id,thread_root,content_hash FROM mail_inbound_messages WHERE account=$1 AND external_key=$2", [mail.account, externalKey])).rows[0];
    if (existing) return existing.content_hash === contentHash
      ? { ok: true as const, id: existing.id, threadRoot: existing.thread_root, duplicate: true }
      : { ok: false as const, error: "conflict" as const };
    const id = randomUUID(); let threadRoot: string = id;
    if (parentKey) {
      // Ambiguous Message-IDs, account/address differences or references without
      // an exact In-Reply-To produce a new thread instead of guessing a person.
      const parents = (await c.query<{ thread_root: string }>("SELECT thread_root FROM mail_inbound_messages WHERE account=$1 AND message_key=$2 AND sender_hash=$3 AND recipients_hash=$4 LIMIT 2", [mail.account, parentKey, senderHash, recipientsHash])).rows;
      if (parents.length === 1) threadRoot = parents[0].thread_root;
    }
    const cipher = encryptInbound(id, mail), correlation = threadRoot === id ? "new" : "header-reference";
    await c.query(`INSERT INTO mail_inbound_messages(id,account,external_key,content_hash,message_key,parent_key,sender_hash,recipients_hash,thread_root,correlation,content_cipher,received_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp()+make_interval(days=>$13))`, [id, mail.account, externalKey, contentHash, messageKey, parentKey, senderHash, recipientsHash, threadRoot, correlation, cipher, mail.receivedAt, ADMIN_CONTENT_RETENTION_DAYS]);
    await audit("mail_inbound_received", null, { id, account: mail.account, threadRoot, correlation, attachments: mail.attachments.length }, c);
    return { ok: true as const, id, threadRoot, duplicate: false };
  });
}

/** Tombstones retain idempotency after the encrypted content expires. */
export async function purgeInboundContent(limit = 100, client?: PoolClient): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("retention_parameters");
  const purge = async (c: PoolClient) => {
    const rows = (await c.query<{ id: string }>(`WITH expired AS (
      SELECT id FROM mail_inbound_messages WHERE content_cipher IS NOT NULL AND expires_at<=clock_timestamp()
      ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE mail_inbound_messages m SET content_cipher=NULL,purged_at=clock_timestamp()
      FROM expired WHERE m.id=expired.id RETURNING m.id`, [limit])).rows;
    if (rows.length) await audit("mail_inbound_content_expired", null, { ids: rows.map(r => r.id), days: ADMIN_CONTENT_RETENTION_DAYS }, c);
    return rows.length;
  };
  return client ? purge(client) : tx(purge);
}

export type InboundReader = { userId: number; email: string; sessaoId: number | null };
/** Internal protected read; expired content is not selected even before cleanup.
 * Returning HTML data here is not permission to insert it into a browser DOM.
 */
export async function readInboundContent(id: string, actor: InboundReader) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) return { ok: false as const, error: "input" as const };
  if (!Number.isInteger(actor?.userId) || actor.userId < 1 || actor.userId > 2147483647 || !Number.isInteger(actor.sessaoId) || actor.sessaoId! < 1 || actor.sessaoId! > 2147483647 || typeof actor.email !== "string") return { ok: false as const, error: "forbidden" as const };
  return tx(async c => {
    await c.query("SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'");
    const permitted = await c.query(`SELECT u.id FROM admin_users u JOIN admin_sessions s ON s.user_id=u.id
      WHERE u.id=$1 AND lower(u.email)=$2 AND u.ativo AND u.nivel IN ('edicao','exclusao','total')
      AND s.id=$3 AND s.expira_em>now() AND s.stepup_ate>now() FOR SHARE OF u,s`, [actor.userId, actor.email.toLowerCase(), actor.sessaoId]);
    if (!permitted.rowCount) return { ok: false as const, error: "forbidden" as const };
    const row = (await c.query<{ account: string; expired: boolean; content_cipher: string | null }>(`SELECT account,expires_at<=clock_timestamp() AS expired,
      CASE WHEN expires_at>clock_timestamp() THEN content_cipher ELSE NULL END AS content_cipher
      FROM mail_inbound_messages WHERE id=$1`, [id])).rows[0];
    if (!row) return { ok: false as const, error: "not_found" as const };
    const mail = row.content_cipher ? decryptInbound(id, row.content_cipher) : null;
    const state = row.expired ? "expired" as const : mail?.account === row.account ? "stored" as const : "unavailable" as const;
    await audit("mail_inbound_content_read", null, { id, userId: actor.userId, por: actor.email.toLowerCase(), state }, c);
    return state === "stored" ? { ok: true as const, state, mail: mail! } : { ok: true as const, state };
  });
}
