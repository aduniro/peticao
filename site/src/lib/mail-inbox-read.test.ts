import test from "node:test";
import assert from "node:assert/strict";
import { createHmac,randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { acceptInboundMail } from "./mail/inbound-store";
import { listInboundThreads,listInboundThreadMessages,previewInboundMessage,downloadInboundAttachment } from "./mail/inbound-queries";

(process.env as Record<string,string>).NODE_ENV="test";process.env.MAIL_PROVIDER="dev";delete process.env.PREVIEW_MODE;
const key=Buffer.from("QA-INBOX-ONLY-FICTITIOUS-RELAY-KEY-0123456789");
async function fixture(schema:string) {
  const db=await import("./db");await db._openForTests(schema);const U=await import("./admin-users");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-inbox@example.test','QA Inbox','edicao','QA-NOT-A-LOGIN-HASH')");
  const token=(await U.abrirSessao(1,"127.0.0.1")).token;await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=1");const actor=(await U.sessaoPorToken(token))!;
  const send=async(options:Record<string,unknown>={})=>{
    const mail={account:"qa-inbox",externalId:randomUUID(),messageId:`<${randomUUID()}@example.test>`,inReplyTo:null,references:[],from:"qa-person@example.test",to:["qa-support@example.test"],subject:"QA subject",text:"QA body 123456",html:'<p>QA body<img src="https://tracker.example.test/pixel"><script>RAW_SCRIPT_MARKER</script><a href="https://tracker.example.test/secret">link</a></p>',attachments:[{name:'report.html',contentType:'text/html',base64:Buffer.from('<script>RAW_ATTACHMENT_MARKER</script>').toString('base64')}],receivedAt:"2026-11-09T01:00:00.000Z",...options};
    const raw=Buffer.from(JSON.stringify(mail)),stamp=String(Math.floor(Date.now()/1000)),signature="sha256="+createHmac("sha256",key).update(stamp+".").update(raw).digest("hex");
    const result=await acceptInboundMail(raw,stamp,signature,{enabled:true,account:mail.account,recipients:mail.to,key});assert.ok(result.ok);return{...result,mail};
  };
  const request=(path:string,cookie=`adm=${token}`)=>new NextRequest(`http://localhost${path}`,{headers:{host:"localhost",cookie}});
  const noEffects=async()=>{for(const table of ["signatures","mail_messages","mail_outbox","contact_replies"])assert.equal((await db.query(`SELECT 1 FROM ${table}`)).rowCount,0);};
  return{db,U,actor,token,send,request,noEffects};
}

test("lista de conversas é paginada por conta e microssegundos, sem selecionar/decriptar conteúdo",async()=>{
  const c=await fixture("t_inbox_thread_page");
  try{
    const a=await c.send(),b=await c.send(),other=await c.send({account:"qa-other"});
    await c.db.query("UPDATE mail_inbound_messages SET created_at='2026-11-09T01:00:00.123451Z',content_cipher='INVALID-DO-NOT-DECRYPT' WHERE id=$1",[a.id]);
    await c.db.query("UPDATE mail_inbound_messages SET created_at='2026-11-09T01:00:00.123452Z' WHERE id=$1",[b.id]);
    const first=await listInboundThreads({account:"qa-inbox",limit:1},c.actor);assert.ok(first.ok);assert.equal(first.threads[0].thread_root,b.id);assert.match(first.threads[0].last_at,/123452Z$/);assert.ok(first.nextCursor);
    const next=await listInboundThreads({account:"qa-inbox",limit:1,cursor:first.nextCursor},c.actor);assert.ok(next.ok);assert.equal(next.threads[0].thread_root,a.id);assert.equal(next.nextCursor,null);
    assert.equal((await listInboundThreads({account:"qa-other",cursor:first.nextCursor},c.actor)).ok,false);
    const raw=JSON.stringify(first);for(const field of ["content_cipher","from","subject","RAW_","qa-person"])assert.ok(!raw.includes(field));assert.ok(!raw.includes(other.id));
    const unavailable=await previewInboundMessage(a.id,c.actor);assert.ok(unavailable.ok&&unavailable.state==="unavailable");await c.noEffects();assert.ok((await c.db.verifyAuditChain()).ok);
  }finally{await c.db._closeDbForTests();}
});

test("mensagens de conversa usam thread/conta exatos e cursor limitado; referência não vira identidade",async()=>{
  const c=await fixture("t_inbox_messages");
  try{
    const a=await c.send(),b=await c.send({inReplyTo:a.mail.messageId}),other=await c.send({from:"qa-other-person@example.test",inReplyTo:a.mail.messageId});assert.equal(b.threadRoot,a.id);assert.equal(other.threadRoot,other.id);
    await c.db.query("UPDATE mail_inbound_messages SET created_at='2026-11-09T01:00:00.000001Z' WHERE id=$1",[a.id]);await c.db.query("UPDATE mail_inbound_messages SET created_at='2026-11-09T01:00:00.000002Z' WHERE id=$1",[b.id]);
    const first=await listInboundThreadMessages({account:"qa-inbox",threadRoot:a.id,limit:1},c.actor);assert.ok(first.ok);assert.equal(first.messages[0].id,b.id);assert.ok(first.nextCursor);
    const second=await listInboundThreadMessages({account:"qa-inbox",threadRoot:a.id,limit:1,cursor:first.nextCursor},c.actor);assert.ok(second.ok);assert.equal(second.messages[0].id,a.id);
    assert.equal((await listInboundThreadMessages({account:"qa-inbox",threadRoot:other.id,cursor:first.nextCursor},c.actor)).ok,false);
    for(const input of [{account:"bad/",limit:1},{account:"qa-inbox",limit:51},{account:"qa-inbox",cursor:"x".repeat(401)},{account:"qa-inbox",cursor:"bad%%%"}])assert.deepEqual(await listInboundThreads(input,c.actor),{ok:false,error:"input"});await c.noEffects();
  }finally{await c.db._closeDbForTests();}
});

test("prévia usa documento transformado existente sem rede/imagens/execução nem anexos brutos",async()=>{
  const c=await fixture("t_inbox_preview"),originalFetch=globalThis.fetch;
  try{
    const sent=await c.send();let fetches=0;globalThis.fetch=(async()=>{fetches++;throw new Error("QA NO NETWORK");}) as typeof fetch;
    const r=await previewInboundMessage(sent.id,c.actor);assert.ok(r.ok&&r.state==="preview"&&r.preview.state==="ready");assert.ok(r.preview.transformed);assert.match(r.preview.html,/<!doctype html>/);assert.ok(!r.preview.html.includes("RAW_SCRIPT_MARKER"));assert.ok(!r.preview.html.includes("tracker.example"));assert.ok(!JSON.stringify(r).includes("RAW_ATTACHMENT_MARKER"));assert.ok(!JSON.stringify(r).includes('123456'));assert.equal(fetches,0);
    const plain=await c.send({html:"",text:"QA plain"}),p=await previewInboundMessage(plain.id,c.actor);assert.ok(p.ok&&p.state==="preview"&&p.preview.state==="ready");assert.match(p.preview.html,/<pre>QA plain<\/pre>/);await c.noEffects();
  }finally{globalThis.fetch=originalFetch;await c.db._closeDbForTests();}
});

test("sessão, papel, identidade e stepup são revalidados transacionalmente em lista/prévia/anexo",async()=>{
  const c=await fixture("t_inbox_permissions");
  try{
    const sent=await c.send();
    for(const sql of ["UPDATE admin_users SET nivel='leitura' WHERE id=1","UPDATE admin_users SET ativo=false WHERE id=1","UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1","UPDATE admin_sessions SET expira_em=now()-interval '1 second' WHERE user_id=1"]){
      await c.db.query(sql);for(const r of [await listInboundThreads({account:"qa-inbox"},c.actor),await listInboundThreadMessages({account:"qa-inbox",threadRoot:sent.id},c.actor),await previewInboundMessage(sent.id,c.actor),await downloadInboundAttachment(sent.id,0,c.actor)])assert.deepEqual(r,{ok:false,error:"forbidden"});
      await c.db.query("UPDATE admin_users SET nivel='edicao',ativo=true WHERE id=1; UPDATE admin_sessions SET expira_em=now()+interval '1 hour',stepup_ate=now()+interval '15 minutes' WHERE user_id=1");
    }
    assert.deepEqual(await listInboundThreads({account:"qa-inbox"},{...c.actor,email:"forged@example.test"}),{ok:false,error:"forbidden"});await c.noEffects();
  }finally{await c.db._closeDbForTests();}
});

test("expiração antes do expurgo impede conteúdo/anexo; falha de auditoria falha fechada",async()=>{
  const c=await fixture("t_inbox_retention");
  try{
    const sent=await c.send();await c.db.query("UPDATE mail_inbound_messages SET expires_at=now()-interval '1 second' WHERE id=$1",[sent.id]);
    assert.deepEqual(await previewInboundMessage(sent.id,c.actor),{ok:true,state:"expired"});assert.deepEqual(await downloadInboundAttachment(sent.id,0,c.actor),{ok:true,state:"expired"});assert.ok((await c.db.query("SELECT content_cipher FROM mail_inbound_messages WHERE id=$1",[sent.id])).rows[0].content_cipher);
    const live=await c.send();await c.db.query("CREATE FUNCTION qa_inbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('mail_inbound_content_read','mail_inbound_threads_listed','mail_inbound_thread_listed') THEN RAISE EXCEPTION 'QA inbox audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_inbox_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_inbox_fault()");
    await assert.rejects(listInboundThreads({account:"qa-inbox"},c.actor),/QA inbox audit fault/);await assert.rejects(previewInboundMessage(live.id,c.actor),/QA inbox audit fault/);await assert.rejects(downloadInboundAttachment(live.id,0,c.actor),/QA inbox audit fault/);await c.noEffects();
  }finally{await c.db._closeDbForTests();}
});

test("rotas exigem Edição/stepup e anexo sai attachment/octet-stream/nosniff com índice limitado",async()=>{
  const c=await fixture("t_inbox_routes");
  try{
    const L=await import("../app/api/admin/inbox/conversas/route"),M=await import("../app/api/admin/inbox/conversas/[thread]/route"),P=await import("../app/api/admin/inbox/mensagens/[id]/previa/route"),A=await import("../app/api/admin/inbox/mensagens/[id]/anexos/[index]/route");const sent=await c.send(),path="/api/admin/inbox/conversas?account=qa-inbox",params={id:sent.id,index:"0"};
    assert.equal((await L.GET(c.request(path,""))).status,401);await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1");assert.equal((await L.GET(c.request(path))).status,403);await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=1");
    assert.equal((await L.GET(c.request(path))).status,200);assert.equal((await M.GET(c.request(path),{params:{thread:sent.threadRoot}})).status,200);assert.equal((await L.GET(c.request(path+"&limit=999"))).status,400);
    const preview=await P.GET(c.request("/api/admin/inbox/previa"),{params:{id:sent.id}});assert.equal(preview.status,200);assert.match(preview.headers.get("content-type")!,/application\/json/);assert.match(preview.headers.get("content-security-policy")!,/default-src 'none'/);assert.ok(!(await preview.text()).includes("RAW_SCRIPT_MARKER"));
    const file=await A.GET(c.request("/api/admin/inbox/anexo"),{params});assert.equal(file.status,200);assert.equal(file.headers.get("content-type"),"application/octet-stream");assert.equal(file.headers.get("content-disposition"),'attachment; filename="anexo-1.bin"');assert.equal(file.headers.get("x-content-type-options"),"nosniff");assert.equal(file.headers.get("cache-control"),"private, no-store");assert.equal(await file.text(),"<script>RAW_ATTACHMENT_MARKER</script>");
    for(const index of ["-1","4","00","1.0","../0"]){assert.equal((await A.GET(c.request(path),{params:{...params,index}})).status,400);}
    assert.equal((await A.GET(c.request(path),{params:{...params,index:"3"}})).status,404);assert.equal((await P.GET(c.request(path),{params:{id:"bad"}})).status,400);
    await c.db.query("UPDATE mail_inbound_messages SET expires_at=now()-interval '1 second' WHERE id=$1",[sent.id]);assert.equal((await A.GET(c.request(path),{params})).status,410);assert.equal((await P.GET(c.request(path),{params:{id:sent.id}})).status,410);await c.noEffects();
  }finally{await c.db._closeDbForTests();}
});
