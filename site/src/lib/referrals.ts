import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "./db";
import { newToken, sha256 } from "./security";

/** Sem 0, 1, I, L, O para evitar confusão ao digitar ou ler o código. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_RE = /^[2-9A-HJKMNP-Z]{7}$/;
export const newReferrerCode = () => Array.from({ length: 7 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export type Referrer = { id: number; code: string; label: string | null; display_name: string | null; signature_id: number | null; created_at: string };

async function insert(run: (sql: string, p: unknown[]) => Promise<{ rows: any[] }>, label: string | null, displayName: string | null, sigId: number | null) {
  for (let i = 0; i < 5; i++) {
    const code = newReferrerCode(), token = newToken();
    try {
      await run(
        "INSERT INTO referrers(code,manage_token_hash,label,display_name,signature_id) VALUES($1,$2,$3,$4,$5)",
        [code, sha256(token), label, displayName, sigId]
      );
      return { code, manageToken: token };
    } catch (e: any) {
      if (e?.code !== "23505") throw e; // colisão de código: tenta outro
    }
  }
  throw new Error("não foi possível gerar um código de indicação único");
}

/** Cada pessoa que confirma a assinatura recebe um código e um token secreto (só ela tem o link do próprio painel). */
export async function createReferrerForSignature(sigId: number, firstName: string, client: PoolClient) {
  const existing = await client.query("SELECT 1 FROM referrers WHERE signature_id=$1", [sigId]);
  if (existing.rowCount) return null;
  return insert((s, p) => client.query(s, p), null, firstName.slice(0, 40), sigId);
}

/** Código avulso da organização (ex.: "Sindicato X", "Grupo de WhatsApp Y"), para medir canais. */
export async function createLabelReferrer(label: string) {
  return insert((s, p) => query(s, p), label.trim().slice(0, 80), null, null);
}

export async function referrerByCode(code: string): Promise<Referrer | null> {
  if (!CODE_RE.test(code)) return null;
  return (await query<Referrer>("SELECT id,code,label,display_name,signature_id,created_at FROM referrers WHERE code=$1", [code])).rows[0] ?? null;
}
export async function referrerByToken(token: string): Promise<Referrer | null> {
  if (!token || token.length > 200) return null;
  return (await query<Referrer>("SELECT id,code,label,display_name,signature_id,created_at FROM referrers WHERE manage_token_hash=$1", [sha256(token)])).rows[0] ?? null;
}

export type RefStats = { visits: number; signed: number; pending: number };

export async function referrerStats(code: string): Promise<RefStats> {
  const v = await query<{ n: number }>("SELECT COUNT(DISTINCT visitor_id)::int n FROM events WHERE type='ref_visit' AND ref_code=$1 AND is_bot=false", [code]);
  const s = await query<{ status: string; n: number }>("SELECT status, COUNT(*)::int n FROM signatures WHERE ref_code=$1 GROUP BY status", [code]);
  return { visits: v.rows[0].n, signed: s.rows.find((r) => r.status === "confirmed")?.n ?? 0, pending: s.rows.find((r) => r.status === "pending")?.n ?? 0 };
}

export type RefRow = { code: string; name: string | null; label: string | null; created_at: string; visits: number; signed: number; pending: number };

export async function allReferrerStats(): Promise<RefRow[]> {
  return (await query<RefRow>(
    `SELECT r.code, r.display_name AS name, r.label, r.created_at,
       COALESCE((SELECT COUNT(DISTINCT e.visitor_id) FROM events e WHERE e.type='ref_visit' AND e.ref_code=r.code AND e.is_bot=false),0)::int AS visits,
       COALESCE((SELECT COUNT(*) FROM signatures s WHERE s.ref_code=r.code AND s.status='confirmed'),0)::int AS signed,
       COALESCE((SELECT COUNT(*) FROM signatures s WHERE s.ref_code=r.code AND s.status='pending'),0)::int AS pending
     FROM referrers r ORDER BY signed DESC, visits DESC, r.created_at DESC LIMIT 1000`
  )).rows;
}

/** Quem assinou por este código (só o painel da ADUNIR vê nomes; quem indicou vê apenas totais). */
export async function signersOf(code: string) {
  return (await query<{ name: string; status: string; category: string }>("SELECT name,status,category FROM signatures WHERE ref_code=$1 ORDER BY id", [code])).rows;
}
