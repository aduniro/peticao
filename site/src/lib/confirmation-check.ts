import { query } from "./db";
import { sha256, hmac, safeEqual } from "./security";
import { isValidCpf, onlyDigits } from "./cpf";
import { cachedCpfRecordByHash } from "./cpf-cache";
import { classifyCpfName } from "./cpf-name";
import { defaultProvider, type CpfProvider } from "./cpf-check";
import { verifyCpfName, verifyIdentity, type IdentityMethod } from "./identity";
import { institutionalKind } from "./institutional";
import { titleCaseName } from "./name-case";
import { rateLimit } from "./ratelimit";
import type { ConfirmationProof } from "./signatures";

type Attempt = { name?: unknown; cpf?: unknown; identity?: { method?: unknown; value?: unknown } };
type Result = { ok: true; proof?: ConfirmationProof } | { ok: false; status: number; json: Record<string, unknown> };
type Pending = { id: number; name: string; email: string; category: string; cpf_hash: string | null; cpf_name_check: string | null; identity_method: string | null; expires: string };

/** Only a bearer of a live confirmation token can inspect or correct the declared name. */
export async function checkConfirmation(token: string, channel: "email" | "whatsapp", attempt?: Attempt, provider: CpfProvider | null = defaultProvider()): Promise<Result> {
  const fail = (result: string, extra: Record<string, unknown> = {}, status = 200): Result => ({ ok: false, status, json: { result, ...extra } });
  if (!token || token.length > 200) return fail("invalid");
  const rows = (await query<Pending>(channel === "email"
    ? "SELECT id,name,email,category,cpf_hash,cpf_name_check,identity_method,token_expires_at AS expires FROM signatures WHERE token_hash=$1 AND status='pending'"
    : "SELECT id,name,email,category,cpf_hash,cpf_name_check,identity_method,wa_token_expires_at AS expires FROM signatures WHERE wa_token_hash=$1 AND status='pending'", [sha256(token)])).rows;
  const row = rows[0];
  if (!row) return fail("invalid");
  if (!row.expires || !Number.isFinite(Date.parse(row.expires)) || Date.parse(row.expires) <= Date.now()) return fail("expired");
  if (row.category === "estrangeiro") return { ok: true };
  if (!row.cpf_hash) return fail("invalid");
  if (!rateLimit(`confirm-check:${row.id}`, 12, 60 * 60_000)) return fail("locked", {}, 429);

  const proof = (name: string, method: string): Result => ({ ok: true, proof: { id: row.id, originalName: row.name, originalEmail: row.email, cpfHash: row.cpf_hash!, correctedName: name, identityMethod: method } });
  const review = (errors?: Record<string, string>) => fail("review_required", { name: row.name, ...(errors ? { errors } : {}) });
  if (!attempt) {
    if (channel === "email" && row.cpf_name_check === "match") {
      const record = await cachedCpfRecordByHash(row.cpf_hash);
      const match = record ? classifyCpfName(record.nome, row.name) : "mismatch";
      const challenged = row.identity_method === "mae" || row.identity_method === "nascimento";
      if ((match === "complete" && (challenged || row.identity_method === "email_institucional")) || (match === "partial" && challenged)) {
        return proof(row.name, row.identity_method!);
      }
    }
    return review();
  }
  const raw = typeof attempt.name === "string" ? attempt.name.trim() : "";
  const name = titleCaseName(raw, { final: true });
  if (raw.length > 120 || name.length < 5 || name.split(/\s+/).length < 2) return review({ name: "name_required" });
  if (/[^\p{L}\p{M}\s.'’ʼ-]/u.test(raw)) return review({ name: "name_cpf_mismatch" });
  const cpf = onlyDigits(typeof attempt.cpf === "string" ? attempt.cpf : "");
  if (!isValidCpf(cpf)) return fail("cpf_mismatch", { errors: { cpf: "cpf_invalid" } });
  if (!safeEqual(hmac(cpf), row.cpf_hash)) return fail("cpf_mismatch");
  if (!provider) return fail("identity", { code: "unavailable" }, 503);
  const gate = await verifyCpfName({ cpf, declaredName: name, provider });
  if (!gate.ok && gate.reason !== "identity_required") {
    if (gate.reason === "mismatch") return review({ name: "name_cpf_mismatch" });
    if (gate.reason === "locked") return fail("identity", { code: "locked" }, 429);
    if (gate.reason === "not_found") return fail("review_required", { name: row.name, errors: { cpf: "cpf_not_found" } });
    return fail("identity", { code: "unavailable" }, 503);
  }
  const kind = await institutionalKind(row.email);
  const needs = channel === "whatsapp" || kind === null || kind === "discente" || !gate.ok;
  if (!needs) return proof(name, "email_institucional");
  if (!attempt.identity) return fail("identity_required");
  const identity = await verifyIdentity({ cpf, declaredName: name, method: attempt.identity.method as IdentityMethod, value: typeof attempt.identity.value === "string" ? attempt.identity.value : "", provider });
  if (!identity.ok) {
    if (identity.reason === "name_mismatch") return review({ name: "name_cpf_mismatch" });
    return fail("identity", { code: identity.reason, attemptsLeft: identity.attemptsLeft }, identity.reason === "unavailable" ? 503 : identity.reason === "locked" ? 429 : 200);
  }
  return proof(name, attempt.identity.method as string);
}
