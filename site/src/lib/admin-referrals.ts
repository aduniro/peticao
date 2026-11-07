import { audit, tx } from "./db";
import { CODE_RE, newReferrerCode } from "./referrals";
import { newToken, sha256 } from "./security";

type Actor = { userId: number; email: string };

/** The code and its audit event commit together, with the current operator locked. */
export async function createAdministrativeReferrer(label: string, actor: Actor, dependencies: { code?: () => string } = {}) {
  const normalized = label.trim().slice(0, 80);
  if (normalized.length < 2) return { ok: false as const, error: "label" };
  if (!Number.isInteger(actor?.userId) || actor.userId <= 0 || actor.userId > 2147483647 || typeof actor.email !== "string") return { ok: false as const, error: "forbidden" };
  return tx(async client => {
    const current = await client.query("SELECT id FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel IN ('edicao','exclusao','total') FOR SHARE", [actor.userId, actor.email.toLowerCase()]);
    if (!current.rowCount) return { ok: false as const, error: "forbidden" };
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = (dependencies.code ?? newReferrerCode)();
      if (!CODE_RE.test(code)) throw new Error("Invalid internal referral code");
      const token = newToken();
      // A code collision must not abort the transaction before another attempt.
      const inserted = await client.query("INSERT INTO referrers(code,manage_token_hash,label,display_name,signature_id) VALUES($1,$2,$3,NULL,NULL) ON CONFLICT(code) DO NOTHING RETURNING id", [code, sha256(token), normalized]);
      if (!inserted.rowCount) continue;
      await audit("referrer_created", null, { code, label: normalized, por: actor.email.toLowerCase(), userId: actor.userId }, client);
      return { ok: true as const, code };
    }
    throw new Error("não foi possível gerar um código de indicação único");
  });
}
