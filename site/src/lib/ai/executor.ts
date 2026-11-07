import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "../db";
import { safeEqual } from "../security";
import { readLimitedText } from "../http-body";
import { CONFIG_KEY, readConfigurationWith } from "./configuration";
import { prepareAiContext, validateAiContext } from "./context";
import { aiServiceArmed, openAiCredential } from "./execution-gate";
import { openAiDraft, openAiRequest } from "./openai-protocol";
type Actor = { userId: number; email: string };
type Prepared = Extract<Awaited<ReturnType<typeof prepareAiContext>>, { ok: true }>;
type Usage = { inputTokens: number; outputTokens: number };
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
const validActor = (a: Actor) => !!a && Number.isInteger(a.userId) && a.userId>0 && a.userId<=2147483647 && typeof a.email === "string" && a.email.length<=254;
async function actorLevel(c: PoolClient, actor: Actor, lock = false) {
  return (await c.query(`SELECT nivel FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel IN ('edicao','exclusao','total')${lock ? " FOR SHARE" : ""}`, [actor.userId, actor.email.toLowerCase()])).rows[0]?.nivel as string | undefined;
}
async function reserve(requestId: string, context: Prepared, actor: Actor) {
  return tx(async c => {
    await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
    if (!await actorLevel(c, actor, true)) return { ok: false as const, error: "forbidden" };
    // Same lock as configuration updates: serializes reservations even across instances and UTC midnight.
    await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", [CONFIG_KEY]);
    const configuration = await readConfigurationWith(c); if (!configuration.ok) return configuration;
    if (!configuration.config.enabled) return { ok: false as const, error: "disabled" };
    if (configuration.revision !== context.configurationRevision) return { ok: false as const, error: "configuration_conflict" };
    const prior = (await c.query("SELECT id,state,context_hash FROM admin_ai_requests WHERE created_by=$1 AND request_id=$2", [actor.userId, requestId])).rows[0];
    if (prior) return { ok: false as const, error: prior.context_hash === context.proof ? "already_attempted" : "request_conflict", id: prior.id as string, state: prior.state as string };
    const day = (await c.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS budget_day")).rows[0].budget_day;
    const used = (await c.query("SELECT count(*)::int calls,COALESCE(sum(reserved_output_tokens),0)::int tokens FROM admin_ai_requests WHERE day=$1::date", [day])).rows[0];
    const limits = configuration.config.limits;
    if (used.calls >= limits.dailyCalls || used.tokens + limits.maxOutputTokens > limits.dailyOutputTokens) return { ok: false as const, error: "budget_exhausted" };
    const id = randomUUID();
    await c.query(`INSERT INTO admin_ai_requests(id,request_id,created_by,day,purpose,configuration_revision,provider,model,context_hash,source_versions,input_bytes,reserved_output_tokens,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'reserved')`, [id, requestId, actor.userId, day, context.purpose, context.configurationRevision, context.profile.provider, context.profile.model, context.proof, JSON.stringify(context.sources), context.inputBytes, limits.maxOutputTokens]);
    await audit("admin_ai_request_reserved", null, { id, requestId, userId: actor.userId, purpose: context.purpose, configurationRevision: context.configurationRevision, reservedOutputTokens: limits.maxOutputTokens }, c);
    return { ok: true as const, id };
  });
}
async function finish(id: string, state: "completed" | "rejected" | "uncertain" | "discarded", error: string | null, usage?: Usage, responseId?: string, actor?: Actor) {
  return tx(async c => {
    await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
    const actorChanged = state === "completed" && !!actor && !await actorLevel(c, actor, true);
    if (actorChanged) { state = "discarded"; error = "actor_changed"; }
    const changed = await c.query(`UPDATE admin_ai_requests SET state=$2,finished_at=now(),error_code=$3,input_tokens=$4,output_tokens=$5,provider_response_id=$6
      WHERE id=$1 AND state='reserved' RETURNING id`, [id, state, error, usage?.inputTokens ?? null, usage?.outputTokens ?? null, responseId ?? null]);
    if (!changed.rowCount) return { changed: false, actorChanged: false };
    await audit("admin_ai_request_finished", null, { id, state, errorCode: error, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null }, c);
    return { changed: true, actorChanged };
  });
}
type Dependencies = { armed?: boolean; credential?: () => string | null; fetch?: typeof fetch };
/** One external attempt per caller-generated UUID. No prompt/output is persisted, no worker retries an uncertain attempt. */
export async function generateAiDraft(input: unknown, proof: unknown, requestId: unknown, actor: Actor, dependencies: Dependencies = {}) {
  if (!validId(requestId) || !validActor(actor) || typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof)) return { ok: false as const, error: "parameters" };
  if (!(dependencies.armed ?? aiServiceArmed())) return { ok: false as const, error: "disabled" };
  if (!await tx(c => actorLevel(c, actor))) return { ok: false as const, error: "forbidden" };
  const context = await prepareAiContext(input); if (!context.ok) return context;
  if (!safeEqual(context.proof, proof)) return { ok: false as const, error: "context_changed" };
  const request = openAiRequest(context); if (!request.ok) return request;
  const credential = (dependencies.credential ?? openAiCredential)();
  if (!credential) return { ok: false as const, error: "credential_unavailable" };
  const reservation = await reserve(requestId.toLowerCase(), context, actor); if (!reservation.ok) return reservation;
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(request.url, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(45000) });
  } catch {
    try { await finish(reservation.id, "uncertain", "transport_uncertain"); } catch { /* Reservation is durable; never replay it. */ }
    return { ok: false as const, error: "result_uncertain", id: reservation.id };
  }
  try {
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const uncertain = response.status >= 500 || response.status === 408;
      if (!(await finish(reservation.id, uncertain ? "uncertain" : "rejected", uncertain ? "provider_uncertain" : "provider_rejected")).changed) return { ok: false as const, error: "result_uncertain", id: reservation.id };
      return { ok: false as const, error: uncertain ? "result_uncertain" : "provider_rejected", id: reservation.id };
    }
    const body = await readLimitedText(response, 128000);
    if (!body.ok) {
      await finish(reservation.id, "uncertain", "provider_body_unreadable");
      return { ok: false as const, error: "result_uncertain", id: reservation.id };
    }
    let raw: unknown; try { raw = JSON.parse(body.raw); } catch {
      await finish(reservation.id, "discarded", "provider_json_invalid"); return { ok: false as const, error: "provider_response_invalid", id: reservation.id };
    }
    const draft = openAiDraft(raw, context);
    const responseId = typeof (raw as any)?.id === "string" && /^resp_[A-Za-z0-9_-]{1,180}$/.test((raw as any).id) ? (raw as any).id as string : undefined;
    if (!draft.ok) { await finish(reservation.id, "discarded", draft.error, undefined, responseId); return { ok: false as const, error: draft.error, id: reservation.id }; }
    const current = await validateAiContext(input, proof);
    if (!current.ok) { await finish(reservation.id, "discarded", "context_changed", draft.usage, responseId); return { ok: false as const, error: "context_changed", id: reservation.id }; }
    const finalized = await finish(reservation.id, "completed", null, draft.usage, responseId, actor);
    if (!finalized.changed) return { ok: false as const, error: "result_uncertain", id: reservation.id };
    if (finalized.actorChanged) return { ok: false as const, error: "forbidden", id: reservation.id };
    return { ok: true as const, id: reservation.id, draft: draft.draft, usage: draft.usage, requiresHumanReview: true, persisted: false, sent: false };
  } catch {
    // Could be after provider acceptance or while committing metadata. The durable UUID prevents resending.
    try { await finish(reservation.id, "uncertain", "finalization_uncertain"); } catch { /* Keep original reservation. */ }
    return { ok: false as const, error: "result_uncertain", id: reservation.id };
  }
}
/** Status after a lost response: scoped to the current account, even for Total. No persisted draft. */
export async function aiRequestStatus(requestId: unknown, actor: Actor) {
  if (!validId(requestId) || !validActor(actor)) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"); await c.query("SET LOCAL statement_timeout='1500ms'");
    const level = await actorLevel(c, actor); if (!level) return { ok: false as const, error: "forbidden" };
    const row = (await c.query(`SELECT id,request_id,purpose,provider,model,state,created_at,finished_at,input_bytes,reserved_output_tokens,input_tokens,output_tokens,error_code
      FROM admin_ai_requests WHERE request_id=$1 AND created_by=$2`, [requestId, actor.userId])).rows[0];
    return row ? { ok: true as const, request: row, draftAvailable: false } : { ok: false as const, error: "not_found" };
  });
}

