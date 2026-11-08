import { audit, tx } from "./db";
import { CODE_RE, newReferrerCode } from "./referrals";
import { hmac, newToken, sha256 } from "./security";

type Actor = { userId: number; email: string };

/** The code and its audit event commit together, with the current operator locked. */
export async function createAdministrativeReferrer(label: string, actor: Actor, dependencies: { code?: () => string; requestId?: string } = {}) {
  const normalized = label.trim().slice(0, 80);
  if (normalized.length < 2) return { ok: false as const, error: "label" };
  if (!Number.isInteger(actor?.userId) || actor.userId <= 0 || actor.userId > 2147483647 || typeof actor.email !== "string") return { ok: false as const, error: "forbidden" };
  const requestId = dependencies.requestId;
  if (requestId !== undefined && (typeof requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId))) return { ok: false as const, error: "request" };
  const fingerprint = requestId ? hmac("admin-referral-input:v1:" + JSON.stringify([actor.userId, normalized])) : null;
  return tx(async client => {
    const current = await client.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel IN ('edicao','exclusao','total') FOR SHARE", [actor.userId, actor.email.toLowerCase()]);
    if (!current.rowCount) return { ok: false as const, error: "forbidden" };
    if (requestId) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", [`admin-referral-request:${actor.userId}:${requestId}`]);
      const previous = (await client.query<{ code: string; input_hash: string }>("SELECT r.code,q.input_hash FROM admin_referral_requests q JOIN referrers r ON r.id=q.referrer_id WHERE q.actor_id=$1 AND q.request_id=$2", [actor.userId, requestId])).rows[0];
      if (previous) return previous.input_hash === fingerprint ? { ok: true as const, code: previous.code, existing: true } : { ok: false as const, error: "conflict" };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = (dependencies.code ?? newReferrerCode)();
      if (!CODE_RE.test(code)) throw new Error("Invalid internal referral code");
      const token = newToken();
      // A code collision must not abort the transaction before another attempt.
      const inserted = await client.query("INSERT INTO referrers(code,manage_token_hash,label,display_name,signature_id) VALUES($1,$2,$3,NULL,NULL) ON CONFLICT(code) DO NOTHING RETURNING id", [code, sha256(token), normalized]);
      if (!inserted.rowCount) continue;
      if (requestId) await client.query("INSERT INTO admin_referral_requests(actor_id,request_id,input_hash,referrer_id) VALUES($1,$2,$3,$4)", [actor.userId, requestId, fingerprint, inserted.rows[0].id]);
      await audit("referrer_created", null, { code, label: normalized, por: actor.email.toLowerCase(), userId: actor.userId }, client);
      return { ok: true as const, code, existing: false };
    }
    throw new Error("não foi possível gerar um código de indicação único");
  });
}
