import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
delete process.env.PREVIEW_MODE;
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
async function fixture(schema:string) {
  const db=await import("./db");await db._openForTests(schema);
  const H=await import("./batch-document-history"),B=await import("./batches");
  const actor={userId:1,email:"qa-version-owner@example.test"};
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Version Owner','total','QA-NOT-A-LOGIN-HASH')",[actor.email]);
  const pdf=Buffer.from("%PDF-1.7 QA ORIGINAL\n"+"% QA padding\n".repeat(30)+"%%EOF\n");
  const batchId=(await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES(1,'final','prepared',0,1,'QA-LIST',$1,$2,'none') RETURNING id",[pdf,digest(pdf)])).rows[0].id as number;
  const input={batchId,variant:"original" as const,bytes:pdf,sha256:digest(pdf),listHash:"QA-LIST",signatureKind:"none",note:null,source:"prepared" as const,authorId:1,recordedBy:1};
  const snapshot=async()=>(await db.query("SELECT row_to_json(v)::text raw FROM batch_document_versions v ORDER BY ordinal")).rows;
  const noMail=async()=>assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount,0);
  return{db,H,B,actor,pdf,batchId,input,snapshot,noMail};
}
function signed(original:Buffer,label:string) {
  const body=(n:number)=>`\n9999 0 obj\n<</Type/Sig/SubFilter/adbe.pkcs7.detached/ByteRange[0 100 200 ${String(n-200).padStart(10,"0")}]/Contents<00>>>\nendobj\n%%EOF\n`;
  const padding=Buffer.from(`\n%QA ${label} ${"QA".repeat(128)}\n`),size=original.length+padding.length+Buffer.byteLength(body(500));
  return Buffer.concat([original,padding,Buffer.from(body(size))]);
}

test("histórico é append-only e download preserva bytes/hash com auditoria e acesso Total",async()=>{
  const c=await fixture("t_document_history_immutable");
  try{
    const first=await c.db.tx(client=>c.H.appendDocumentVersion(client,c.input)),before=await c.snapshot();
    for(const sql of ["UPDATE batch_document_versions SET note='changed'","DELETE FROM batch_document_versions","TRUNCATE batch_document_versions CASCADE"]){await assert.rejects(c.db.query(sql),/immutable/);assert.deepEqual(await c.snapshot(),before);}
    const listed=await c.H.listDocumentVersions(c.batchId,c.actor);assert.ok(listed.ok);assert.equal(listed.versions.length,1);assert.ok(!("bytes" in listed.versions[0]));
    const read=await c.H.readDocumentVersion(c.batchId,first.id,c.actor);assert.ok(read.ok);assert.deepEqual(read.bytes,c.pdf);assert.equal(read.metadata.sha256,digest(c.pdf));
    await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=1");assert.deepEqual(await c.H.readDocumentVersion(c.batchId,first.id,c.actor),{ok:false,error:"forbidden"});assert.deepEqual(await c.H.listDocumentVersions(c.batchId,c.actor),{ok:false,error:"forbidden"});
    assert.deepEqual(await c.snapshot(),before);await c.noMail();assert.ok((await c.db.verifyAuditChain()).ok);
  }finally{await c.db._closeDbForTests();}
});

