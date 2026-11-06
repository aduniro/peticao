/** Separate, opt-in subscriber authentication. No admin/referral token grants access. */
import type { PoolClient } from "pg";
import { query, tx, getPool } from "./db";
import { config } from "./config";
import { hmac, newToken, normalizeEmail, sha256 } from "./security";
import { gerarSenha, hashSenha, verificarHash, HASH_FALSO } from "./senha";
import { SAFE_EMAIL_RE } from "./email-syntax";
import { onlyDigits, isValidCpf } from "./cpf";
import { classifyCpfName } from "./cpf-name";
import { cachedCpfRecordByHash } from "./cpf-cache";
import { validateSubscriberProfile } from "./signatures";
import type { Mail } from "./mail";

export const SUBSCRIBER_COOKIE = "peticao_assinante";
export const SUBSCRIBER_SESSION_SECONDS = 30 * 60;
export const SUBSCRIBER_RECENT_SECONDS = 10 * 60;
export const SUBSCRIBER_TOKEN_MINUTES = 30;
export const subscriberAccessEnabled = () => process.env.SUBSCRIBER_ACCESS_ENABLED === "1";
export const SUBSCRIBER_GENERIC_MESSAGE = "Se houver assinatura confirmada compatível, enviaremos as orientações ao e-mail já vinculado. Se você já possui senha, ela continua válida.";
export type SubscriberContext = { ip: string };
export type SubscriberSend = (mail: Mail) => Promise<unknown>;
export class SubscriberError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const fail = (code: string, message: string, status = 400): never => { throw new SubscriberError(code, message, status); };
const assertEnabled = () => { if (!subscriberAccessEnabled()) fail("disabled", "Recurso indisponível.", 404); };
const text = (v: unknown) => typeof v === "string" ? v : "";
const validToken = (v: string) => /^[A-Za-z0-9_-]{43}$/.test(v);
const SCHEMA = `
CREATE TABLE IF NOT EXISTS subscriber_credentials (
 signature_id INTEGER PRIMARY KEY REFERENCES signatures(id), password_hash TEXT NOT NULL,
 initial_name TEXT NOT NULL, channel_revision TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 changed_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE subscriber_credentials ADD COLUMN IF NOT EXISTS channel_revision TEXT;
CREATE TABLE IF NOT EXISTS subscriber_enrollment (
 signature_id INTEGER PRIMARY KEY REFERENCES signatures(id), lease_hash TEXT NOT NULL,
 password_hash TEXT NOT NULL, initial_name TEXT NOT NULL, source_revision TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reserved','delivered','failed')),
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS subscriber_sessions (
 token_hash TEXT PRIMARY KEY, signature_id INTEGER NOT NULL REFERENCES subscriber_credentials(signature_id) ON DELETE CASCADE,
 credential_version INTEGER NOT NULL, authenticated_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS subscriber_sessions_expiry ON subscriber_sessions(expires_at);
CREATE TABLE IF NOT EXISTS subscriber_tokens (
 token_hash TEXT PRIMARY KEY, signature_id INTEGER NOT NULL REFERENCES subscriber_credentials(signature_id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('password_reset','signature_change')), credential_version INTEGER NOT NULL,
 source_revision TEXT, payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS subscriber_tokens_subject ON subscriber_tokens(signature_id,purpose,created_at);
CREATE TABLE IF NOT EXISTS subscriber_rate_limits (
 bucket TEXT PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), hits INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS subscriber_events (
 id BIGSERIAL PRIMARY KEY, signature_id INTEGER REFERENCES signatures(id), event TEXT NOT NULL,
 detail JSONB NOT NULL DEFAULT '{}', at TIMESTAMPTZ NOT NULL DEFAULT now());
`;
// The module owns additive tables; the existing application schema is unchanged.
const schemaReady = new WeakMap<object, Promise<void>>();
export async function ensureSubscriberSchema(): Promise<void> {
  assertEnabled();
  const pool = getPool();
  let ready = schemaReady.get(pool);
  if (!ready) {
    ready = query(SCHEMA).then(() => {}).catch(error => { schemaReady.delete(pool); throw error; });
    schemaReady.set(pool, ready);
  }
  await ready;
}
async function event(c: PoolClient, id: number | null, name: string, detail: Record<string, unknown> = {}) {
  await c.query("INSERT INTO subscriber_events(signature_id,event,detail) VALUES($1,$2,$3)", [id, name, JSON.stringify(detail)]);
}
async function limit(action: string, ctx: SubscriberContext, identifier: string, ipMax = 20, idMax = 8, minutes = 15) {
  await ensureSubscriberSchema();
  const entries = [[`ip:${hmac("subscriber-ip:" + ctx.ip)}`, ipMax], [`identifier:${hmac("subscriber-identifier:" + identifier)}`, idMax]] as const;
  const allowed = await tx(async (c) => {
    let ok = true;
    for (const [scope, maximum] of entries) {
      const r = await c.query<{ hits: number }>(`INSERT INTO subscriber_rate_limits(bucket) VALUES($1)
        ON CONFLICT(bucket) DO UPDATE SET
        hits=CASE WHEN subscriber_rate_limits.started_at < now()-make_interval(mins=>$2) THEN 1 ELSE LEAST(subscriber_rate_limits.hits+1,1000000) END,
        started_at=CASE WHEN subscriber_rate_limits.started_at < now()-make_interval(mins=>$2) THEN now() ELSE subscriber_rate_limits.started_at END RETURNING hits`, [`${action}:${scope}`, minutes]);
      if (r.rows[0].hits > maximum) ok = false;
    }
    return ok;
  });
  if (!allowed) fail("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429);
}
function canonicalOrigin(): string {
  const url = new URL(config.appUrl());
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("SUBSCRIBER_ORIGIN_CONFIGURATION");
  }
  return url.origin;
}
export function subscriberOriginAllowed(origin: string | null): boolean {
  try { return origin === canonicalOrigin(); } catch { return false; }
}
async function sendDirect(mail: Mail): Promise<void> {
  // Secret-bearing messages must never enter a plaintext dev or retry outbox.
  if (config.mailProviders().some(p => p === "dev")) throw new Error("SUBSCRIBER_DIRECT_DELIVERY_REQUIRED");
  const { sendMail } = await import("./mail");
  const outcome = await sendMail(mail, "assinante_acesso", { queue: false });
  if (outcome !== "sent") throw new Error("SUBSCRIBER_DIRECT_DELIVERY_REQUIRED");
}
function password(value: unknown, confirmation?: unknown): string {
  const plain = text(value).normalize("NFC");
  if (confirmation !== undefined && plain !== text(confirmation).normalize("NFC")) fail("password_mismatch", "As senhas precisam ser iguais.");
  if ([...plain].length < 15 || [...plain].length > 200) fail("password_length", "Use de 15 a 200 caracteres. Frases e espaços são permitidos.");
  if (["123456789012345", "1234567890123456", "senha123456789012", "passwordpassword"].includes(plain.toLowerCase()) || new Set(plain).size === 1) fail("password_common", "Escolha uma senha menos previsível.");
  return plain;
}
const SAFE_FIELDS = ["id", "seq", "name", "email", "category", "institution", "role", "campus", "campus_ibge", "city", "city_ibge", "uf", "country", "university", "region_declared", "region_validated", "region_criteria", "institution_listed", "campus_listed", "ifes_acronym", "email_domain_kind", "email_institution", "email_domain", "cpf_hash", "cpf_name_check", "identity_method", "status", "created_at", "confirmed_at", "consent_at"] as const;
export function subscriberRevision(row: Record<string, unknown>): string {
  return sha256(JSON.stringify(SAFE_FIELDS.map(key => [key, row[key] ?? null])));
}
function publicSignature(row: Record<string, any>) {
  return { id: row.id, seq: row.seq, name: row.name, email: row.email, category: row.category,
    institution: row.institution, role: row.role, campus: row.campus, campusIbge: row.campus_ibge,
    city: row.city, uf: row.uf, country: row.country, university: row.university,
    regionDeclared: row.region_declared, institutionalEmailVerified: Boolean(row.email_domain_kind && row.email_domain_kind !== "discente" && !row.wa_confirmed_at),
    createdAt: row.created_at, confirmedAt: row.confirmed_at, cpfNameCheck: row.cpf_name_check };
}
async function emailRecord(email: string, c?: PoolClient) {
  if (!SAFE_EMAIL_RE.test(email)) return null;
  // Exact delivery address. Do not reinterpret the unresolved non-Gmail '+' policy.
  return (await query("SELECT * FROM signatures WHERE lower(email)=$1 AND status='confirmed' AND confirmed_at IS NOT NULL AND wa_confirmed_at IS NULL", [email], c)).rows[0] ?? null;
}

