import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream,writeFileSync } from "node:fs";
import { createHmac,createHash,randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const sites={
  "079ca7a":"/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-http-079ca7a-20261109/site",
  "8cdd97a":"/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-http-node20-8cdd97a-20261109/site",
};
const expectedCommit=process.env.QA_EXPECTED_COMMIT??"079ca7a",site=sites[expectedCommit];assert.ok(site);
assert.equal(process.cwd(),site);assert.equal(process.env.QA_BASE_URL,"http://127.0.0.1:3047");assert.equal(process.env.DEV_DB_PORT,"54362");assert.equal(process.env.MAIL_PROVIDER,"dev");
const db=await import(pathToFileURL(`${site}/src/lib/db.ts`).href),U=await import(pathToFileURL(`${site}/src/lib/admin-users.ts`).href),I=await import(pathToFileURL(`${site}/src/lib/mail/inbound-store.ts`).href);
await db._openForTests("qa_inbox_compiled");
const proofs=[];const log=createWriteStream(`${process.env.QA_OUTPUT_DIR}/server.log`);let server,stopped;
const bodyHash=async()=>createHash("sha256").update(JSON.stringify((await db.query("SELECT row_to_json(m)::text raw FROM mail_inbound_messages m ORDER BY id")).rows)).digest("hex");
const send=async(options={})=>{
  const mail={account:"qa-inbox",externalId:randomUUID(),messageId:`<${randomUUID()}@example.test>`,inReplyTo:null,references:[],from:"qa-person@example.test",to:["qa-support@example.test"],subject:"QA Subject",text:"QA text 123456",html:'<p>QA content<img src="https://never-fetch.example.test/pixel"><script>QA_SCRIPT_RAW</script></p>',attachments:[{name:"unsafe.html",contentType:"text/html",base64:Buffer.from('<script>QA_ATTACHMENT_RAW</script>').toString('base64')}],receivedAt:"2026-11-09T01:00:00.000Z",...options};
  const raw=Buffer.from(JSON.stringify(mail)),timestamp=String(Math.floor(Date.now()/1000)),key=Buffer.from("QA-INBOX-HTTP-ONLY-RELAY-KEY-0123456789"),signature="sha256="+createHmac("sha256",key).update(timestamp+".").update(raw).digest("hex");
  const r=await I.acceptInboundMail(raw,timestamp,signature,{enabled:true,account:mail.account,recipients:mail.to,key});assert.ok(r.ok);return{...r,mail};
};
try{
  const tokens={};let index=0;
  for(const level of ["leitura","edicao","exclusao","total"]){index++;await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES($1,$2,'QA HTTP User',$3,'QA-NOT-A-LOGIN-HASH')",[index,`qa-${level}@example.test`,level]);tokens[level]=(await U.abrirSessao(index,"127.0.0.1")).token;}
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes'");
  const first=await send(),reply=await send({inReplyTo:first.mail.messageId}),second=await send(),other=await send({account:"qa-other"});
  await db.query("UPDATE mail_inbound_messages SET created_at='2026-11-09T01:00:00.123451Z' WHERE thread_root=$1",[first.id]);await db.query("UPDATE mail_inbound_messages SET created_at='2026-11-09T01:00:00.123452Z' WHERE id=$1",[second.id]);
  const snapshot=await bodyHash();
  server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3047"],{env:process.env});server.stdout.pipe(log);server.stderr.pipe(log);stopped=once(server,"exit");
  const get=async(path,token=tokens.edicao,extra={})=>{assert.ok(path.startsWith("/api/admin/inbox/"));return fetch(`${process.env.QA_BASE_URL}${path}`,{redirect:"manual",headers:{...(token?{cookie:`adm=${token}`} : {}),...extra},signal:AbortSignal.timeout(10000)});};
  let ready=false;for(let n=0;n<120;n++){if(server.exitCode!==null)throw new Error("QA server ended before readiness");try{ready=(await get("/api/admin/inbox/conversas?account=qa-inbox",null)).status===401;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
  const list="/api/admin/inbox/conversas?account=qa-inbox",preview=`/api/admin/inbox/mensagens/${first.id}/previa`,attachment=`/api/admin/inbox/mensagens/${first.id}/anexos/0`;
  for(const path of [list,preview,attachment,`/api/admin/inbox/conversas/${first.id}?account=qa-inbox`]){assert.equal((await get(path,null)).status,401);assert.equal((await get(path,tokens.leitura)).status,403);}
  await db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=2");assert.equal((await get(list)).status,403);assert.equal((await get(attachment)).status,403);await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=2");
  for(const level of ["edicao","exclusao","total"])assert.equal((await get(list,tokens[level])).status,200);proofs.push("401/403, current role and stepup across four compiled GETs");
  const page=await get(`${list}&limit=1`);assert.equal(page.status,200);assert.match(page.headers.get("cache-control"),/no-store/);assert.equal(page.headers.get("x-content-type-options"),"nosniff");const p=await page.json();assert.equal(p.threads[0].thread_root,second.id);assert.match(p.threads[0].last_at,/123452Z$/);assert.ok(p.nextCursor);assert.ok(!JSON.stringify(p).includes(other.id));
  const after=await(await get(`${list}&limit=1&cursor=${p.nextCursor}`)).json();assert.equal(after.threads[0].thread_root,first.id);assert.equal(after.threads[0].messages,2);assert.equal(after.nextCursor,null);
  assert.equal((await get(`/api/admin/inbox/conversas?account=qa-other&cursor=${p.nextCursor}`)).status,400);assert.equal((await get(`${list}&limit=51`)).status,400);assert.equal((await get(`${list}&account=qa-other`)).status,400);
  const messages=await(await get(`/api/admin/inbox/conversas/${first.id}?account=qa-inbox&limit=1`)).json();assert.ok(messages.ok);assert.ok(messages.nextCursor);const nextMessages=await(await get(`/api/admin/inbox/conversas/${first.id}?account=qa-inbox&limit=1&cursor=${messages.nextCursor}`)).json();assert.equal(new Set([messages.messages[0].id,nextMessages.messages[0].id]).size,2);
  assert.equal((await get(`/api/admin/inbox/conversas/${second.id}?account=qa-inbox&cursor=${messages.nextCursor}`)).status,400);proofs.push("account/thread separation, scoped cursors and preserved timestamp microseconds");
  const rendered=await get(preview);assert.equal(rendered.status,200);assert.match(rendered.headers.get("content-type"),/application\/json/);assert.match(rendered.headers.get("content-security-policy"),/default-src 'none'/);assert.equal(rendered.headers.get("referrer-policy").split(",").map(value=>value.trim().toLowerCase()).at(-1),"no-referrer");const content=await rendered.json();assert.equal(content.state,"preview");assert.equal(content.preview.transformed,true);const sanitized=JSON.stringify(content);for(const raw of ["QA_SCRIPT_RAW","QA_ATTACHMENT_RAW","never-fetch.example.test","123456"])assert.ok(!sanitized.includes(raw));
  const binary=await get(attachment);assert.equal(binary.status,200);assert.equal(binary.headers.get("content-type"),"application/octet-stream");assert.equal(binary.headers.get("content-disposition"),'attachment; filename="anexo-1.bin"');assert.equal(binary.headers.get("x-content-type-options"),"nosniff");assert.match(binary.headers.get("cache-control"),/no-store/);assert.equal(await binary.text(),"<script>QA_ATTACHMENT_RAW</script>");
  for(const suffix of ["-1","4","00","bad"])assert.equal((await get(`/api/admin/inbox/mensagens/${first.id}/anexos/${suffix}`)).status,400);assert.equal((await get(`/api/admin/inbox/mensagens/${first.id}/anexos/3`)).status,404);assert.equal((await get("/api/admin/inbox/mensagens/not-a-uuid/previa")).status,400);proofs.push("transformed JSON preview, explicit binary attachment, fixed filename and protective headers");
  await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=2");assert.equal((await get(attachment)).status,403);await db.query("UPDATE admin_users SET nivel='edicao' WHERE id=2");await db.query("UPDATE admin_sessions SET expira_em=now()-interval '1 second' WHERE user_id=2");assert.equal((await get(preview)).status,401);await db.query("UPDATE admin_sessions SET expira_em=now()+interval '1 hour' WHERE user_id=2");assert.equal(await bodyHash(),snapshot);
  await db.query("UPDATE mail_inbound_messages SET expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);assert.ok((await db.query("SELECT content_cipher FROM mail_inbound_messages WHERE id=$1",[first.id])).rows[0].content_cipher);const expiredSnapshot=await bodyHash();
  for(const path of [preview,attachment]){const r=await get(path);assert.equal(r.status,410);assert.deepEqual(await r.json(),{ok:true,state:"expired"});}assert.equal(await bodyHash(),expiredSnapshot);proofs.push("revocation takes effect; expired ciphertext retained for cleanup but never returned");
  for(const table of ["signatures","mail_messages","mail_outbox","contact_replies"])assert.equal((await db.query(`SELECT 1 FROM ${table}`)).rowCount,0);assert.ok((await db.verifyAuditChain()).ok);proofs.push("inbound content unchanged by reads, no signer/outbox/reply writes and valid audit chain");
  writeFileSync(`${process.env.QA_OUTPUT_DIR}/http-proof.json`,JSON.stringify({baseCommit:expectedCommit,nodeVersion:process.version,referrerPolicy:rendered.headers.get("referrer-policy"),fictitiousOnly:true,proofs,passed:true},null,2));console.log(JSON.stringify({passed:true,proofs:proofs.length}));
}finally{
  if(server){server.kill("SIGTERM");const timer=setTimeout(()=>server.kill("SIGKILL"),10000);await stopped;clearTimeout(timer);}log.end();await db._closeDbForTests();
}
