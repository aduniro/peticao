import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import type { ApprovalRow } from "./batches";

(process.env as Record<string,string>).NODE_ENV="test";process.env.MAIL_PROVIDER="dev";
delete process.env.PREVIEW_MODE;
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function fixture(schema:string) {
  const db=await import("./db");await db._openForTests(schema);
  const V=await import("./document-verification"),H=await import("./batch-document-history"),B=await import("./batches"),U=await import("./admin-users");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-public-owner@example.test','QA PUBLIC OWNER PII','total','QA-NOT-A-LOGIN-HASH')");
  const token=(await U.abrirSessao(1,"127.0.0.1")).token;await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");const actor=(await U.sessaoPorToken(token))!;
  const original=Buffer.from("%PDF-QA ORIGINAL PII-NAME"),signed=Buffer.from("%PDF-QA SIGNED PII-NAME"),listHash="a".repeat(64);
  const batchId=(await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signed_pdf,signed_pdf_sha256,signature_kind,signed_note) VALUES(1,'final','prepared',0,1,$1,$2,$3,$4,$5,'icp-brasil','QA PII NOTE') RETURNING id",[listHash,original,hash(original),signed,hash(signed)])).rows[0].id as number;
  const append=(bytes:Buffer,variant:"original"|"signed")=>db.tx(client=>H.appendDocumentVersion(client,{batchId,variant,bytes,sha256:hash(bytes),listHash,signatureKind:variant==="signed"?"icp-brasil":"none",note:"QA PII NOTE",source:variant==="signed"?"upload":"prepared",authorId:1,recordedBy:1}));
  const old=await append(original,"original"),version=await append(signed,"signed");
  const approve=async()=>{const row=(await db.query<ApprovalRow>("SELECT * FROM batches WHERE id=$1",[batchId])).rows[0];await db.tx(async client=>{await client.query("UPDATE batches SET approved_by='QA APPROVER PII',approved_at=$1 WHERE id=$2",[new Date().toISOString(),batchId]);await db.audit("batch_approved",null,{batchId,approvedBy:"QA APPROVER PII",documentVersion:B.documentVersion(row),sentSha256:hash(row.signed_pdf ?? row.pdf!),recipients:["qa-authority@example.test"]},client);});};
  const publish=(expectedRevision=0,enabled=true)=>V.setDocumentPublication({versionId:version.id,sha256:hash(signed),enabled,expectedRevision},actor);
  const check=()=>V.publicDocumentVerification(version.id,hash(signed));
  const noEffects=async()=>assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends UNION ALL SELECT 1 FROM signatures")).rowCount,0);
  delete process.env.DOCUMENT_VERIFICATION_PUBLIC;
  const close=async()=>{delete process.env.DOCUMENT_VERIFICATION_PUBLIC;await db._closeDbForTests();};
  return{db,V,B,U,actor,token,batchId,original,signed,old,version,append,approve,publish,check,noEffects,close};
}

test("verificação exige dois gates e versão aprovada exata; resposta whitelist não expõe PII/binário",async()=>{
  const c=await fixture("t_document_public_gates");
  try{
    assert.deepEqual(await c.check(),{ok:false});assert.deepEqual(await c.publish(),{ok:false,error:"ineligible"});await c.approve();assert.deepEqual(await c.check(),{ok:false});assert.deepEqual(await c.publish(),{ok:true,revision:1});assert.deepEqual(await c.check(),{ok:false});
    process.env.DOCUMENT_VERIFICATION_PUBLIC="true";assert.deepEqual(await c.check(),{ok:false});process.env.DOCUMENT_VERIFICATION_PUBLIC="1";
    const r=await c.check();assert.ok(r.ok);assert.deepEqual(r.metadata,{versionId:c.version.id,sha256:hash(c.signed),byteLength:c.signed.length,variant:"signed",approvalRecorded:true,signature:{recordedKind:"icp-brasil",onlineValidationPerformed:false}});
    const text=JSON.stringify(r);for(const forbidden of ["PII","cpf","@","recipients","approvedBy","captured_at","list_hash","note","bytes"])assert.ok(!text.includes(forbidden),forbidden);
    assert.deepEqual(await c.V.setDocumentPublication({versionId:c.old.id,sha256:hash(c.original),enabled:true,expectedRevision:0},c.actor),{ok:false,error:"ineligible"});
    assert.deepEqual(await c.V.publicDocumentVerification(c.version.id,"0".repeat(64)),{ok:false});await c.noEffects();
  }finally{await c.close();}
});