/** No plaintext message/password is persisted by this bounded in-memory dispatcher. */
type Delivery = { run: (signal: AbortSignal) => Promise<void>; failure: () => Promise<void>; done: () => void };
const deliveries: Delivery[] = [];
const deliveryPromises = new Set<Promise<void>>();
const deliveryFailures = new Set<Promise<void>>();
let activeDeliveries = 0, deliveryTimeout = 30_000;
function scheduleDelivery(run: Delivery["run"], failure: Delivery["failure"]): boolean {
  if (deliveryPromises.size >= 32) return false;
  let complete!: () => void;
  const promise = new Promise<void>(resolve => { complete = resolve; });
  deliveryPromises.add(promise);
  deliveries.push({ run, failure, done: () => { deliveryPromises.delete(promise); complete(); } });
  setImmediate(pumpDeliveries);
  return true;
}
function pumpDeliveries() {
  while (activeDeliveries < 4 && deliveries.length) {
    const job = deliveries.shift()!;
    activeDeliveries++;
    const controller = new AbortController();
    let failed = false;
    const failure = async () => {
      if (!failed) {
        failed = true;
        const work = job.failure().catch(() => {}); deliveryFailures.add(work);
        try { await work; } finally { deliveryFailures.delete(work); }
      }
    };
    const timer = setTimeout(() => { controller.abort(); void failure(); }, deliveryTimeout);
    // A timeout invalidates the lease/token, but NEVER frees the worker while
    // a provider is still unresolved. This bounds orphan network work to four.
    Promise.resolve().then(() => job.run(controller.signal)).catch(failure).finally(() => {
      clearTimeout(timer); activeDeliveries--; job.done(); pumpDeliveries();
    });
  }
}
export async function _waitSubscriberDeliveriesForTests() {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  while (deliveryPromises.size || deliveryFailures.size) await Promise.all([...deliveryPromises, ...deliveryFailures]);
}
export function _subscriberDeliveryStateForTests(timeout?: number) {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  if (timeout !== undefined) deliveryTimeout = timeout;
  return { active: activeDeliveries, pending: deliveries.length, total: deliveryPromises.size };
}
export function subscriberChannelRevision(row: Record<string, any>) {
  return sha256(JSON.stringify([row.id, row.email, row.cpf_hash, row.status, row.confirmed_at, row.wa_confirmed_at ?? null]));
}