/** Total-only operational view. Observed usage is separate from unknown usage and conservative reservations. */
export async function aiDailyUsage(day: unknown, actor: Actor) {
  if (!validActor(actor) || day !== undefined && (typeof day !== "string" || !/^[1-9]\d{3}-\d\d-\d\d$/.test(day) || !Number.isFinite(Date.parse(day + "T00:00:00Z")) || new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day)) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"); await c.query("SET LOCAL statement_timeout='1500ms'");
    if (await actorLevel(c, actor) !== "total") return { ok: false as const, error: "forbidden" };
    const selectedDay = day ?? (await c.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS budget_day")).rows[0].budget_day;
    const totals = (await c.query(`SELECT count(*)::int AS calls,COALESCE(sum(reserved_output_tokens),0)::bigint AS reserved_output_tokens,
      COALESCE(sum(input_tokens),0)::bigint AS observed_input_tokens,COALESCE(sum(output_tokens),0)::bigint AS observed_output_tokens,
      count(*) FILTER(WHERE input_tokens IS NULL OR output_tokens IS NULL)::int AS unknown_usage_calls,
      count(*) FILTER(WHERE state='reserved')::int AS reserved_calls,count(*) FILTER(WHERE state='uncertain')::int AS uncertain_calls
      FROM admin_ai_requests WHERE day=$1::date`, [selectedDay])).rows[0];
    for (const key of ["reserved_output_tokens", "observed_input_tokens", "observed_output_tokens"]) { totals[key] = Number(totals[key]); if (!Number.isSafeInteger(totals[key])) throw new Error("usage_range"); }
    const rows = (await c.query(`SELECT id,request_id,created_by,purpose,provider,model,state,created_at,finished_at,reserved_output_tokens,input_tokens,output_tokens,error_code,provider_response_id
      FROM admin_ai_requests WHERE day=$1::date ORDER BY created_at DESC,id DESC LIMIT 101`, [selectedDay])).rows;
    return { ok: true as const, day: selectedDay as string, totals, records: rows.slice(0, 100), truncated: rows.length > 100, currencyEstimate: false };
  });
}