test("publicação tem CAS, revalida sessão/Total e revoga imediatamente; auditoria falha sem liberação",async()=>{
  const c=await fixture("t_document_public_admin");
  try{
    await c.approve();await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1");assert.deepEqual(await c.publish(),{ok:false,error:"forbidden"});await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=1");assert.deepEqual(await c.publish(),{ok:false,error:"forbidden"});await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=1");
    await c.db.query("CREATE FUNCTION qa_public_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='document_publication_changed' THEN RAISE EXCEPTION 'QA publication audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_public_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_public_fault()");
    await assert.rejects(c.publish(),/QA publication audit fault/);assert.equal((await c.db.query("SELECT 1 FROM settings WHERE key LIKE 'document_publication:%'")).rowCount,0);await c.db.query("DROP TRIGGER qa_public_fault ON audit_log");
    assert.deepEqual(await c.publish(),{ok:true,revision:1});assert.deepEqual(await c.publish(),{ok:false,error:"conflict"});process.env.DOCUMENT_VERIFICATION_PUBLIC="1";assert.ok((await c.check()).ok);
    assert.deepEqual(await c.publish(1,false),{ok:true,revision:2});assert.deepEqual(await c.check(),{ok:false});
    await c.db.query("UPDATE settings SET value=jsonb_set(jsonb_set(value::jsonb,'{enabled}','true'),'{revision}','1')::text WHERE key LIKE 'document_publication:%'");assert.deepEqual(await c.check(),{ok:false});await c.noEffects();
  }finally{await c.close();}
});

test("primeira liberação concorrente tem um único vencedor e uma única auditoria",async()=>{
  const c=await fixture("t_document_public_concurrent");
  try{
    await c.approve();
    // The inherited authorization lock must protect creation even before a row exists.
    // Delay only this fictitious insertion to exercise overlapping administrative calls.
    await c.db.query("CREATE FUNCTION qa_public_insert_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key LIKE 'document_publication:%' THEN PERFORM pg_sleep(0.15); END IF; RETURN NEW; END $$; CREATE TRIGGER qa_public_insert_delay BEFORE INSERT ON settings FOR EACH ROW EXECUTE FUNCTION qa_public_insert_delay()");
    const results=await Promise.all([c.publish(),c.publish(),c.publish()]);
    assert.equal(results.filter(r=>r.ok).length,1);
    assert.equal(results.filter(r=>!r.ok&&r.error==="conflict").length,2);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='document_publication_changed'")).rowCount,1);
    process.env.DOCUMENT_VERIFICATION_PUBLIC="1";
    assert.ok((await c.check()).ok);
    await c.noEffects();
  }finally{await c.close();}
});

test("mudança de bytes/lista, aprovação ausente/ambígua e revisão mais nova fecham a consulta",async()=>{
  const c=await fixture("t_document_public_binding");
  try{
    await c.approve();assert.ok((await c.publish()).ok);process.env.DOCUMENT_VERIFICATION_PUBLIC="1";
    await c.db.query("UPDATE batches SET list_hash='QA-CHANGED' WHERE id=$1",[c.batchId]);assert.deepEqual(await c.check(),{ok:false});await c.db.query("UPDATE batches SET list_hash=$1 WHERE id=$2",["a".repeat(64),c.batchId]);
    await c.db.query("UPDATE batches SET signed_pdf=$1 WHERE id=$2",[Buffer.from("QA CHANGED BYTES"),c.batchId]);assert.deepEqual(await c.check(),{ok:false});await c.db.query("UPDATE batches SET signed_pdf=$1 WHERE id=$2",[c.signed,c.batchId]);
    await c.db.query("UPDATE batches SET status='cancelled' WHERE id=$1",[c.batchId]);assert.deepEqual(await c.check(),{ok:false});await c.db.query("UPDATE batches SET status='prepared' WHERE id=$1",[c.batchId]);
    const oldApproval=(await c.db.query("SELECT approved_at FROM batches WHERE id=$1",[c.batchId])).rows[0].approved_at;await c.db.query("UPDATE batches SET approved_at=NULL WHERE id=$1",[c.batchId]);assert.deepEqual(await c.check(),{ok:false});await c.db.query("UPDATE batches SET approved_at=$1 WHERE id=$2",[oldApproval,c.batchId]);assert.ok((await c.check()).ok);
    await c.append(c.signed,"signed");assert.deepEqual(await c.check(),{ok:false});
    await c.noEffects();
  }finally{await c.close();}
  const ambiguous=await fixture("t_document_public_ambiguous");
  try{
    await ambiguous.approve();assert.ok((await ambiguous.publish()).ok);process.env.DOCUMENT_VERIFICATION_PUBLIC="1";assert.ok((await ambiguous.check()).ok);await ambiguous.approve();assert.deepEqual(await ambiguous.check(),{ok:false});
  }finally{await ambiguous.close();}
});