/** Repeated requests never rotate an active password; delivery occurs outside DB locks. */
export async function subscriberEnroll(emailInput: unknown, ctx: SubscriberContext, send: SubscriberSend = sendDirect) {
  assertEnabled();
  const email = normalizeEmail(text(emailInput));
  await limit("enroll", ctx, email, 10, 3, 60);
  // Same password-hashing work for known, unknown and already-enrolled addresses.
  const generated = gerarSenha(), hash = hashSenha(generated), lease = newToken();
  const row = await emailRecord(email);
  let reserved = false;
  if (row) reserved = await tx(async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["subscriber-enroll:" + row.id]);
    const current = (await c.query("SELECT * FROM signatures WHERE id=$1 FOR UPDATE", [row.id])).rows[0];
    if (!current || subscriberChannelRevision(current) !== subscriberChannelRevision(row) || current.wa_confirmed_at) return false;
    if ((await c.query("SELECT signature_id FROM subscriber_credentials WHERE signature_id=$1", [row.id])).rowCount) return false;
    const r = await c.query(`INSERT INTO subscriber_enrollment(signature_id,lease_hash,password_hash,initial_name,source_revision,state,expires_at)
      VALUES($1,$2,$3,$4,$5,'reserved',now()+interval '10 minutes') ON CONFLICT(signature_id) DO UPDATE SET
      lease_hash=EXCLUDED.lease_hash,password_hash=EXCLUDED.password_hash,initial_name=EXCLUDED.initial_name,
      source_revision=EXCLUDED.source_revision,state='reserved',expires_at=EXCLUDED.expires_at,created_at=now()
      WHERE subscriber_enrollment.state<>'reserved' OR subscriber_enrollment.expires_at<=now() RETURNING signature_id`,
      [row.id, sha256(lease), hash, current.name, subscriberChannelRevision(current)]);
    return !!r.rowCount;
  });
  if (reserved) {
    const invalidate = async () => {
      await tx(async c => {
        const r = await c.query("UPDATE subscriber_enrollment SET state='failed' WHERE signature_id=$1 AND lease_hash=$2 AND state='reserved' RETURNING signature_id", [row.id, sha256(lease)]);
        if (r.rowCount) await event(c, row.id, "initial_delivery_failed");
      });
    };
    const scheduled = scheduleDelivery(async signal => {
      const before = await emailRecord(email);
      const reservation = (await query("SELECT lease_hash,state FROM subscriber_enrollment WHERE signature_id=$1 AND expires_at>now()", [row.id])).rows[0];
      if (signal.aborted || !before || subscriberChannelRevision(before) !== subscriberChannelRevision(row) || reservation?.lease_hash !== sha256(lease) || reservation.state !== "reserved") throw new Error("SUBSCRIBER_ENROLLMENT_STALE");
      const link = `${canonicalOrigin()}/minha-assinatura`;
      await send({ to: row.email, subject: "Acesso à sua assinatura da petição", text: `A página para verificar sua assinatura é:\n${link}\n\nSua senha inicial: ${generated}\n\nA senha não tem vencimento. Você pode alterá-la depois de entrar. O endereço da página não contém a senha. Se não solicitou, não compartilhe esta mensagem.` });
      if (signal.aborted) throw new Error("SUBSCRIBER_DELIVERY_TIMEOUT");
      await tx(async c => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["subscriber-enroll:" + row.id]);
        const current = (await c.query("SELECT * FROM signatures WHERE id=$1 FOR UPDATE", [row.id])).rows[0];
        const pending = (await c.query("SELECT * FROM subscriber_enrollment WHERE signature_id=$1 FOR UPDATE", [row.id])).rows[0];
        if (signal.aborted || !current || !pending || pending.lease_hash !== sha256(lease) || pending.state !== "reserved" || new Date(pending.expires_at).getTime()<=Date.now() || pending.source_revision !== subscriberChannelRevision(current)) throw new Error("SUBSCRIBER_ENROLLMENT_STALE");
        const added = await c.query("INSERT INTO subscriber_credentials(signature_id,password_hash,initial_name,channel_revision) VALUES($1,$2,$3,$4) ON CONFLICT(signature_id) DO NOTHING RETURNING signature_id", [row.id, pending.password_hash, pending.initial_name, subscriberChannelRevision(current)]);
        await c.query("UPDATE subscriber_enrollment SET state='delivered' WHERE signature_id=$1", [row.id]);
        if (added.rowCount) await event(c, row.id, "credential_issued");
      });
    }, invalidate);
    if (!scheduled) await invalidate();
  }
  return { ok: true, message: SUBSCRIBER_GENERIC_MESSAGE };
}

