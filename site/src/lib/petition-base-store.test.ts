import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {PETITION_BASE_SCHEMA_SQL} from "./petition-base-schema";
import {stagePetitionBase,readStagedPetitionBase} from "./petition-base-store";
const bytes=Buffer.from('%PDF-1.7 QA NEVER_COPY_BODY synthetic fixture');
async function fixture(name:string){
 const db=await import('./db');await db._openForTests(name);await db.query(PETITION_BASE_SCHEMA_SQL);
 const U=await import('./admin-users');
 await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-base@example.test','QA Base','total','NOT-A-PASSWORD'),(2,'qa-reader@example.test','QA Reader','leitura','NOT-A-PASSWORD')");
 const token=(await U.abrirSessao(1,'127.0.0.1')).token,readerToken=(await U.abrirSessao(2,'127.0.0.1')).token;await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes'");const actor=(await U.sessaoPorToken(token))!,reader=(await U.sessaoPorToken(readerToken))!;
 process.env.GOVBR_BASE_ENABLED='1';
 const input=()=>({requestId:randomUUID(),bytes:Buffer.from(bytes)});
 const close=async()=>{delete process.env.GOVBR_BASE_ENABLED;await db._closeDbForTests();};
 const noSend=async()=>assert.equal((await db.query('SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends')).rowCount,0);
 return{db,actor,reader,token,readerToken,input,close,noSend};
}
test('base upload disabled by default without database or file access',async()=>{
 delete process.env.GOVBR_BASE_ENABLED;assert.deepEqual(await stagePetitionBase({requestId:randomUUID(),bytes},null),{ok:false,error:'disabled'});assert.deepEqual(await readStagedPetitionBase(randomUUID(),null),{ok:false,error:'disabled'});
});
test('base upload requires current Total, session and extra confirmation; payload cannot set validation',async()=>{
 const c=await fixture('t_base_auth');try{
 for(const actor of [null,c.reader,{...c.actor,sessaoId:null}])assert.equal((await stagePetitionBase(c.input(),actor) as any).error,'forbidden');
 await c.db.query('UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1');assert.equal((await stagePetitionBase(c.input(),c.actor) as any).error,'forbidden');await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
 for(const input of [{...c.input(),validationState:'valid'},{...c.input(),filename:'../../private.pdf'},{...c.input(),bytes:Buffer.from('not a PDF at all')},{...c.input(),bytes:Buffer.alloc(26*1024*1024)},{...c.input(),requestId:'bad'}])assert.equal((await stagePetitionBase(input as any,c.actor) as any).error,'parameters');
 assert.equal((await c.db.query('SELECT 1 FROM petition_base_artifacts')).rowCount,0);await c.noSend();
 }finally{await c.close();}
});
test('concurrent intent persists one pending artifact and one audit; retry never silently replaces bytes',async()=>{
 const c=await fixture('t_base_idempotent');try{
 const input=c.input(),results=await Promise.all([stagePetitionBase(input,c.actor),stagePetitionBase(input,c.actor),stagePetitionBase(input,c.actor)]);assert.ok(results.every(r=>r.ok));const first=results[0];assert.ok(first.ok);assert.ok(results.every(r=>r.ok&&r.artifactId===first.artifactId));assert.equal(first.validationState,'pending');assert.equal(first.usableInPackage,false);assert.equal(results.filter(r=>r.ok&&!r.replayed).length,1);
 assert.equal((await c.db.query('SELECT 1 FROM petition_base_artifacts')).rowCount,1);assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='petition_base_uploaded'")).rowCount,1);
 assert.equal((await stagePetitionBase({...input,bytes:Buffer.from('%PDF-1.7 QA different synthetic content')},c.actor) as any).error,'request_conflict');
 const second=await stagePetitionBase(c.input(),c.actor);assert.ok(second.ok);assert.notEqual(second.artifactId,first.artifactId);assert.ok((await c.db.verifyAuditChain()).ok);await c.noSend();
 }finally{await c.close();}
});
test('authenticated exact-byte read stays pending and cannot satisfy the package contract',async()=>{
 const c=await fixture('t_base_read');try{
 const stored=await stagePetitionBase(c.input(),c.actor);assert.ok(stored.ok);const read=await readStagedPetitionBase(stored.artifactId,c.actor);assert.ok(read.ok);assert.deepEqual(read.bytes,bytes);assert.equal(read.sha256,stored.sha256);assert.equal(read.validationState,'pending');assert.equal((await readStagedPetitionBase(stored.artifactId,c.reader) as any).error,'forbidden');
 const {freezeBatchPackage}=await import('./batch-package-contract');
 assert.equal(freezeBatchPackage({batchId:1,documentVersion:'a'.repeat(64),batch:{versionId:randomUUID(),sha256:'b'.repeat(64),byteLength:100},basePetition:{...stored,versionId:stored.artifactId,method:'gov-br-advanced'}} as any).ok,false);
 const audits=JSON.stringify((await c.db.query("SELECT data FROM audit_log WHERE event LIKE 'petition_base_%'")).rows);assert.ok(!audits.includes('NEVER_COPY_BODY'));await c.noSend();
 }finally{await c.close();}
});
test('audit fault rolls back upload and intent together',async()=>{
 const c=await fixture('t_base_rollback');try{await c.db.query("CREATE FUNCTION qa_base_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='petition_base_uploaded' THEN RAISE EXCEPTION 'QA base audit'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_base_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_base_fault()");await assert.rejects(stagePetitionBase(c.input(),c.actor),/QA base audit/);assert.equal((await c.db.query('SELECT 1 FROM petition_base_artifacts UNION ALL SELECT 1 FROM petition_base_upload_requests')).rowCount,0);await c.noSend();}finally{await c.close();}
});
test('staging is immutable and DDL replay preserves bytes, authors and timestamps',async()=>{
 const c=await fixture('t_base_immutable');try{assert.ok((await stagePetitionBase(c.input(),c.actor)).ok);const snapshot=async()=>(await c.db.query("SELECT 'artifact' kind,row_to_json(a)::text value FROM petition_base_artifacts a UNION ALL SELECT 'intent',row_to_json(r)::text FROM petition_base_upload_requests r ORDER BY kind,value")).rows;const before=await snapshot();await c.db.query(PETITION_BASE_SCHEMA_SQL);await c.db.query(PETITION_BASE_SCHEMA_SQL);assert.deepEqual(await snapshot(),before);
 for(const table of ['petition_base_artifacts','petition_base_upload_requests'])for(const action of [`UPDATE ${table} SET ${table==='petition_base_artifacts'?'sha256=sha256':'input_sha256=input_sha256'}`,`DELETE FROM ${table}`,`TRUNCATE ${table} CASCADE`])await assert.rejects(c.db.query(action),/immutable/);assert.deepEqual(await snapshot(),before);
 }finally{await c.close();}
});

