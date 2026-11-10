import { freezePreparation } from "./batch-preparation";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { _openForTests, _closeDbForTests, query, tx, audit } from "./db";
import { abrirSessao } from "./admin-users";
import { appendDocumentVersion } from "./batch-document-history";
import { documentVersion, type ApprovalRow } from "./batches";
import { POST as CRON } from "../app/api/cron/a1/route";
import { GET, POST } from "../app/api/admin/lotes/[id]/a1/route";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
test("A1 API: autenticação/origem/limites, admissão idempotente e GET sem assinatura", async () => {
  await _openForTests("t_a1_api");
  try {
    await query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-api@example.invalid','QA API','total','QA-NO-LOGIN'),(2,'qa-read@example.invalid','QA Read','leitura','QA-NO-LOGIN')");
    const total = await abrirSessao(1,"127.0.0.1"), read = await abrirSessao(2,"127.0.0.1");
    const req = (method: string, body?: string, token = total.token, origin = "http://qa.local") => new NextRequest("http://qa.local/api/admin/lotes/1/a1", { method, headers: { host: "qa.local", origin, cookie: "adm=" + token, "content-type": "application/json" }, ...(body === undefined ? {} : { body }) });
    const params = { params: { id: "1" } };
    assert.equal((await GET(req("GET",undefined,""),params)).status,401);
    assert.equal((await GET(req("GET",undefined,read.token),params)).status,403);
    assert.equal((await GET(req("GET"),params)).status,403);
    await query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes' WHERE user_id=1");
    assert.equal((await GET(req("GET"),{params:{id:"01"}})).status,400);
    assert.equal((await POST(req("POST","{}",total.token,"https://outside.invalid"),params)).status,403);
    assert.equal((await POST(req("POST","x".repeat(2049)),params)).status,413);
    assert.equal((await POST(req("POST",JSON.stringify({requestId:randomUUID(),expectedDocumentVersion:'a'.repeat(64),expectedPolicyRevision:1,pfxPath:'/not-allowed'})),params)).status,400);
    const disabled = await GET(req("GET"),params);
    assert.equal(disabled.status,200);assert.equal((await disabled.json()).available,false);
    const input={requestId:randomUUID(),expectedDocumentVersion:'a'.repeat(64),expectedPolicyRevision:1};
    assert.equal((await POST(req("POST",JSON.stringify(input)),params)).status,409);
    assert.equal((await query("SELECT 1 FROM batch_a1_jobs")).rowCount,0);

    const doc=await PDFDocument.create();doc.addPage([200,200]);const pdf=Buffer.from(await doc.save());
    const rows=[{name:"QA Pessoa",category:"apoiador",role:null,institution:null,city:"QA",uf:"RO"}];
    const listHash=sha(Buffer.from(JSON.stringify(rows)));
    const row=(await query<ApprovalRow>("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind)VALUES(1,'final','prepared',0,1,$1,$2,$3,'none')RETURNING *",[listHash,pdf,sha(pdf)])).rows[0];
    const frozen=freezePreparation(rows,{seq:1,kind:'final',generatedAt:'2026-11-09T12:00:00.000Z',listHash,nServidor:0,nApoiador:1,signedNote:'',signaturePreparation:'a1'},{kind:'scheduler'});
    await query("INSERT INTO batch_preparations(batch_id,snapshot,snapshot_sha256)VALUES($1,$2,$3)",[row.id,frozen.snapshot,frozen.sha256]);
    await audit('batch_created',null,{batchId:row.id,snapshotSha256:frozen.sha256,source:'scheduler'});
    await tx(c=>appendDocumentVersion(c,{batchId:row.id,variant:'original',bytes:pdf,sha256:sha(pdf),listHash:row.list_hash,signatureKind:'none',note:null,source:'prepared',authorId:1,recordedBy:1}));
    const policy={version:1,revision:1,enabled:true,credentialActive:true,credentialVersionId:randomUUID(),profileVersion:'pades-basic-unhomologated-v1',trustStoreVersion:'b'.repeat(64),expectedCnpj:'15883671000115',certificateFingerprintSha256:'c'.repeat(64)};
    await query("INSERT INTO settings(key,value)VALUES('batch_a1_policy_v1',$1)",[JSON.stringify(policy)]);
    process.env.BATCH_A1_ENABLED='1';process.env.A1_VALIDATION_ENABLED='1';
    // Fictitious explicit policy only; this route never calls this URL or the signing worker.
    process.env.ICP_VALIDATOR_URL='http://127.0.0.1:9/not-contacted';
    process.env.A1_VALIDATION_ACCEPTED_POLICIES=JSON.stringify([{profile:'qa-approved-profile',policyOid:'1.2.3.4.5'}]);
    const ready=await GET(req('GET'),params);assert.equal((await ready.json()).available,true);
    input.expectedDocumentVersion=documentVersion(row);
    const first=await POST(req('POST',JSON.stringify(input)),params);assert.equal(first.status,202);const admitted=await first.json();
    const repeat=await POST(req('POST',JSON.stringify(input)),params);assert.equal(repeat.status,200);assert.equal((await repeat.json()).job.jobId,admitted.job.jobId);
    const observed=await GET(req('GET'),params);const state=await observed.json();assert.equal(state.latestJob.requestId,input.requestId);assert.equal(state.available,false);
    assert.equal(JSON.stringify(state).includes('leaseToken'),false);assert.equal(JSON.stringify(state).includes('pdfBase64'),false);
    assert.equal((await query("SELECT 1 FROM batch_a1_jobs")).rowCount,1);
    assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE variant='signed'")).rowCount,0);
    assert.equal((await query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount,0);
    await query("UPDATE admin_users SET ativo=false WHERE id=1");assert.equal((await GET(req('GET'),params)).status,401);
  } finally {
    for(const key of ['BATCH_A1_ENABLED','A1_VALIDATION_ENABLED','ICP_VALIDATOR_URL','A1_VALIDATION_ACCEPTED_POLICIES'])delete process.env[key];
    await _closeDbForTests();
  }
});

// The dedicated scheduler is inert without prior activation; it never accepts caller-selected jobs.
test("A1 cron: segredo obrigatório, corpo vazio e gate fechado sem efeitos", async () => {
 const previous=process.env.CRON_SECRET;process.env.CRON_SECRET="QA-A1-CRON-NOT-REAL";delete process.env.BATCH_A1_ENABLED;
 try {
  const req=(token:string,body?:string,suffix="")=>new NextRequest("http://qa.local/api/cron/a1"+suffix,{method:"POST",headers:{authorization:"Bearer "+token},...(body===undefined?{}:{body})});
  assert.equal((await CRON(req("wrong"))).status,401);
  assert.equal((await CRON(req(process.env.CRON_SECRET,"{}"))).status,413);
  assert.equal((await CRON(req(process.env.CRON_SECRET,undefined,"?job=not-allowed"))).status,400);
  const response=await CRON(req(process.env.CRON_SECRET));assert.equal(response.status,200);assert.deepEqual(await response.json(),{ran:false,state:"disabled"});
 }finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});