export async function subscriberLogin(input: Record<string, unknown>, ctx: SubscriberContext) {
  assertEnabled();
  const mode = input.mode === "cpf" ? "cpf" : "email";
  const email = normalizeEmail(text(input.email)).slice(0, 254), cpf = onlyDigits(text(input.cpf)).slice(0, 32);
  const identifier = mode === "cpf" ? "cpf:" + cpf : "email:" + email;
  await limit("login", ctx, identifier, 25, 10, 15);
  const row = (await query(`SELECT s.*,c.password_hash,c.initial_name,c.channel_revision,c.version AS credential_version FROM signatures s
    JOIN subscriber_credentials c ON c.signature_id=s.id WHERE s.status='confirmed' AND ${mode === "cpf" ? "s.cpf_hash=$1" : "lower(s.email)=$1"}`,
    [mode === "cpf" ? hmac(cpf) : email])).rows[0];
  const supplied = text(input.password).normalize("NFC");
  const correct = supplied.length <= 400 && verificarHash(supplied, row?.password_hash ?? HASH_FALSO);
  let nameOk = true;
  if (mode === "cpf") {
    const entered = text(input.name).slice(0, 300);
    nameOk = !!row && isValidCpf(cpf) && [row.name, row.initial_name].some(n => classifyCpfName(n, entered) === "complete");
    if (row && !nameOk && correct && isValidCpf(cpf)) {
      const cached = await cachedCpfRecordByHash(row.cpf_hash);
      nameOk = !!cached && classifyCpfName(cached.nome, entered) === "complete";
    }
  }
  if (!row || !correct || !nameOk || row.channel_revision !== subscriberChannelRevision(row)) {
    await tx(c => event(c, null, "login_failed", { identifier: hmac("subscriber-login:" + identifier), ip: hmac("subscriber-ip:" + ctx.ip) }));
    fail("credentials", "Não foi possível entrar com esses dados.", 401);
  }
  const token = newToken();
  const created = await tx(async c => {
    const active = (await c.query("SELECT version,channel_revision FROM subscriber_credentials WHERE signature_id=$1 FOR UPDATE", [row.id])).rows[0];
    if (!active || active.version !== row.credential_version || active.channel_revision !== row.channel_revision) return false;
    const current = (await c.query("SELECT * FROM signatures WHERE id=$1 FOR UPDATE", [row.id])).rows[0];
    if (!current || active.channel_revision !== subscriberChannelRevision(current)) return false;
    await c.query("INSERT INTO subscriber_sessions(token_hash,signature_id,credential_version,expires_at) VALUES($1,$2,$3,now()+make_interval(secs=>$4))", [sha256(token), row.id, row.credential_version, SUBSCRIBER_SESSION_SECONDS]);
    await event(c, row.id, "login_ok"); return true;
  });
  if (!created) fail("credentials", "A senha foi alterada. Entre novamente.", 401);
  return { ok: true, token, maxAge: SUBSCRIBER_SESSION_SECONDS };
}
async function session(token: string, recent = false, c?: PoolClient) {
  if (!validToken(token)) return null;
  const row = (await query(`SELECT s.*,a.authenticated_at,a.token_hash AS session_hash,c.version AS credential_version,c.channel_revision AS credential_channel_revision FROM subscriber_sessions a
    JOIN subscriber_credentials c ON c.signature_id=a.signature_id AND c.version=a.credential_version
    JOIN signatures s ON s.id=a.signature_id WHERE a.token_hash=$1 AND a.expires_at>now() AND s.status='confirmed'`, [sha256(token)], c)).rows[0];
  if (!row || row.credential_channel_revision !== subscriberChannelRevision(row) || (recent && Date.now() - new Date(row.authenticated_at).getTime() > SUBSCRIBER_RECENT_SECONDS * 1000)) return null;
  return row;
}
async function requireSession(token: string, recent = false, c?: PoolClient) {
  const row = await session(token, recent, c);
  if (!row) fail("authentication_required", recent ? "Entre novamente para confirmar esta alteração." : "Entre para consultar sua assinatura.", 401);
  return row;
}
export async function subscriberMe(token: string) {
  assertEnabled(); await ensureSubscriberSchema();
  const row = await session(token);
  return row ? { authenticated: true, signature: publicSignature(row), revision: subscriberRevision(row) } : { authenticated: false };
}
export async function subscriberLogout(token: string) {
  assertEnabled(); await ensureSubscriberSchema();
  if (validToken(token)) await query("DELETE FROM subscriber_sessions WHERE token_hash=$1", [sha256(token)]);
  return { ok: true };
}

