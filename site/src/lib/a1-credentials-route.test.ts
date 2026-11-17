import test from "node:test";
import assert from "node:assert/strict";
import {createServer}from"node:net";
import {mkdtemp,rm}from"node:fs/promises";
import {tmpdir}from"node:os";
import {join}from"node:path";
import {randomUUID}from"node:crypto";
import {NextRequest}from"next/server";
import {_openForTests,_closeDbForTests,query}from"./db";
import {abrirSessao}from"./admin-users";
import {GET,POST}from"../app/api/admin/presidente/a1/credencial/route";

test("real auth, PostgreSQL policy and Unix credential boundary: read-only recovery after lost response",async()=>{
 assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.MAIL_PROVIDER,"dev");const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"54383");
 const dir=await mkdtemp(join(tmpdir(),"credential-route-")),path=join(dir,"c.sock"),old=process.env.A1_CREDENTIAL_SOCKET;process.env.A1_CREDENTIAL_SOCKET=path;
 let count=0,drop=false;let current:any=null;const receipts=new Map<string,any>();
 const server=createServer(socket=>{let incoming=Buffer.alloc(0);socket.on("data",chunk=>{incoming=Buffer.concat([incoming,chunk]);if(incoming.length<4||incoming.length<4+incoming.readUInt32BE(0))return;count++;const request=JSON.parse(incoming.subarray(4).toString());if(request.operation==="put"){current={credentialVersionId:request.requestId,certificateFingerprintSha256:"a".repeat(64),cnpj:"15883671000115",notBefore:"2026-01-01T00:00:00Z",notAfter:"2027-01-01T00:00:00Z",activatedAt:new Date().toISOString(),profileVersion:"pades-ad-rb-declared-unhomologated-v1",trustStoreVersion:"b".repeat(64)};receipts.set(request.requestId,current);if(drop){drop=false;socket.destroy();return}}
 const metadata=request.requestId?receipts.get(request.requestId)??null:current;
 const raw=Buffer.from(JSON.stringify({ok:true,credential:metadata,currentCredentialVersionId:current?.credentialVersionId??null,intent:request.requestId?{requestId:request.requestId,state:metadata?"completed":"not_found"}:null})),header=Buffer.alloc(4);header.writeUInt32BE(raw.length);socket.end(Buffer.concat([header,raw]));});});
 await new Promise<void>(r=>server.listen(path,r));
 try{
  await _openForTests("t_a1_credential_route");await query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-credential@example.test','QA Credential','total','QA-NO-LOGIN')");const session=await abrirSessao(1,"127.0.0.1");await query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '10 minutes' WHERE user_id=1");
  const req=(body:unknown,cookie=true,origin=true)=>new NextRequest("https://admin.fixture.invalid/api/admin/presidente/a1/credencial",{method:"POST",headers:{host:"admin.fixture.invalid","content-type":"application/json",...(cookie?{cookie:`adm=${session.token}`} :{}),...(origin?{origin:"https://admin.fixture.invalid"}:{})},body:JSON.stringify(body)});
  const id=randomUUID(),input={requestId:id,pfxBase64:Buffer.from("FICTIONAL ONLY").toString("base64"),password:"QA-NOT-REAL"};
  assert.equal((await POST(req(input,false))).status,401);assert.equal((await POST(req(input,true,false))).status,403);assert.equal(count,0);
  let r=await POST(req(input));assert.equal(r.status,200);assert.equal((await r.json()).activated,true);assert.equal(count,1);
  const policy=()=>query<{value:string}>("SELECT value FROM settings WHERE key='batch_a1_policy_v1'");const original=(await policy()).rows[0].value;
  let read=await GET(new NextRequest(`https://admin.fixture.invalid/api/admin/presidente/a1/credencial?requestId=${id}`,{headers:{host:"admin.fixture.invalid",cookie:`adm=${session.token}`}}));assert.equal((await read.json()).intent.activated,true);assert.equal((await policy()).rows[0].value,original);
  r=await POST(req({requestId:id}));assert.equal((await r.json()).replayed,true);assert.equal((await query("SELECT 1 FROM audit_log WHERE event='a1_credential_activated'")).rowCount,1);
  const id2=randomUUID();drop=true;r=await POST(req({...input,requestId:id2}));assert.equal(r.status,503);assert.equal((await policy()).rows[0].value,original);
  read=await GET(new NextRequest(`https://admin.fixture.invalid/api/admin/presidente/a1/credencial?requestId=${id2}`,{headers:{host:"admin.fixture.invalid",cookie:`adm=${session.token}`}}));const recovered=await read.json();assert.equal(recovered.intent.state,"completed");assert.equal(recovered.intent.activated,false);assert.equal((await policy()).rows[0].value,original);
  r=await POST(req({requestId:id2}));assert.equal(r.status,200);assert.equal(JSON.parse((await policy()).rows[0].value).revision,2);assert.equal((await query("SELECT 1 FROM audit_log WHERE event='a1_credential_activated'")).rowCount,2);
  assert.equal((await query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount,0);
  await query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()-interval '1 second'");const beforeCount=count;r=await POST(req({...input,requestId:randomUUID()}));assert.equal(r.status,403);assert.equal(count,beforeCount);
 }finally{await _closeDbForTests();if(old===undefined)delete process.env.A1_CREDENTIAL_SOCKET;else process.env.A1_CREDENTIAL_SOCKET=old;await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true})}
});
