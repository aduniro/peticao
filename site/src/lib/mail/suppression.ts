import { query } from "../db";

/** Lista de supressão local: endereços que deram bounce permanente ou reclamação (spam) no SES. Nunca mais enviamos a eles. */
export class MailSuppressedError extends Error {}

const norm = (e: string) => e.trim().toLowerCase();

export async function isSuppressed(email: string): Promise<boolean> {
  const r = await query("SELECT 1 FROM email_suppressions WHERE email = $1", [norm(email)]);
  return r.rows.length > 0;
}

export async function suppress(email: string, reason: "bounce" | "complaint" | "invalid", detail = ""): Promise<void> {
  await query(
    `INSERT INTO email_suppressions (email, reason, detail) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET reason = CASE WHEN email_suppressions.reason = 'complaint' THEN 'complaint' ELSE EXCLUDED.reason END, detail = EXCLUDED.detail, updated_at = now()`,
    [norm(email), reason, detail.slice(0, 300)],
  );
}