export async function subscriberForgot(emailInput: unknown, ctx: SubscriberContext, send: SubscriberSend = sendDirect) {
  assertEnabled();
  const email = normalizeEmail(text(emailInput));
  await limit("forgot", ctx, email, 10, 3, 60);
  verificarHash("subscriber-forgot-fixed-cost", HASH_FALSO);
  const row = await emailRecord(email), token = newToken();
  let exists = false;
  if (row) exists = await tx(async c => {
    const credential = (await c.query("SELECT version,channel_revision FROM subscriber_credentials WHERE signature_id=$1 FOR UPDATE", [row.id])).rows[0];
    const current = (await c.query("SELECT * FROM signatures WHERE id=$1 FOR UPDATE", [row.id])).rows[0];
    if (!credential || !current || credential.channel_revision !== subscriberChannelRevision(current) || subscriberChannelRevision(current) !== subscriberChannelRevision(row)) return false;
    await c.query("INSERT INTO subscriber_tokens(token_hash,signature_id,purpose,credential_version,source_revision,expires_at) VALUES($1,$2,'password_reset',$3,$4,now()+make_interval(mins=>$5))", [sha256(token), row.id, credential.version, subscriberChannelRevision(current), SUBSCRIBER_TOKEN_MINUTES]);
    return true;
  });
  if (exists) {
    const invalidate = async () => { await query("UPDATE subscriber_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL", [sha256(token)]); };
    const scheduled = scheduleDelivery(async signal => {
      const current = await emailRecord(email);
      const pending = (await query("SELECT t.*,c.channel_revision FROM subscriber_tokens t JOIN subscriber_credentials c ON c.signature_id=t.signature_id AND c.version=t.credential_version WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>now()", [sha256(token)])).rows[0];
      if (signal.aborted || !current || !pending || pending.channel_revision !== subscriberChannelRevision(current) || pending.source_revision !== subscriberChannelRevision(current)) throw new Error("SUBSCRIBER_RESET_CHANNEL_CHANGED");
      await send({ to: row.email, subject: "Redefinir a senha da sua assinatura", text: `Se você solicitou a redefinição, abra a página e escolha sua nova senha:\n${canonicalOrigin()}/minha-assinatura/redefinir#token=${token}\n\nEsta autorização vale ${SUBSCRIBER_TOKEN_MINUTES} minutos e só funciona uma vez. Abrir o link não altera a senha. Sua senha atual continua válida até concluir. Se não solicitou, ignore.` });
      if (signal.aborted) throw new Error("SUBSCRIBER_DELIVERY_TIMEOUT");
    }, invalidate);
    if (!scheduled) await invalidate();
  }
  return { ok: true, message: SUBSCRIBER_GENERIC_MESSAGE };
}

