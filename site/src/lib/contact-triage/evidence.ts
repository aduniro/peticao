import { hmac } from "../security";
import type { PoolClient } from "pg";
import { tx } from "../db";
import { redact, type Evidence, type SignatureEvidence } from "./analyze";
import { collectOutbound } from "./outbound";
export const CONTACT_SQL = "SELECT id,kind,created_at,left(message,4000) message,lower(email) email FROM contact_messages WHERE id=$1";
export const inputHash = (row: Record<string, unknown>) => hmac("contact-triage-input-v1:" + JSON.stringify([row.id,row.kind,row.created_at,row.message,row.email]));
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
/** Allow-list projection only: adding a secret column never changes these snapshots. */
export type CollectedEvidence = { evidence: Evidence; inputHash: string };
export async function collectEvidence(id: number): Promise<CollectedEvidence | null> {
  return tx(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await client.query("SET LOCAL statement_timeout='1500ms'");
    return collectEvidenceWith(client,id);
  });
}
/** Internal: caller establishes the read snapshot and timeout; allows diagnosis and evidence to share one transaction. */
export async function collectEvidenceWith(client: PoolClient,id: number): Promise<CollectedEvidence | null> {
  const row = (await client.query(CONTACT_SQL, [id])).rows[0];
  if (!row) return null;
  const evidence: Evidence = { contact: { id: row.id,kind: row.kind,created_at: iso(row.created_at),message: redact(row.message) }, snapshotAt: iso((await client.query("SELECT transaction_timestamp() ts")).rows[0].ts), signatures: [],mail: [],events: [],suppression: null,queue: null,unavailable: [],truncated: [] };
  const read = async <T>(source: string, sql: string, params: unknown[], fallback: T, map: (rows: any[]) => T): Promise<T> => {
    await client.query("SAVEPOINT evidence_source");
    try { const rows = (await client.query(sql, params)).rows; await client.query("RELEASE SAVEPOINT evidence_source"); return map(rows); }
    catch { await client.query("ROLLBACK TO SAVEPOINT evidence_source"); await client.query("RELEASE SAVEPOINT evidence_source"); evidence.unavailable.push(source); return fallback; }
  };
  const sigs = await read<SignatureEvidence[]>("signatures", "SELECT id,status,category,created_at,confirmed_at,token_expires_at,cpf_name_check,email_domain_kind,institution,campus,campus_ibge,uf FROM signatures WHERE lower(email)=$1 ORDER BY id DESC LIMIT 11", [row.email], [], rows => rows.map(s => ({ ...s,created_at: iso(s.created_at),confirmed_at: s.confirmed_at ? iso(s.confirmed_at) : null,token_expires_at: s.token_expires_at ? iso(s.token_expires_at) : null })));
  if (sigs.length > 10) evidence.truncated.push("signatures"); evidence.signatures = sigs.slice(0,10);
  evidence.mail = await read("mail", "SELECT ts,provider,status,kind FROM mail_log WHERE lower(to_addr)=$1 AND kind IN ('confirmacao','reenvio') AND ts>=now()-interval '14 days' ORDER BY ts DESC,id DESC LIMIT 31", [row.email], [], rows => rows.map(m => ({ ...m,ts: iso(m.ts) })));
  if (evidence.mail.length > 30) { evidence.mail.pop(); evidence.truncated.push("mail"); }
  evidence.events = await read("events", "SELECT ts,provider,type FROM mail_events WHERE lower(email)=$1 AND ts>=now()-interval '14 days' ORDER BY ts DESC,id DESC LIMIT 11", [row.email], [], rows => rows.map(m => ({ ...m,ts: iso(m.ts) })));
  if (evidence.events.length > 10) { evidence.events.pop(); evidence.truncated.push("events"); }
  evidence.suppression = await read("suppression", "SELECT reason,created_at FROM email_suppressions WHERE lower(email)=$1", [row.email], null, rows => rows[0] ? { reason: rows[0].reason,created_at: iso(rows[0].created_at) } : null);
  evidence.queue = await read("queue", "SELECT count(*) FILTER (WHERE status='pending')::int pending,count(*) FILTER (WHERE status='failed')::int failed FROM mail_outbox WHERE lower(to_addr)=$1 AND kind IN ('confirmacao','reenvio')", [row.email], null, rows => rows[0]);
  await client.query("SAVEPOINT outbound_source");
  try {
    const outbound = await collectOutbound(client, row.email);
    evidence.outbound = outbound.evidence;
    evidence.truncated.push(...outbound.truncated);
    await client.query("RELEASE SAVEPOINT outbound_source");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT outbound_source");
    await client.query("RELEASE SAVEPOINT outbound_source");
    evidence.unavailable.push("outbound");
  }
  return { evidence,inputHash: inputHash(row) };
}
/** Used with a row lock at finalization so edited contacts cannot receive stale analyses. */
export async function currentInputHash(client: PoolClient, id: number) {
  const row = (await client.query(CONTACT_SQL + " FOR UPDATE", [id])).rows[0]; return row ? inputHash(row) : null;
}