test('base HTTP requires auth before reading upload; bounded strict multipart, replay and private exact-byte download',async()=>{
 const c=await fixture('t_base_http');try{
 const {NextRequest}=await import('next/server'),{POST}=await import('../app/api/admin/documentos/base/route'),{GET}=await import('../app/api/admin/documentos/base/[id]/route');
 const requestId=randomUUID();
 const form=(extra=false)=>{const f=new FormData();f.set('requestId',requestId);f.set('file',new Blob([bytes],{type:'application/pdf'}),'NEVER_STORED_NAME.pdf');if(extra)f.append('requestId',randomUUID());return f;};
 const req=(body:BodyInit=form(),token=c.token,origin='http://qa.local',headers:Record<string,string>={},suffix='')=>new NextRequest('http://qa.local/api/admin/documentos/base'+suffix,{method:'POST',headers:{host:'qa.local',origin,cookie:token?'adm='+token:'',...headers},body});
 const unauth=req(form(),'');assert.equal((await POST(unauth)).status,401);assert.equal(unauth.bodyUsed,false);
 const reader=req(form(),c.readerToken);assert.equal((await POST(reader)).status,403);assert.equal(reader.bodyUsed,false);
 assert.equal((await POST(req(form(),c.token,'https://outside.example.test'))).status,403);
 await c.db.query('UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1');assert.equal((await POST(req())).status,403);await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
 process.env.GOVBR_BASE_ENABLED='0';const disabled=req();assert.equal((await POST(disabled)).status,409);assert.equal(disabled.bodyUsed,false);process.env.GOVBR_BASE_ENABLED='1';
 assert.equal((await POST(req('not multipart',c.token,'http://qa.local',{'content-type':'application/json'}))).status,400);
 assert.equal((await POST(req(form(),c.token,'http://qa.local',{'content-length':'999999999'}))).status,413);
 assert.equal((await POST(req(form(true)))).status,400);
 const first=await POST(req());assert.equal(first.status,202);const pending=await first.json();assert.equal(pending.validationState,'pending');assert.equal(pending.usableInPackage,false);assert.equal(pending.replayed,false);
 const replay=await POST(req());assert.equal(replay.status,200);assert.equal((await replay.json()).artifactId,pending.artifactId);
 const get=(token=c.token,suffix='')=>new NextRequest('http://qa.local/api/admin/documentos/base/'+pending.artifactId+suffix,{headers:{host:'qa.local',cookie:token?'adm='+token:''}}),params={params:{id:pending.artifactId}};
 assert.equal((await GET(get(''),params)).status,401);assert.equal((await GET(get(c.readerToken),params)).status,403);
 const download=await GET(get(),params);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/pdf');assert.match(download.headers.get('content-disposition')!,/^attachment;/);assert.ok(!download.headers.get('content-disposition')!.includes('NEVER_STORED_NAME'));assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 assert.equal((await GET(get(c.token,'?filename=evil'),params)).status,400);
 process.env.GOVBR_BASE_ENABLED='0';assert.equal((await GET(get(),params)).status,409);await c.noSend();
 }finally{await c.close();}
});
