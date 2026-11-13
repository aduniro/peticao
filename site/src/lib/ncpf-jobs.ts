import { randomUUID } from "node:crypto";
import { query, tx } from "./db";
import { decryptCpfCache } from "./cpf-cache-crypto";
import { consolidateEvidence, enqueueCpf, findEvidence, ncpfEnabled, ncpfQueriesEnabled, saveTrtEvidence } from "./ncpf-store";

export async function seedConsolidation(limit = 25) {
  if (!ncpfEnabled()) return;
  const rows = (await query<{signature_id:number;payload:string;name_evidence_id:string|null}>(`SELECT c.signature_id,c.payload,s.name_evidence_id FROM ncpf_candidates c JOIN signatures s ON s.id=c.signature_id
    WHERE s.status='confirmed' AND s.name_projected_at IS NULL
    AND (s.name_evidence_id IS NOT NULL OR EXISTS(SELECT 1 FROM ncpf_evidence e WHERE e.cpf_hash=c.cpf_hash AND e.expires_at>now()) OR
      NOT EXISTS(SELECT 1 FROM ncpf_jobs j WHERE j.cpf_hash=c.cpf_hash AND (j.state IN ('queued','running','retry') OR (j.state='not_found' AND j.next_run_at>now())))) LIMIT $1`,[limit])).rows;
  for (const r of rows) {
    const cpf=decryptCpfCache(r.payload,`ncpf-candidate:${r.signature_id}`);
    if(cpf){
      // A previously validated signature may project its pinned content after
      // the lookup TTL; this does not authorize a new identity validation.
      const cached=await findEvidence(cpf,undefined,undefined,!!r.name_evidence_id);
      if(cached){
        await consolidateEvidence(cached);
        const {hmac}=await import('./security');
        await query("UPDATE ncpf_jobs SET state='done',evidence_id=$2,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE cpf_hash=$1 AND state IN ('queued','retry')",[hmac(cpf),cached.id]);
      }
      else if(ncpfQueriesEnabled())await enqueueCpf(cpf,"consolidation");
    }
  }
}
export async function afterSignatureConfirmed(id:number) {
  if (!ncpfEnabled()) return;
  const r=(await query<{payload:string;name_evidence_id:string|null}>("SELECT c.payload,s.name_evidence_id FROM ncpf_candidates c JOIN signatures s ON s.id=c.signature_id WHERE c.signature_id=$1",[id])).rows[0];
  if (!r) return;
  const cpf=decryptCpfCache(r.payload,`ncpf-candidate:${id}`); if (!cpf) return;
  const evidence=await findEvidence(cpf,undefined,undefined,!!r.name_evidence_id);
  if (evidence) await consolidateEvidence(evidence);
  else if (ncpfQueriesEnabled()) await enqueueCpf(cpf,"consolidation");
}

export async function claimJob() {
  if (!ncpfQueriesEnabled()) return null;
  return tx(async c => {
    await c.query("SELECT pg_advisory_xact_lock(7041313)");
    if ((await c.query("SELECT 1 FROM ncpf_jobs WHERE state='running' AND lease_until>now() LIMIT 1")).rowCount) return null;
    const recent=(await c.query<{purpose:string}>("SELECT purpose FROM ncpf_jobs WHERE state IN ('done','not_found') ORDER BY updated_at DESC LIMIT 4")).rows;
    const background=recent.length===4 && recent.every(r=>r.purpose==='interactive');
    const row=(await c.query<{id:string;cpf_hash:string;payload:string}>(`SELECT id,cpf_hash,payload FROM ncpf_jobs WHERE
      ((state IN ('queued','retry') AND next_run_at<=now()) OR (state='running' AND lease_until<=now()))
      ORDER BY CASE WHEN purpose=$1 THEN 0 ELSE 1 END,created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[background?'consolidation':'interactive'])).rows[0];
    if (!row) return null;
    const cpf=decryptCpfCache(row.payload,`ncpf:v1:${row.cpf_hash}:${row.id}`);
    if (!cpf) { await c.query("UPDATE ncpf_jobs SET state='not_found',lease_token=NULL,lease_until=NULL,last_error='invalid_payload',updated_at=now() WHERE id=$1",[row.id]); return null; }
    const cached=await findEvidence(cpf,undefined,c);
    if(cached){
      await consolidateEvidence(cached,c);
      await c.query("UPDATE ncpf_jobs SET state='done',evidence_id=$2,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[row.id,cached.id]);
      return null;
    }
    const token=randomUUID();
    await c.query("UPDATE ncpf_jobs SET state='running',lease_token=$2,lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() WHERE id=$1",[row.id,token]);
    return { id:row.id,leaseToken:token,cpf,leaseSeconds:300 };
  });
}
export async function heartbeatJob(id:string,token:string):Promise<boolean> {
  return !!(await query("UPDATE ncpf_jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now()",[id,token])).rowCount;
}
const errors=new Set(['timeout','source_unavailable','invalid_document','not_found','worker_error']);
export async function failJob(id:string,token:string,error:string):Promise<boolean> {
  const reason=errors.has(error)?error:'worker_error';
  return !!(await query(`UPDATE ncpf_jobs SET state=CASE WHEN $3='not_found' THEN 'not_found' ELSE 'retry' END,
    next_run_at=now()+CASE WHEN $3='not_found' THEN interval '6 hours' WHEN attempts=1 THEN interval '1 minute' WHEN attempts=2 THEN interval '5 minutes' WHEN attempts=3 THEN interval '30 minutes' ELSE interval '6 hours' END,
    lease_token=NULL,lease_until=NULL,last_error=$3,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now()`,[id,token,reason])).rowCount;
}
export async function completeJob(id:string,token:string,data:Parameters<typeof saveTrtEvidence>[0]) {
  const evidence=await tx(async c => {
    const r=(await c.query<{cpf_hash:string}>("SELECT cpf_hash FROM ncpf_jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() FOR UPDATE",[id,token])).rows[0];
    const {hmac}=await import('./security');
    if (!r || r.cpf_hash!==hmac(data.cpf.replace(/\D/g,''))) throw new Error('stale_job_lease');
    const evidence=await saveTrtEvidence(data,c);
    await consolidateEvidence(evidence,c);
    await c.query("UPDATE ncpf_jobs SET state='done',evidence_id=$2,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1",[id,evidence.id]);
    return evidence;
  });
  return {ok:true};
}
