// Built handlers, fictitious contacts/admin and dev mailbox only; no provider API is used.
import assert from "node:assert/strict";
import {mkdir,writeFile,readdir,readFile} from "node:fs/promises";
const base=new URL(process.env.QA_BASE_URL??"http://127.0.0.1:3032"),database=new URL(process.env.DATABASE_URL??"http://missing");
assert.equal(base.hostname,"127.0.0.1");assert.equal(base.port,"3032");assert.equal(database.hostname,"127.0.0.1");assert.equal(database.port,"54345");assert.equal(database.pathname,"/peticao");
assert.equal(process.env.PREVIEW_MODE,"1");assert.equal(process.env.ADMIN_NO_PASSWORD,"0");assert.equal(process.env.MAIL_PROVIDER,"dev");
const output=process.env.QA_OUTPUT_DIR,mailbox=process.env.QA_MAILBOX;assert.ok(output&&mailbox);await mkdir(output,{recursive:true});assert.equal((await readdir(mailbox)).length,0);
const boot=await fetch(new URL("/admin",base));assert.equal(boot.status,200);assert.ok((await boot.text()).includes("/dev/outbox"));
const dm=await import("../../site/src/lib/db.ts"),um=await import("../../site/src/lib/admin-users.ts"),db=dm.default??dm,U=um.default??um;
let token;
try{
 const signatures=async()=>(await db.query("SELECT id,name,cpf_hash,email_hash,status,seq,created_at,confirmed_at FROM signatures ORDER BY id")).rows,before=await signatures();
 const addresses=["qa-mail-runtime@example.test","qa-mail-inbox@example.test","qa-mail-owner@example.test"];
 const marker="QA-MAIL-TRANSPORT: mensagem fictícia para validar correlação.";
 const messagesBefore=Number((await db.query("SELECT count(*) n FROM mail_messages")).rows[0].n);
 const contact=await fetch(new URL("/api/contato",base),{method:"POST",headers:{"content-type":"application/json",origin:base.origin},body:JSON.stringify({name:"QA Transporte Fictício",email:addresses[0],kind:"duvida",message:marker,website:""})});assert.equal(contact.status,200);assert.deepEqual(await contact.json(),{ok:true});
 const row=(await db.query("SELECT id FROM contact_messages WHERE email=$1 AND message=$2 ORDER BY id DESC LIMIT 1",[addresses[0],marker])).rows[0];assert.ok(row);
 const email="qa-mail-admin@example.test";let user=(await db.query("SELECT id,nivel FROM admin_users WHERE email=$1",[email])).rows[0];
 if(user)assert.equal(user.nivel,"total");else{const created=await U.criarUsuario({email,nome:"QA Mail Admin",nivel:"total",senha:"QA-Local-Mail-2026-Ficticia"});assert.ok(created.ok);user=created.usuario;}
 token=(await U.abrirSessao(user.id,"127.0.0.1")).token;await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1",[user.id]);
 const send=body=>fetch(new URL("/api/admin/contato/responder",base),{method:"POST",headers:{"content-type":"application/json",origin:base.origin,cookie:`adm=${token}`},body:JSON.stringify(body)});
 const input={contactId:row.id,assunto:"QA resposta local",corpo:"Resposta fictícia de QA. Nenhuma pessoa real recebe esta mensagem."};
 const preview=await send({...input,modo:"previa"});assert.equal(preview.status,200);const data=await preview.json();assert.equal(data.previa.para,addresses[0]);assert.equal(data.previa.card,null);
 const result=await send({...input,modo:"enviar",selo:data.previa.selo});assert.equal(result.status,200);assert.ok((await result.json()).ok);
 const duplicate=await send({...input,modo:"enviar",selo:data.previa.selo});assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).erro,"ja_respondida");
 const reply=(await db.query("SELECT estado,por FROM contact_replies WHERE contact_id=$1",[row.id])).rows;assert.equal(reply.length,1);assert.deepEqual(reply[0],{estado:"accepted",por:email});
 const after=(await db.query("SELECT id,kind,to_addr,status,content_state FROM mail_messages WHERE to_addr=ANY($1::text[]) ORDER BY created_at",[addresses])).rows;
 const newest=after.slice(-2);assert.equal(newest.length,2);assert.deepEqual(newest.map(m=>m.kind),["contato","resposta-contato"]);assert.ok(newest.every(m=>m.status==="accepted"&&m.content_state==="unavailable"));
 for(const message of newest){assert.equal((await db.query("SELECT 1 FROM mail_message_attempts WHERE message_id=$1 AND state='accepted'",[message.id])).rowCount,1);assert.equal((await db.query("SELECT 1 FROM mail_log WHERE message_id=$1 AND status='sent'",[message.id])).rowCount,1);}
 assert.equal(Number((await db.query("SELECT count(*) n FROM mail_messages")).rows[0].n),messagesBefore+2);assert.deepEqual(await signatures(),before);
 const files=await readdir(mailbox);assert.equal(files.length,2);const mails=await Promise.all(files.map(async name=>JSON.parse(await readFile(`${mailbox}/${name}`,"utf8"))));assert.ok(mails.every(mail=>addresses.includes(mail.to)&&(mail.bcc??[]).every(address=>addresses.includes(address))));
 const report={ok:true,builtPublicContact:true,builtAdminReply:true,duplicateBlocked:true,correlatedMessages:2,oneAttemptPerMessage:true,noSignerChanges:true,onlyFictitiousDevMail:true};await writeFile(`${output}/mail-transport.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(token)await U.encerrarSessao(token);await db._closeDbForTests();}
