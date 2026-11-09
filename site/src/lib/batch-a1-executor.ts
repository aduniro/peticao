import { query } from "./db";
import { claimA1Job, failA1Job, finishA1Job } from "./batch-a1-jobs";
import { requestA1Worker } from "./a1-worker-client";
import { a1ValidationReady, verifyA1Pdf } from "./a1-validation";
import { checkSignedPdf } from "./signed-pdf";

const dependencies = { query, claim: claimA1Job, fail: failA1Job, finish: finishA1Job, worker: requestA1Worker, verify: verifyA1Pdf, validationReady: a1ValidationReady };
/** Called only by the authenticated server scheduler; never by a read or an approval action. */
export async function runQueuedA1Job(deps = dependencies) {
  if (process.env.BATCH_A1_ENABLED !== "1" || !deps.validationReady()) return { ran: false, state: "disabled" };
  const next = (await deps.query<{ id: string; revision: number }>("SELECT id,revision FROM batch_a1_jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1")).rows[0];
  if (!next) return { ran: false, state: "empty" };
  const claim = await deps.claim(next.id, next.revision);
  if (!claim.ok) return { ran: false, state: "not_claimed" };
  const fail = (code: "worker_unavailable" | "validation_failed" | "input_mismatch" | "result_uncertain") => deps.fail(next.id, claim.leaseToken, claim.job.revision, code);
  try {
    const signed = await deps.worker(claim.binding, claim.bytes);
    if (!signed.ok) { await fail("worker_unavailable"); return { ran: true, state: "worker_unavailable" }; }
    // A synthetic CA cannot become a production signature through configuration alone.
    if (process.env.NODE_ENV !== "test" && signed.report.environment !== "production") {
      await fail("validation_failed"); return { ran: true, state: "validation_failed" };
    }
    if (!checkSignedPdf(claim.bytes, signed.bytes).ok) {
      await fail("input_mismatch"); return { ran: true, state: "input_mismatch" };
    }
    const checked = await deps.verify(signed.bytes, claim.binding);
    if (!checked.ok) { await fail("validation_failed"); return { ran: true, state: "validation_failed" }; }
    const result = await deps.finish(next.id, claim.leaseToken, claim.job.revision, signed.bytes, checked.proof);
    return { ran: true, state: result.ok ? "succeeded" : "not_published" };
  } catch {
    // A lost final response is reconciled by GET. There is no automatic signing retry.
    await fail("result_uncertain").catch(() => undefined);
    return { ran: true, state: "result_uncertain" };
  }
}
