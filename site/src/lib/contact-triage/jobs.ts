import { randomBytes } from "node:crypto";
import { audit, query, tx } from "../db";
import { analyze, ENGINE } from "./analyze";
import { collectEvidence, currentInputHash } from "./evidence";
import { refreshTriages } from "./refresh";
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;

/** Reprocessing creates a new revision; never mutates completed reviews or reply decisions. */
export async function requestTriage(contactId: unknown, actor: string) {
  if (!validId(contactId)) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    if (!(await c.query("SELECT id FROM contact_messages WHERE id=$1 FOR UPDATE", [contactId])).rowCount) return { ok: false as const,error: "not_found" };
    const active = (await c.query<{ id: number; revision: number }>("SELECT id,revision FROM contact_triage_jobs WHERE contact_id=$1 AND status IN ('queued','running')", [contactId])).rows[0];
    if (active) return { ok: true as const,...active,existing: true };
    const revision = (await c.query<{ revision: number }>("SELECT COALESCE(max(revision),0)::int+1 revision FROM contact_triage_jobs WHERE contact_id=$1", [contactId])).rows[0].revision;
    const id = (await c.query<{ id: number }>("INSERT INTO contact_triage_jobs(contact_id,revision,engine,requested_by) VALUES($1,$2,$3,$4) RETURNING id", [contactId,revision,ENGINE,actor])).rows[0].id;
    await audit("contact_triage_requested", null, { contactId,revision,id,by: actor }, c);
    return { ok: true as const,id,revision,existing: false };
  });
}

/** Backlog discovery is bounded and idempotent, including messages received while the worker was offline. */
export async function discoverTriages(limit = 25): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("parameters");
  return tx(async c => {
    const rows = (await c.query<{ id: number }>(`SELECT c.id FROM contact_messages c WHERE NOT EXISTS (SELECT 1 FROM contact_triage_jobs j WHERE j.contact_id=c.id)
      ORDER BY c.id LIMIT $1 FOR UPDATE OF c SKIP LOCKED`, [limit])).rows;
    const ids: number[] = [];
    for (const row of rows) {
      const added = await c.query<{ id: number }>("INSERT INTO contact_triage_jobs(contact_id,revision,engine) VALUES($1,1,$2) ON CONFLICT DO NOTHING RETURNING id", [row.id,ENGINE]);
      if (added.rows[0]) ids.push(added.rows[0].id);
    }
    if (ids.length) await audit("contact_triage_discovered", null, { jobs: ids }, c);
    return ids.length;
  });
}

async function claim() {
  return tx(async c => {
    const exhausted = (await c.query<{ id: number }>(`WITH expired AS (SELECT id FROM contact_triage_jobs WHERE status='running' AND lease_until<clock_timestamp() AND attempts>=3 ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED)
      UPDATE contact_triage_jobs j SET status='failed',finished_at=now(),error_code='attempts_exhausted',lease_token=NULL,lease_until=NULL FROM expired WHERE j.id=expired.id RETURNING j.id`)).rows;
    if (exhausted.length) await audit("contact_triage_exhausted", null, { jobs: exhausted.map(r => r.id) }, c);
    const row = (await c.query<{ id: number; contact_id: number; revision: number }>(`SELECT id,contact_id,revision FROM contact_triage_jobs WHERE attempts<3 AND
      ((status='queued' AND next_attempt_at<=clock_timestamp()) OR (status='running' AND lease_until<clock_timestamp())) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if (!row) return null;
    const token = randomBytes(16).toString("hex");
    await c.query("UPDATE contact_triage_jobs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '2 minutes',error_code=NULL WHERE id=$1", [row.id,token]);
    await audit("contact_triage_started", null, { job: row.id,contactId: row.contact_id,revision: row.revision }, c);
    return { ...row,token };
  });
}

/** All work is read-only/pure until conditional finalization. A stale worker cannot publish a result. */
export async function processTriage(options: { collect?: typeof collectEvidence } = {}) {
  const job = await claim();
  if (!job) return { status: "idle" as const };
  try {
    const snapshot = await (options.collect ?? collectEvidence)(job.contact_id);
    if (!snapshot) throw new Error("missing_contact");
    const analysis = analyze(snapshot.evidence);
    // Keep free text in the original contact only; archive the structured evidence.
    const { message: _message, ...contact } = snapshot.evidence.contact;
    const storedEvidence = { ...snapshot.evidence, contact };
    return await tx(async c => {
      const current = await currentInputHash(c, job.contact_id);
      const same = current === snapshot.inputHash;
      const updated = await c.query(`UPDATE contact_triage_jobs SET status=$3,finished_at=CASE WHEN $3='complete' THEN now() ELSE NULL END,
        input_hash=$4,evidence=$5,analysis=$6,lease_token=NULL,lease_until=NULL,error_code=$7,
        attempts=CASE WHEN $3='queued' THEN GREATEST(attempts-1,0) ELSE attempts END,
        next_attempt_at=CASE WHEN $3='queued' THEN now()+interval '5 seconds' ELSE next_attempt_at END
        WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>clock_timestamp() RETURNING id`,
      [job.id,job.token,same ? "complete" : "queued",same ? snapshot.inputHash : null,same ? JSON.stringify(storedEvidence) : null,same ? JSON.stringify(analysis) : null,same ? null : "source_changed"]);
      if (!updated.rowCount) return { status: "stale" as const,id: job.id };
      await audit(same ? "contact_triage_completed" : "contact_triage_source_changed", null, { job: job.id,contactId: job.contact_id,revision: job.revision,engine: ENGINE }, c);
      return { status: same ? "complete" as const : "queued" as const,id: job.id };
    });
  } catch {
    return tx(async c => {
      const updated = await c.query<{ status: string }>(`UPDATE contact_triage_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
        finished_at=CASE WHEN attempts>=3 THEN now() ELSE NULL END,next_attempt_at=now()+interval '30 seconds',lease_token=NULL,lease_until=NULL,error_code='evidence_failure'
        WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>clock_timestamp() RETURNING status`, [job.id,job.token]);
      if (!updated.rows[0]) return { status: "stale" as const,id: job.id };
      await audit("contact_triage_attempt_failed", null, { job: job.id,contactId: job.contact_id,status: updated.rows[0].status }, c);
      return { status: updated.rows[0].status,id: job.id };
    });
  }
}

export async function drainTriages(limit = 3) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("parameters");
  const discovered = await discoverTriages(25), results = [];
  const deadline = Date.now() + 10_000;
  for (let i = 0; i < limit && Date.now() < deadline; i++) { const result = await processTriage(); if (result.status === "idle") break; results.push(result); }
  // Share the existing between-request budget. Freshening only enqueues another immutable revision.
  try { const refresh=await refreshTriages(2,{deadline});return { discovered,processed: results.length,results,refresh }; }
  catch { return { discovered,processed: results.length,results,refreshError:"refresh_failed" }; }
}

export async function triageHistory(contactId: unknown) {
  if (!validId(contactId)) return null;
  return (await query("SELECT id,contact_id,revision,engine,status,requested_by,created_at,finished_at,attempts,error_code,evidence,analysis FROM contact_triage_jobs WHERE contact_id=$1 ORDER BY revision DESC LIMIT 10", [contactId])).rows;
}