export async function subscriberReset(token: string, newPassword: unknown, confirmation: unknown, ctx: SubscriberContext) {
  assertEnabled(); await limit("reset", ctx, sha256(token), 20, 8, 15);
  const plain = password(newPassword, confirmation);
  if (!validToken(token)) fail("token_invalid", "Autorização inválida ou vencida.", 409);
  const hash = hashSenha(plain);
  const applied = await tx(async c => {
    const peek = (await c.query("SELECT signature_id FROM subscriber_tokens WHERE token_hash=$1 AND purpose='password_reset'", [sha256(token)])).rows[0];
    if (!peek) return false;
    const cred = (await c.query("SELECT version,channel_revision FROM subscriber_credentials WHERE signature_id=$1 FOR UPDATE", [peek.signature_id])).rows[0];
    const current = (await c.query("SELECT * FROM signatures WHERE id=$1 FOR UPDATE", [peek.signature_id])).rows[0];
    const t = (await c.query("SELECT * FROM subscriber_tokens WHERE token_hash=$1 AND purpose='password_reset' AND used_at IS NULL AND expires_at>now() FOR UPDATE", [sha256(token)])).rows[0];
    if (!t || !cred || !current || cred.channel_revision !== subscriberChannelRevision(current) || cred.version !== t.credential_version || t.source_revision !== subscriberChannelRevision(current)) return false;
    await c.query("UPDATE subscriber_credentials SET password_hash=$2,version=version+1,changed_at=now() WHERE signature_id=$1", [t.signature_id, hash]);
    await c.query("UPDATE subscriber_tokens SET used_at=now() WHERE signature_id=$1 AND used_at IS NULL", [t.signature_id]);
    await c.query("DELETE FROM subscriber_sessions WHERE signature_id=$1", [t.signature_id]);
    await event(c, t.signature_id, "password_reset"); return true;
  });
  if (!applied) fail("token_invalid", "Autorização inválida ou vencida.", 409);
  return { ok: true, message: "Senha alterada. Entre novamente com a nova senha." };
}
export async function subscriberPassword(token: string, newPassword: unknown, confirmation: unknown, ctx: SubscriberContext) {
  assertEnabled(); await limit("password", ctx, sha256(token), 15, 6, 15);
  const plain = password(newPassword, confirmation), hash = hashSenha(plain);
  await tx(async c => {
    const row = await requireSession(token, true, c);
    const active = (await c.query("SELECT version,channel_revision FROM subscriber_credentials WHERE signature_id=$1 FOR UPDATE", [row.id])).rows[0];
    if (!active || active.version !== row.credential_version) fail("authentication_required", "Entre novamente.", 401);
    await c.query("UPDATE subscriber_credentials SET password_hash=$2,version=version+1,changed_at=now() WHERE signature_id=$1", [row.id, hash]);
    await c.query("UPDATE subscriber_tokens SET used_at=now() WHERE signature_id=$1 AND used_at IS NULL", [row.id]);
    await c.query("DELETE FROM subscriber_sessions WHERE signature_id=$1", [row.id]);
    await event(c, row.id, "password_changed");
  });
  return { ok: true, message: "Senha alterada. Entre novamente com a nova senha." };
}

