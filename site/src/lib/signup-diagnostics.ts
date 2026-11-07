import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { query, tx, audit } from "./db";
import { hmac } from "./security";
import { dedupEmail } from "./email-check";
import { SAFE_EMAIL_RE } from "./email-syntax";
import { encryptCpfCache, decryptCpfCache } from "./cpf-cache-crypto";
import { classifyCpfName } from "./cpf-name";
import policy from "@/content/name-validation-policy.json";
import type { CpfProvider, CpfRecord } from "./cpf-check";

export const DIAGNOSTIC_DAYS = 30;
export const validTrace = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const categories = new Set(["servidor", "apoiador", "estrangeiro"]);
const methods = new Set(["nome", "mae", "nascimento"]);
const phases = new Set(["name", "identity", "provider", "cache", "submission"]);
const codes = new Set(["match", "mismatch", "partial", "complete", "identity_required", "name_mismatch", "locked", "unavailable", "method_unavailable", "bad_input", "mock_unknown", "not_found", "found", "hit", "miss", "bypass", "duplicate", "recreated", "created", "queued", "sent", "send_failed", "race_duplicate", "ignored"]);
const fields = new Set(["name", "email", "cpf", "institution", "role", "campus", "city", "uf", "country", "university", "consent", "regionDeclared", "whatsapp", "whatsappConsent", "identity"]);
const browserEvents = new Set(["started", "field_touched", "browser_invalid", "submit_click", "page_hidden", "page_exit", "client_result"]);
const outcomes = new Set(["accepted", "rejected", "identity_required", "network_error"]);
const version = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
type Mark = { phase: string; code: string; method?: string; analysis?: ReturnType<typeof explainName> };
type Scope = { marks: Mark[]; };
const scope = new AsyncLocalStorage<Scope>();