test("configuração forjada ou aprovação sem hash/revisão canônica nunca publica",async()=>{
  const c=await fixture("t_document_public_forged");
  try{
    await c.approve();await c.db.query("INSERT INTO settings(key,value) VALUES($1,$2)",[`document_publication:v1:${c.version.id}`,JSON.stringify({version:1,revision:1,enabled:true,sha256:hash(c.signed)})]);process.env.DOCUMENT_VERIFICATION_PUBLIC="1";assert.deepEqual(await c.check(),{ok:false});
    await c.db.query("DELETE FROM settings WHERE key LIKE 'document_publication:%'");await c.db.query("DELETE FROM audit_log WHERE event='batch_approved'");
    await c.db.audit("batch_approved",null,{batchId:c.batchId,documentVersion:"QA-FORGED",sentSha256:hash(c.signed)});assert.deepEqual(await c.publish(),{ok:false,error:"ineligible"});await c.noEffects();
  }finally{await c.close();}
});

test("URL usa somente origem HTTPS configurada e rota retorna 404 uniforme sem gate/liberação",async()=>{
  const c=await fixture("t_document_public_http");
  try{
    const id=c.version.id,sha=hash(c.signed);
    assert.equal(c.V.documentVerificationUrl("https://petition.example.test/",id,sha),`https://petition.example.test/api/documentos/verificar/${id}?sha256=${sha}`);
    for(const base of ["http://petition.example.test/","https://user:pass@petition.example.test/","https://petition.example.test/unsafe","https://petition.example.test/?x=1","https://petition.example.test/#x","https://127.0.0.1/","https://localhost/","https://petition.internal/","https://petition.example.test:8443/"])assert.equal(c.V.documentVerificationUrl(base,id,sha),null,base);
    const route=await import("../app/api/documentos/verificar/[versao]/route"),request=(query:string)=>new NextRequest(`https://untrusted-host.example.test/api/documentos/verificar/${id}${query}`,{headers:{host:"forged-host.example.test"}});
    const get=(query=`?sha256=${sha}`,versao:string=id)=>route.GET(request(query),{params:{versao}});
    const off=await get();assert.equal(off.status,404);assert.deepEqual(await off.json(),{ok:false});
    process.env.DOCUMENT_VERIFICATION_PUBLIC="1";const absent=await get();assert.equal(absent.status,404);assert.deepEqual(await absent.json(),{ok:false});await c.approve();assert.ok((await c.publish()).ok);
    const ok=await get();assert.equal(ok.status,200);assert.equal(ok.headers.get("cache-control"),"private, no-store");assert.match(ok.headers.get("content-type")!,/application\/json/);assert.equal(ok.headers.get("x-robots-tag"),"noindex, nofollow");assert.ok(!(await ok.text()).includes("forged-host"));
    for(const args of [[`?sha256=${sha}&sha256=${sha}`,id],[`?sha256=${"0".repeat(64)}`,id],[`?sha256=${sha}`,"not-a-uuid"]]){const r=await get(args[0],args[1]);assert.equal(r.status,404);assert.deepEqual(await r.json(),{ok:false});}await c.noEffects();
  }finally{await c.close();}
});
