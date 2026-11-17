import { query } from "./db";
let nextGc=0;
/** Bounded housekeeping; never deletes evidence, candidates or name history. */
export async function purgeSignupEphemera(force=false) {
  if(!force && Date.now()<nextGc)return;
  nextGc=Date.now()+3600_000;
  await query("DELETE FROM ncpf_intents WHERE id IN (SELECT id FROM ncpf_intents WHERE expires_at<now()-interval '48 hours' LIMIT 1000 FOR UPDATE SKIP LOCKED)");
  await query("DELETE FROM signup_receipts WHERE request_hash IN (SELECT request_hash FROM signup_receipts WHERE expires_at<now()-interval '48 hours' LIMIT 1000 FOR UPDATE SKIP LOCKED)");
  await query("DELETE FROM confirmation_receipts WHERE token_hash IN (SELECT token_hash FROM confirmation_receipts WHERE expires_at<now()-interval '48 hours' LIMIT 1000 FOR UPDATE SKIP LOCKED)");
}