type SubscriberChanges = Record<string, any>;
function proposedChanges(row: Record<string, any>, raw: Record<string, unknown>): SubscriberChanges {
  const allowed = new Set(["revision", "category", "institution", "role", "campus", "campusIbge", "city", "uf", "regionDeclared", "university", "country"]);
  if (Object.keys(raw).some(key => !allowed.has(key))) fail("unsupported_change", "Nome, CPF e e-mail exigem atendimento específico; esta página altera apenas os dados indicados.");
  const category = text(raw.category);
  if ((row.category === "estrangeiro") !== (category === "estrangeiro")) fail("category_change", "A mudança de cadastro nacional para estrangeiro exige atendimento específico.");
  // The authenticated row supplies the unchanged name/email and existing hash.
  // The public signup validator has no browser-controlled bypass.
  const validated = validateSubscriberProfile({ ...raw, name: row.name, email: row.email, consent: true }, row.cpf_hash);
  if (!validated.ok) fail("invalid_change", "Confira os dados da alteração: " + Object.keys(validated.errors).join(", "));
  if (!validated.ok) throw new Error("unreachable");
  const v = validated.value;
  return { category: v.category, institution: v.institution ?? null, role: v.role ?? null,
    campus: v.campus ?? null, campus_ibge: v.campusIbge ?? null, campus_listed: v.campusListed ?? null,
    institution_listed: v.ifesListed ?? null, ifes_acronym: v.ifesListed ? v.institution : null, city: v.city ?? null, city_ibge: v.cityIbge ?? null,
    uf: v.uf ?? null, region_declared: v.regionDeclared ?? null, region_validated: v.regionValidated ?? null,
    region_criteria: v.regionCriteria ?? null, country: v.country ?? null, university: v.university ?? null };
}
export async function subscriberChange(token: string, raw: Record<string, unknown>, ctx: SubscriberContext, send: SubscriberSend = sendDirect) {
  assertEnabled(); await limit("change", ctx, sha256(token), 15, 5, 60);
  const row = await requireSession(token, true);
  if (subscriberRevision(row) !== raw.revision) fail("stale", "O cadastro mudou. Atualize a página antes de solicitar a alteração.", 409);
  if (row.wa_confirmed_at) fail("email_confirmation_required", "Este cadastro precisa de confirmação do e-mail antes de alterar dados.", 409);
  const values = proposedChanges(row, raw), changeToken = newToken();
  const created = await tx(async c => {
    const cred = (await c.query("SELECT version,channel_revision FROM subscriber_credentials WHERE signature_id=$1 FOR UPDATE", [row.id])).rows[0];
    if (!cred || cred.version !== row.credential_version) return false;
    const current = (await c.query("SELECT * FROM signatures WHERE id=$1 FOR UPDATE", [row.id])).rows[0];
    if (!current || subscriberRevision(current) !== raw.revision) return false;
    await c.query("INSERT INTO subscriber_tokens(token_hash,signature_id,purpose,credential_version,source_revision,payload,expires_at) VALUES($1,$2,'signature_change',$3,$4,$5,now()+make_interval(mins=>$6))", [sha256(changeToken), row.id, cred.version, raw.revision, JSON.stringify(values), SUBSCRIBER_TOKEN_MINUTES]);
    await event(c, row.id, "change_requested"); return true;
  });
  if (!created) fail("stale", "O cadastro ou a sessão mudou. Entre novamente e confira os dados.", 409);
  const invalidate = async () => { await query("UPDATE subscriber_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL", [sha256(changeToken)]); };
  const scheduled = scheduleDelivery(async signal => {
    const current = (await query("SELECT * FROM signatures WHERE id=$1", [row.id])).rows[0];
    if (signal.aborted || !current || subscriberRevision(current) !== raw.revision) throw new Error("SUBSCRIBER_CHANGE_STALE");
    const before = Object.keys(values).map(key => `${key}: ${row[key] ?? "-"}`).join("\n");
    const summary = Object.entries(values).map(([key, value]) => `${key}: ${value ?? "-"}`).join("\n");
    await send({ to: row.email, subject: "Confirme a correção dos dados da sua assinatura", text: `Confira os valores exatos da alteração solicitada:\n\nDados atuais:\n${before}\n\nDados solicitados:\n${summary}\n\nPara confirmar, entre com sua senha e abra:\n${canonicalOrigin()}/minha-assinatura/confirmar#token=${changeToken}\n\nA autorização vale ${SUBSCRIBER_TOKEN_MINUTES} minutos e só pode ser usada uma vez. A inscrição e suas datas originais serão preservadas. Se não solicitou, não confirme.` });
    if (signal.aborted) throw new Error("SUBSCRIBER_DELIVERY_TIMEOUT");
  }, invalidate);
  if (!scheduled) { await invalidate(); fail("delivery_unavailable", "A entrega da confirmação está indisponível. Nenhum dado foi alterado.", 503); }
  return { ok: true, message: "Pedido recebido. A correção depende da entrega e da confirmação pelo e-mail já vinculado. Os dados atuais continuam válidos até confirmar." };

}
export async function subscriberConfirmChange(sessionToken: string, token: string, ctx: SubscriberContext) {
  assertEnabled(); await limit("confirm-change", ctx, sha256(token), 20, 8, 15);
  if (!validToken(token)) fail("token_invalid", "Autorização inválida ou vencida.", 409);
  await tx(async c => {
    const row = await requireSession(sessionToken, true, c);
    const cred = (await c.query("SELECT version,channel_revision FROM subscriber_credentials WHERE signature_id=$1 FOR UPDATE", [row.id])).rows[0];
    const current = (await c.query("SELECT * FROM signatures WHERE id=$1 FOR UPDATE", [row.id])).rows[0];
    const t = (await c.query("SELECT * FROM subscriber_tokens WHERE token_hash=$1 AND signature_id=$2 AND purpose='signature_change' AND used_at IS NULL AND expires_at>now() FOR UPDATE", [sha256(token), row.id])).rows[0];
    if (!t) fail("token_invalid", "Autorização inválida ou vencida.", 409);
    if (!current || !cred || cred.channel_revision !== subscriberChannelRevision(current) || current.status !== "confirmed" || cred.version !== t.credential_version || subscriberRevision(current) !== t.source_revision) fail("stale", "O cadastro mudou após o pedido. Solicite uma nova alteração.", 409);
    const values = t.payload as SubscriberChanges;
    const before = Object.fromEntries(Object.keys(values).map(key => [key, current[key] ?? null]));
    const fields = Object.keys(values);
    const expectedFields = new Set(["category","institution","role","campus","campus_ibge","campus_listed","institution_listed","ifes_acronym","city","city_ibge","uf","region_declared","region_validated","region_criteria","country","university"]);
    if (fields.some(field => !expectedFields.has(field))) throw new Error("SUBSCRIBER_CHANGE_PAYLOAD_INVALID");
    await c.query(`UPDATE signatures SET ${fields.map((key, i) => `${key}=$${i+2}`).join(",")} WHERE id=$1`, [row.id, ...fields.map(key => values[key])]);
    await c.query("UPDATE subscriber_tokens SET used_at=now() WHERE token_hash=$1", [sha256(token)]);
    await event(c, row.id, "signature_changed", { before, after: values, channel: "existing_confirmed_email" });
  });
  return { ok: true, message: "Dados corrigidos. Inscrição, nome, CPF e datas originais foram preservados." };
}

/** Cleanup can run with the feature disabled; it never creates tables or touches signatures. */
export async function purgeSubscriberAccess(): Promise<Record<string, number>> {
  const pool = getPool();
  const counts: Record<string, number> = {};
  const cleanup: [string, string][] = [
    ["subscriber_sessions", "expires_at<=now()"],
    ["subscriber_enrollment", "expires_at<=now() OR state<>'reserved'"],
    ["subscriber_tokens", "used_at IS NOT NULL OR expires_at<=now()"],
    ["subscriber_rate_limits", "started_at<now()-interval '24 hours'"],
    ["subscriber_events", "event<>'signature_changed' AND at<now()-interval '30 days'"],
  ];
  for (const [table, predicate] of cleanup) {
    const exists = (await pool.query("SELECT to_regclass($1) AS name", [table])).rows[0].name;
    counts[table] = exists ? (await pool.query(`DELETE FROM ${table} WHERE ${predicate}`)).rowCount ?? 0 : 0;
  }
  return counts;
}