test("upload preserva original e variantes legadas sem fabricar autoria; versões novas não apagam anteriores",async()=>{
  const c=await fixture("t_document_history_upload");
  try{
    const old=signed(c.pdf,"OLD"),next=signed(c.pdf,"NEW");
    await c.db.query("UPDATE batches SET signed_pdf=$1,signed_pdf_sha256=$2,signature_kind='externa-nao-validada',signed_note='QA OLD' WHERE id=$3",[old,digest(old),c.batchId]);
    assert.ok((await c.B.attachSignedPdf(c.batchId,next,c.actor.email,c.actor)).ok);
    const rows=(await c.db.query("SELECT * FROM batch_document_versions ORDER BY ordinal")).rows;assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.variant),["original","signed","signed"]);
    assert.deepEqual(rows.map(r=>r.source),["legacy-observed","legacy-observed","upload"]);assert.deepEqual(rows.map(r=>r.author_id),[null,null,1]);assert.equal(rows[0].signature_kind,null);
    assert.deepEqual(rows.map(r=>r.bytes),[c.pdf,old,next]);const before=await c.snapshot();
    const third=signed(c.pdf,"THIRD");assert.ok((await c.B.attachSignedPdf(c.batchId,third,c.actor.email,c.actor)).ok);assert.deepEqual((await c.snapshot()).slice(0,3),before);
    assert.deepEqual((await c.db.query("SELECT pdf,signed_pdf FROM batches WHERE id=$1",[c.batchId])).rows[0],{pdf:c.pdf,signed_pdf:third});
    await c.db.query("UPDATE batches SET approved_at='QA-FROZEN' WHERE id=$1",[c.batchId]);const frozen=await c.snapshot();assert.equal((await c.B.attachSignedPdf(c.batchId,next,c.actor.email,c.actor)).ok,false);assert.deepEqual(await c.snapshot(),frozen);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("captura concorrente tem ordinais únicos; observação repetida não fabrica versões",async()=>{
  const c=await fixture("t_document_history_concurrent");
  try{
    await Promise.all(Array.from({length:4},()=>c.db.tx(client=>c.H.preserveObservedDocument(client,{...c.input,signatureKind:null}))));
    assert.equal((await c.snapshot()).length,1);
    await Promise.all(Array.from({length:4},(_,n)=>{const bytes=Buffer.concat([c.pdf,Buffer.from(`\n%QA ${n}`)]);return c.db.tx(client=>c.H.appendDocumentVersion(client,{...c.input,variant:"signed",source:"upload",bytes,sha256:digest(bytes)}));}));
    assert.deepEqual((await c.db.query("SELECT ordinal FROM batch_document_versions ORDER BY ordinal")).rows.map(r=>r.ordinal),[1,2,3,4,5]);
    await assert.rejects(c.db.tx(client=>c.H.appendDocumentVersion(client,{...c.input,sha256:"0".repeat(64)})),/invalid_document_version/);assert.equal((await c.snapshot()).length,5);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("auditoria falhando reverte versões e troca de bytes; download também falha fechado",async()=>{
  const c=await fixture("t_document_history_atomic");
  try{
    const fault=async(event:string)=>c.db.query(`CREATE FUNCTION qa_history_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'QA history audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_history_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_history_fault()`);
    const unfault=async()=>c.db.query("DROP TRIGGER qa_history_fault ON audit_log; DROP FUNCTION qa_history_fault()");
    await fault("signed_pdf_attached");await assert.rejects(c.B.attachSignedPdf(c.batchId,signed(c.pdf,"FAIL"),c.actor.email,c.actor),/QA history audit fault/);await unfault();
    assert.equal((await c.snapshot()).length,0);assert.equal((await c.db.query("SELECT signed_pdf FROM batches WHERE id=$1",[c.batchId])).rows[0].signed_pdf,null);
    await fault("batch_document_version_recorded");await assert.rejects(c.B.attachSignedPdf(c.batchId,signed(c.pdf,"FAIL2"),c.actor.email,c.actor),/QA history audit fault/);await unfault();assert.equal((await c.snapshot()).length,0);
    const version=await c.db.tx(client=>c.H.appendDocumentVersion(client,c.input));await fault("batch_document_version_downloaded");await assert.rejects(c.H.readDocumentVersion(c.batchId,version.id,c.actor),/QA history audit fault/);await unfault();assert.equal((await c.snapshot()).length,1);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});

test("preparo grava os bytes publicados e autoria conhecida na mesma transação",async()=>{
  const c=await fixture("t_document_history_preparation");
  const previous=process.env.BATCH_SIZE;process.env.BATCH_SIZE="1";
  try{
    await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,city,uf,text_version,consent_at,status,confirmed_at) VALUES('Pessoa Ficticia QA','qa-history-signer@example.test','QA-HISTORY-EMAIL','QA-HISTORY-CPF','apoiador','Porto Velho','RO','QA',now(),'confirmed',now())");
    const prepared=await c.B.createBatchForAdmin("partial",c.actor);assert.ok(prepared);
    const current=(await c.db.query("SELECT pdf,pdf_sha256 FROM batches WHERE id=$1",[prepared.id])).rows[0],version=(await c.db.query("SELECT * FROM batch_document_versions WHERE batch_id=$1",[prepared.id])).rows[0];
    assert.deepEqual(version.bytes,current.pdf);assert.equal(version.sha256,current.pdf_sha256);assert.equal(version.source,"prepared");assert.equal(version.author_id,1);assert.equal(version.recorded_by,1);
    const before=await c.snapshot();assert.equal((await c.B.recoverBatchPreparation(prepared.id,c.actor)).ok,false);assert.deepEqual(await c.snapshot(),before);
  }finally{if(previous===undefined)delete process.env.BATCH_SIZE;else process.env.BATCH_SIZE=previous;await c.db._closeDbForTests();}
});

test("rotas históricas exigem sessão/stepup e retornam somente variante selecionada",async()=>{
  const c=await fixture("t_document_history_http");
  try{
    const {NextRequest}=await import("next/server"),U=await import("./admin-users");
    const list=await import("../app/api/admin/lotes/[id]/versoes/route"),file=await import("../app/api/admin/lotes/[id]/versoes/[versao]/route");
    const version=await c.db.tx(client=>c.H.appendDocumentVersion(client,c.input)),token=(await U.abrirSessao(1,"127.0.0.1")).token;
    const request=(path:string,cookie=`adm=${token}`)=>new NextRequest(`http://localhost${path}`,{headers:{host:"localhost",cookie}});
    const path=`/api/admin/lotes/${c.batchId}/versoes`,params={id:String(c.batchId)},fileParams={...params,versao:version.id};
    assert.equal((await list.GET(request(path,""),{params})).status,401);assert.equal((await list.GET(request(path),{params})).status,403);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
    assert.equal((await list.GET(request(`${path}?antes=bad`),{params})).status,400);
    const listing=await list.GET(request(path),{params});assert.equal(listing.status,200);assert.equal(listing.headers.get("cache-control"),"private, no-store");assert.equal((await listing.json()).versions[0].id,version.id);
    const response=await file.GET(request(`${path}/${version.id}`),{params:fileParams});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),c.pdf);assert.equal(response.headers.get("x-document-sha256"),digest(c.pdf));assert.match(response.headers.get("content-disposition")!,/attachment/);
    assert.equal((await file.GET(request(path),{params:{...fileParams,id:String(c.batchId+1)}})).status,404);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=1");assert.equal((await file.GET(request(path),{params:fileParams})).status,401);await c.noMail();
  }finally{await c.db._closeDbForTests();}
});
