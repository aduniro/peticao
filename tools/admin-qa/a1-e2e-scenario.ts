import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {NextRequest} from "next/server";
import {_openForTests,_closeDbForTests,query} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/db";
import {abrirSessao} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/admin-users";
import {createBatch,documentVersion,type ApprovalRow} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batches";
import {GET,POST} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/admin/lotes/[id]/a1/route";
import {POST as CRON} from "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/cron/a1/route";
const root=process.env.QA_A1_E2E_OUTPUT_DIR!;
assert.ok(root && root.startsWith("/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-e2e-"));
const fixture=JSON.parse(readFileSync(process.env.QA_A1_E2E_FIXTURE!,"utf8"));
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function main(){
 assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.MAIL_PROVIDER,"dev");assert.equal(new URL(process.env.DATABASE_URL!).port,"54377");assert.equal(process.env.APPROVER_EMAIL,"");assert.equal(process.env.RECIPIENTS,"");
 await _openForTests("t_a1_real_transport_e2e");
 try{
  await query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-e2e@example.test','QA E2E','total','NOT-A-PASSWORD')");
  const session=await abrirSessao(1,"127.0.0.1");await query("UPDATE admin_sessions SET stepup_ate=now()+interval '9 minutes' WHERE user_id=1");
  await query("INSERT INTO settings(key,value)VALUES('batch_a1_policy_v1',$1)",[JSON.stringify(fixture.policy)]);
  const request=(id:number,method:string,body?:unknown)=>new NextRequest(`http://localhost/api/admin/lotes/${id}/a1`,{method,headers:{host:"localhost",origin:"http://localhost",cookie:"adm="+session.token,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const cron=(secret=process.env.CRON_SECRET!)=>CRON(new NextRequest("http://localhost/api/cron/a1",{method:"POST",headers:{authorization:"Bearer "+secret}}));
  async function batch(number:number){
   await query("INSERT INTO signatures(name,email,email_hash,category,city,uf,text_version,consent_at,status,confirmed_at)VALUES($1,$2,$3,'apoiador','Porto Velho','RO','QA',now(),'confirmed',now())",['Pessoa Ficticia E2E '+number,`qa-e2e-${number}@example.test`,'QA-E2E-'+number]);
   const created=await createBatch('partial');assert.ok(created);return (await query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[created.id])).rows[0];
  }
  const first=await batch(1);const original=Buffer.from(first.pdf!);const input={requestId:randomUUID(),expectedDocumentVersion:documentVersion(first),expectedPolicyRevision:1};const params={params:{id:String(first.id)}};
  const ready=await GET(request(first.id,'GET'),params);assert.equal(ready.status,200);assert.equal((await ready.json()).available,true);
  const admitted=await POST(request(first.id,'POST',input),params);assert.equal(admitted.status,202);const job=await admitted.json();assert.equal(job.job.profileVersion,fixture.policy.profileVersion);
  const replayBefore=await POST(request(first.id,'POST',input),params);assert.equal(replayBefore.status,200);assert.equal((await replayBefore.json()).job.jobId,job.job.jobId);
  assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE variant='signed'")).rowCount,0);
  assert.equal((await cron('invalid')).status,401);
  const signed=await cron();assert.equal(signed.status,200);const signedResult=await signed.json();assert.equal(signedResult.state,'succeeded');
  const after=(await query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[first.id])).rows[0];assert.deepEqual(after.pdf,original);assert.ok(after.signed_pdf);assert.equal(sha(after.signed_pdf),after.signed_pdf_sha256);assert.equal(after.approved_at,null);assert.equal(after.sent_at,null);
  const observed=await GET(request(first.id,'GET'),params);const latest=(await observed.json()).latestJob;assert.equal(latest.state,'succeeded');assert.equal(latest.requestId,input.requestId);assert.equal(latest.outputSha256,sha(after.signed_pdf));assert.ok(latest.outputVersionId);
  const replayAfter=await POST(request(first.id,'POST',input),params);assert.equal(replayAfter.status,200);assert.equal((await replayAfter.json()).job.jobId,job.job.jobId);assert.equal((await (await cron()).json()).state,'empty');
  assert.equal((await query('SELECT 1 FROM batch_a1_jobs')).rowCount,1);assert.equal((await query('SELECT 1 FROM batch_a1_validations')).rowCount,1);assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE variant='signed'")).rowCount,1);
  await fetch(fixture.validatorControl,{method:'POST',headers:{authorization:'Bearer '+fixture.validatorToken,'content-type':'application/json'},body:JSON.stringify({mode:'wrong-policy'})}).then(r=>assert.equal(r.status,200));
  const second=await batch(2),secondInput={requestId:randomUUID(),expectedDocumentVersion:documentVersion(second),expectedPolicyRevision:1};assert.equal((await POST(request(second.id,'POST',secondInput),{params:{id:String(second.id)}})).status,202);
  const rejected=await cron();assert.equal((await rejected.json()).state,'validation_failed');const rejectedBatch=(await query('SELECT signed_pdf,approved_at,sent_at FROM batches WHERE id=$1',[second.id])).rows[0];assert.deepEqual(rejectedBatch,{signed_pdf:null,approved_at:null,sent_at:null});
  assert.equal((await query('SELECT state FROM batch_a1_jobs WHERE batch_id=$1',[second.id])).rows[0].state,'failed');assert.equal((await (await cron()).json()).state,'empty');
  assert.equal((await query('SELECT 1 FROM batch_a1_validations')).rowCount,1);assert.equal((await query('SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends')).rowCount,0);
  const audit=await import('/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/db');assert.ok((await audit.verifyAuditChain()).ok);
  const safe=JSON.stringify(latest);for(const forbidden of ['synthetic-password','leaseToken','pdfBase64','/certificates/'])assert.ok(!safe.includes(forbidden));
  const result={ok:true,syntheticOnly:true,notIcpHomologation:true,mailProvider:'dev',realUnixBroker:true,realWorker:true,realSyntheticCryptography:true,validatorTrust:'synthetic-contract-simulation-only',profile:fixture.policy.profileVersion,successJobId:job.job.jobId,outputSha256:sha(after.signed_pdf),wrongPolicyBlocked:true,replaySignedVersions:1,approvals:0,mailMessages:0};
  writeFileSync(join(root,'scenario-result.json'),JSON.stringify(result,null,2),{mode:0o600,flag:"wx"});console.log(JSON.stringify(result));
 }finally{await _closeDbForTests();}
}main();