/** All values returned here are fixed codes/counts. Never persist names or normalized name tokens. */
export function explainName(registered: string, typed: string) {
  const tokens = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().split(/[\s-]+/u).map(w => w.replace(/['’ʼ]/g, "").replace(/\.$/, "")).filter(w => w && !(policy.ignored_particles as string[]).includes(w));
  const r = tokens(registered), t = tokens(typed), match = classifyCpfName(registered, typed);
  let reason = match === "mismatch" ? "spelling_or_different_name" : match;
  if (match === "mismatch") {
    if (r.join("") === t.join("") && r.join(" ") !== t.join(" ")) reason = "word_boundaries";
    else if (r.length === t.length && [...r].sort().join(" ") === [...t].sort().join(" ")) reason = "word_order";
    else if (t.length > r.length) reason = "extra_words";
    else if (t.length < (r.length === 2 ? 2 : r.length === 3 ? 2 : 3)) reason = "insufficient_words";
  }
  return { match, reason, registryWords: Math.min(r.length, 80), typedWords: Math.min(t.length, 80) };
}
export function diagnosticMark(phase: string, code: string, method?: string) {
  if (!phases.has(phase) || !codes.has(code)) return;
  const current = scope.getStore(); if (!current || current.marks.length >= 20) return;
  current.marks.push({ phase, code, ...(method && methods.has(method) ? { method } : {}) });
}
export function diagnosticProvider(provider: CpfProvider | null, declaredName: unknown): CpfProvider | null {
  if (!provider) return null;
  return { name: provider.name, async lookup(cpf) {
    try {
      const rec: CpfRecord | null = await provider.lookup(cpf);
      diagnosticMark("provider", rec ? "found" : "not_found");
      if (rec && typeof declaredName === "string" && declaredName.length <= 200) {
        const current = scope.getStore(); if (current && current.marks.length < 20) { const analysis = explainName(rec.nome, declaredName); current.marks.push({ phase: "name", code: analysis.match, analysis }); }
      }
      return rec;
    } catch (error) { diagnosticMark("provider", "unavailable"); throw error; }
  } };
}
async function schema(c: import("pg").PoolClient) {
  await c.query("SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='1000ms'");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signup-diagnostic-schema-v1',0))");
  await c.query(`CREATE TABLE IF NOT EXISTS signup_diagnostics (
    id UUID PRIMARY KEY, trace_id UUID NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL, classification TEXT NOT NULL, category TEXT, http_status INTEGER,
    duration_ms INTEGER, learning_index TEXT NOT NULL, policy_version TEXT NOT NULL,
    metadata JSONB NOT NULL, email_cipher TEXT, email_hash TEXT);
    CREATE INDEX IF NOT EXISTS signup_diagnostics_time ON signup_diagnostics(ts DESC,id);
    CREATE INDEX IF NOT EXISTS signup_diagnostics_trace ON signup_diagnostics(trace_id,ts);
    CREATE INDEX IF NOT EXISTS signup_diagnostics_learning ON signup_diagnostics(learning_index,ts);
    CREATE INDEX IF NOT EXISTS signup_diagnostics_expiry ON signup_diagnostics(expires_at)`);
}
export async function persistDiagnostic(row: { trace: string; source: "server" | "browser"; classification: string; category: string | null; status: number | null; ms: number | null; metadata: Record<string, unknown>; email?: string }) {
  try {
    const id = randomUUID(), email = row.email;
    let emailCipher: string | null = null;
    if (email) { try { emailCipher = encryptCpfCache(email, `signup-contact:v1:${id}`); } catch { /* Preserve technical evidence when contact encryption is unavailable. */ } }
    const learning = createHash("sha256").update(JSON.stringify({ policy: version, source: row.source, classification: row.classification, metadata: row.metadata })).digest("hex");
    await tx(async c => {
      await schema(c);
      await c.query("INSERT INTO signup_diagnostics(id,trace_id,expires_at,source,classification,category,http_status,duration_ms,learning_index,policy_version,metadata,email_cipher,email_hash) VALUES($1,$2,now()+interval '30 days',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [id,row.trace,row.source,row.classification,row.category,row.status,row.ms,learning,policy.version,JSON.stringify(row.metadata),emailCipher,emailCipher && email ? hmac(dedupEmail(email)) : null]);
    }); return true;
  } catch { console.warn("[signup-diagnostics] write_unavailable"); return false; }
}
export async function withSignupDiagnostics<T extends { status: number; json: Record<string, unknown> }>(trace: unknown, body: unknown, run: (provider: CpfProvider | null) => Promise<T>, provider: CpfProvider | null): Promise<T> {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const started = Date.now(), current: Scope = { marks: [] };
  return scope.run(current, async () => {
    let result: T | undefined;
    try { result = await run(diagnosticProvider(provider, input.name)); return result; }
    finally {
      const errors = result?.json.errors && typeof result.json.errors === "object" ? Object.keys(result.json.errors).filter(k => fields.has(k)) : [];
      const duplicate = current.marks.some(m => m.code === "duplicate" || m.code === "race_duplicate");
      const ignored = current.marks.some(m => m.code === "ignored");
      const classification = ignored ? "ignored_bot" : !result ? "internal_error" : duplicate ? "duplicate" : result.json.identityRequired ? "identity_required" : result.json.ok === true ? "registration_submitted" : result.status === 429 ? "rate_limited" : "validation_failed";
      const email = input.consent === true && typeof input.email === "string" && input.email.length <= 254 && SAFE_EMAIL_RE.test(input.email.trim()) && !input.website ? input.email.trim().toLowerCase() : undefined;
      await persistDiagnostic({ trace: validTrace(trace) ? trace : randomUUID(), source: "server", classification, category: categories.has(String(input.category)) ? String(input.category) : null, status: result?.status ?? 500, ms: Math.min(Date.now()-started,2147483647), metadata: { errorFields: errors, marks: current.marks }, email });
    }
  });
}
export function parseBrowserDiagnostic(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !["trace", "event", "category", "field", "outcome"].includes(k)) || !validTrace(r.trace) || !browserEvents.has(String(r.event))) return null;
  if (typeof r.event !== "string" || r.field !== undefined && (typeof r.field !== "string" || !fields.has(r.field)) || r.category !== undefined && (typeof r.category !== "string" || !categories.has(r.category)) || r.outcome !== undefined && (typeof r.outcome !== "string" || !outcomes.has(r.outcome))) return null;
  return { trace: r.trace, source: "browser" as const, classification: String(r.event), category: r.category ? String(r.category) : null, status: null, ms: null, metadata: { ...(r.field ? { field: r.field } : {}), ...(r.outcome ? { outcome: r.outcome } : {}) } };
}
export async function purgeSignupDiagnostics() {
  try { return await tx(async c => { await schema(c); return (await c.query("DELETE FROM signup_diagnostics WHERE id IN (SELECT id FROM signup_diagnostics WHERE expires_at<=now() LIMIT 2000)")).rowCount ?? 0; }); }
  catch { return 0; }
}
export async function readSignupDiagnostics(limit: number, includeEmail: boolean) {
  return tx(async c => {
    await schema(c);
    const rows = (await c.query("SELECT id,trace_id,ts,source,classification,category,http_status,duration_ms,learning_index,policy_version,metadata,email_cipher FROM signup_diagnostics WHERE expires_at>now() ORDER BY ts DESC,id LIMIT $1", [Math.min(100,Math.max(1,limit))])).rows;
    await audit("signup_diagnostics_read", null, { count: rows.length, includeEmail }, c);
    return rows.map(({email_cipher,...r}) => ({...r, ...(includeEmail ? { email: email_cipher ? decryptCpfCache(email_cipher,`signup-contact:v1:${r.id}`) : null } : {})}));
  });
}
