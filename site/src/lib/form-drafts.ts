import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { query, tx } from "./db";
import { hmac, sha256 } from "./security";
import { isValidCpf, onlyDigits } from "./cpf";

export const FORM_DRAFT_DAYS = 30;
export const FORM_DRAFT_EVENT_LIMIT = 40;
export const FORM_DRAFT_BODY_LIMIT = 12_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STAGES = new Set(["opt_in", "editing", "blur", "hidden", "submit_click", "submit", "browser_invalid", "server_result"]);
const TEXT_FIELDS: Record<string, number> = { name: 160, email: 254, institution: 220, role: 100, campus: 220, city: 120, uf: 2, country: 2, university: 220 };
const INVALID_FIELDS = new Set([...Object.keys(TEXT_FIELDS), "cpf", "consent"]);

function key(): Buffer {
  const value = process.env.FORM_DRAFT_ENCRYPTION_KEY?.trim();
  if (!value || value.length < 32) throw new Error("form_draft_key_unavailable");
  return createHash("sha256").update(`form-draft-v1|${value}`).digest();
}

export function formDraftsEnabled(): boolean {
  return process.env.FORM_DRAFTS_ENABLED === "1" && !!process.env.FORM_DRAFT_ENCRYPTION_KEY?.trim() && (process.env.FORM_DRAFT_ENCRYPTION_KEY?.trim().length ?? 0) >= 32;
}

export function validDraftToken(value: unknown): value is string { return typeof value === "string" && TOKEN.test(value); }

/** Strict whitelist. No challenge inputs, browser fingerprint, cookies or tokens. */
export function sanitizeFormDraft(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_draft");
  const value = input as Record<string, unknown>;
  if (value.optIn !== true) throw new Error("draft_opt_in_required");
  const snapshot = value.snapshot && typeof value.snapshot === "object" && !Array.isArray(value.snapshot) ? value.snapshot as Record<string, unknown> : {};
  const result: Record<string, unknown> = { stage: typeof value.stage === "string" && STAGES.has(value.stage) ? value.stage : "editing" };
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) {
    if (typeof snapshot[field] === "string") {
      // Also redact CPF-shaped digits accidentally pasted into another field.
      result[field] = (snapshot[field] as string).normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\d(?:[ .-]*\d){10}/g, "[CPF omitido]").slice(0, limit);
    }
  }
  if (["servidor", "apoiador", "estrangeiro"].includes(String(snapshot.category))) result.category = snapshot.category;
  result.consent = snapshot.consent === true;
  result.region = snapshot.region === true;
  if (typeof snapshot.cpf === "string") {
    const cpf = onlyDigits(snapshot.cpf);
    if (cpf.length === 11 && isValidCpf(cpf)) result.cpf_hash = hmac(cpf);
    else result.cpf_incomplete_or_invalid = true;
  }
  if (Array.isArray(value.invalidFields)) result.invalid_fields = [...new Set(value.invalidFields.filter((v): v is string => typeof v === "string" && INVALID_FIELDS.has(v)))].slice(0, 12);
  // Deliberately no free-form server message or response payload.
  if (["accepted", "rejected", "identity_required", "network_error"].includes(String(value.outcome))) result.outcome = value.outcome;
  return result;
}

function encrypt(plain: string, context: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptFormDraft(payload: string, context: string): { events: Array<{ at: string; sequence: number; snapshot: Record<string, unknown> }> } | null {
  try {
    const [version, iv, tag, encrypted, extra] = payload.split(".");
    if (version !== "v1" || extra !== undefined) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8"));
  } catch { return null; }
}

/** Additive lazy schema owned by this feature; no signature/schema rewrite. */
async function schema(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('form-draft-schema-v1',0))");
    await client.query(`CREATE TABLE IF NOT EXISTS form_draft_cache (
    draft_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, last_sequence INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX IF NOT EXISTS form_draft_cache_expiry ON form_draft_cache(expires_at);
    CREATE TABLE IF NOT EXISTS form_draft_revocations (
    draft_hash TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL)`);
  });
}

export async function saveFormDraft(token: string, sequence: number, input: unknown, now = Date.now()): Promise<{ saved: boolean }> {
  if (!formDraftsEnabled()) return { saved: false };
  if (!validDraftToken(token) || !Number.isInteger(sequence) || sequence < 1 || sequence > 1_000_000) throw new Error("invalid_draft");
  const snapshot = sanitizeFormDraft(input), digest = sha256(token), at = new Date(now).toISOString();
  await schema();
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`form-draft:${digest}`]);
    if ((await client.query("SELECT 1 FROM form_draft_revocations WHERE draft_hash=$1 AND expires_at>$2", [digest, at])).rowCount) return { saved: false };
    const row = (await client.query("SELECT payload,last_sequence,created_at,expires_at FROM form_draft_cache WHERE draft_hash=$1 FOR UPDATE", [digest])).rows[0];
    if (row && (new Date(row.expires_at).getTime() <= now || row.last_sequence >= sequence)) return { saved: false };
    const previous = row ? decryptFormDraft(row.payload, digest) : { events: [] };
    // Key rotation/corruption never silently destroys existing evidence.
    if (!previous || !Array.isArray(previous.events)) throw new Error("draft_unreadable");
    const events = [...previous.events, { at, sequence, snapshot }].slice(-FORM_DRAFT_EVENT_LIMIT);
    const expires = row ? new Date(row.expires_at).toISOString() : new Date(now + FORM_DRAFT_DAYS * 86400_000).toISOString();
    await client.query(`INSERT INTO form_draft_cache(draft_hash,payload,last_sequence,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(draft_hash) DO UPDATE SET payload=excluded.payload,last_sequence=excluded.last_sequence`,
      [digest, encrypt(JSON.stringify({ events }), digest), sequence, at, expires]);
    return { saved: true };
  });
}

/** Minimal hash-only tombstone stops in-flight writes; never stores draft contents. */
export async function withdrawFormDraft(token: string, now = Date.now()): Promise<void> {
  if (!validDraftToken(token)) throw new Error("invalid_draft");
  await schema();
  const digest = sha256(token);
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`form-draft:${digest}`]);
    await client.query("DELETE FROM form_draft_cache WHERE draft_hash=$1", [digest]);
    await client.query("INSERT INTO form_draft_revocations VALUES($1,$2) ON CONFLICT(draft_hash) DO UPDATE SET expires_at=excluded.expires_at", [digest, new Date(now + FORM_DRAFT_DAYS * 86400_000).toISOString()]);
  });
}

export async function purgeExpiredFormDrafts(now = Date.now()): Promise<number> {
  // Run even when collection is disabled, so turning it off doesn't retain old data.
  await schema();
  const at = new Date(now).toISOString();
  const result = await query("DELETE FROM form_draft_cache WHERE expires_at<=$1", [at]);
  await query("DELETE FROM form_draft_revocations WHERE expires_at<=$1", [at]);
  return result.rowCount ?? 0;
}
