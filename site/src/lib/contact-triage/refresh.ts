import { audit, tx } from "../db";
import { analyze, ENGINE } from "./analyze";
import { collectEvidence, currentInputHash } from "./evidence";
import { analysisFingerprint, evidenceFingerprint } from "./fingerprint";
const CURSOR="contact_triage_refresh_cursor";
/** Claim a bounded, round-robin scan. A crash can delay a check until the next wrap, never erase a revision. */
async function claim(limit:number) {
  return tx(async c=>{
    await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='2000ms'");
    await c.query("INSERT INTO settings(key,value) VALUES($1,'0') ON CONFLICT DO NOTHING",[CURSOR]);
    const raw=(await c.query<{value:string}>("SELECT value FROM settings WHERE key=$1 FOR UPDATE",[CURSOR])).rows[0].value;
    const before=/^\d{1,10}$/.test(raw)&&Number(raw)<=2147483647?Number(raw):0;
    const read=async(after:number)=>(await c.query(`SELECT c.id contact_id,j.id job_id,j.revision,j.input_hash,j.evidence,j.analysis
      FROM contact_messages c JOIN LATERAL(SELECT id,revision,status,engine,input_hash,evidence,analysis FROM contact_triage_jobs WHERE contact_id=c.id ORDER BY revision DESC LIMIT 1) j ON true
      WHERE c.id>$1 AND j.status='complete' AND j.engine=$2 AND j.evidence IS NOT NULL ORDER BY c.id LIMIT $3`,[after,ENGINE,limit])).rows;
    let rows=await read(before);if(!rows.length&&before)rows=await read(0);
    await c.query("UPDATE settings SET value=$2 WHERE key=$1",[CURSOR,String(rows.length?rows[rows.length-1].contact_id:0)]);
    return rows;
  });
}
/** Checks only completed current-engine reviews. Failed/exhausted work still requires the existing explicit reanalysis path. */
export async function refreshTriages(limit=2,options:{collect?:typeof collectEvidence;deadline?:number}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>10||options.deadline!==undefined&&!Number.isFinite(options.deadline))throw new Error("parameters");
  const end=options.deadline??Date.now()+2500,report={scanned:0,queued:0,unchanged:0,unavailable:0,stale:0};
  if(Date.now()>=end)return report;
  const rows=await claim(limit);
  for(const row of rows){
    if(Date.now()>=end)break;report.scanned++;
    try{
      const snapshot=await(options.collect??collectEvidence)(row.contact_id);
      if(!snapshot){report.unavailable++;continue;}
      if(snapshot.inputHash===row.input_hash&&evidenceFingerprint(snapshot.evidence)===evidenceFingerprint(row.evidence)&&row.analysis&&analysisFingerprint(analyze(snapshot.evidence))===analysisFingerprint(row.analysis)){report.unchanged++;continue;}
      const added=await tx(async c=>{
        await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='2000ms'");
        const current=await currentInputHash(c,row.contact_id);
        if(current!==snapshot.inputHash)return false;
        const latest=(await c.query("SELECT id,status,engine FROM contact_triage_jobs WHERE contact_id=$1 ORDER BY revision DESC LIMIT 1",[row.contact_id])).rows[0];
        if(!latest||latest.id!==row.job_id||latest.status!=="complete"||latest.engine!==ENGINE)return false;
        const next=(await c.query<{id:number}>("INSERT INTO contact_triage_jobs(contact_id,revision,engine,requested_by) VALUES($1,$2,$3,'system:evidence-refresh') RETURNING id",[row.contact_id,row.revision+1,ENGINE])).rows[0];
        await audit("contact_triage_refresh_requested",null,{contactId:row.contact_id,previousJobId:row.job_id,jobId:next.id,revision:row.revision+1,by:"evidence-refresh"},c);
        return true;
      });
      if(added)report.queued++;else report.stale++;
    }catch{report.unavailable++;}
  }
  return report;
}
