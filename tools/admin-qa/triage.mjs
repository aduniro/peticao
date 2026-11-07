// Actual built HTTP handlers and worker, only on the isolated fictitious local preview.
import assert from "node:assert/strict";
import { mkdir,writeFile } from "node:fs/promises";
const base=new URL(process.env.QA_BASE_URL??"http://127.0.0.1:3032"),database=new URL(process.env.DATABASE_URL??"http://missing");
assert.equal(base.hostname,"127.0.0.1");assert.equal(base.port,"3032");assert.equal(database.hostname,"127.0.0.1");assert.equal(database.port,"54345");assert.equal(database.pathname,"/peticao");
assert.equal(process.env.PREVIEW_MODE,"1");assert.equal(process.env.ADMIN_NO_PASSWORD,"0");assert.equal(process.env.MAIL_PROVIDER,"dev");assert.ok(process.env.QA_CRON_SECRET);
const bootstrap=await fetch(new URL("/admin",base));assert.equal(bootstrap.status,200);assert.ok((await bootstrap.text()).includes("/dev/outbox"));
const dm=await import("../../site/src/lib/db.ts"),um=await import("../../site/src/lib/admin-users.ts"),db=dm.default??dm,U=um.default??um;
const output=process.env.QA_OUTPUT_DIR;assert.ok(output);await mkdir(output,{recursive:true});
let token;
try{
 const unknown=(await db.query("SELECT count(*)::int n FROM contact_messages WHERE lower(name) NOT LIKE 'qa %' OR email NOT LIKE '%@example.test'")).rows[0].n;assert.equal(unknown,0,"Refuse to process non-QA contacts");
 const count=async table=>Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);
 assert.equal(await count("mail_outbox"),0);assert.equal(await count("contact_replies"),0);
 const signatures=async()=>(await db.query("SELECT id,name,cpf_hash,email_hash,status,seq,created_at,confirmed_at FROM signatures ORDER BY id")).rows;
 const before=await signatures();
 const email="qa-triage-runtime@example.test",message="QA-TRIAGE-RUNTIME: Não recebi o e-mail de confirmação.",name="QA Triagem Runtime";
 let contact=(await db.query("SELECT id,name,message FROM contact_messages WHERE email=$1",[email])).rows[0];
 if(contact){assert.equal(contact.name,name);assert.equal(contact.message,message);}else contact=(await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES($1,$2,'duvida',$3) RETURNING id",[name,email,message])).rows[0];
 const actor="qa-triage-editor@example.test";let user=(await db.query("SELECT id,nivel FROM admin_users WHERE email=$1",[actor])).rows[0];
 if(user)assert.equal(user.nivel,"edicao");else{const created=await U.criarUsuario({email:actor,nome:"QA Triagem Editor",nivel:"edicao",senha:"QA-Local-Triagem-2026-Ficticia"});assert.ok(created.ok);user=created.usuario;}
 token=(await U.abrirSessao(user.id,"127.0.0.1")).token;
 const request=async(path,body,authenticated=true)=>fetch(new URL(path,base),{method:body?"POST":"GET",headers:{origin:base.origin,cookie:authenticated?`adm=${token}`:"","content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const path=`/api/admin/contato/triagem?contato=${contact.id}`;
 assert.equal((await request(path,undefined,false)).status,401);
 const asked=await request(path,{contato:contact.id,por:"forged@example.test"});assert.equal(asked.status,200);const reservation=await asked.json();assert.ok(reservation.ok);
 const history=async()=>{const response=await request(path);assert.equal(response.status,200);return(await response.json()).history;};
 assert.equal((await history())[0].status,"queued");
 const tick=secret=>fetch(new URL("/api/cron/fila",base),{method:"POST",headers:{authorization:`Bearer ${secret}`}});
 assert.equal((await tick("wrong-fixture")).status,401);assert.equal((await history())[0].status,"queued");
 const result=await tick(process.env.QA_CRON_SECRET);assert.equal(result.status,200);const stats=await result.json();assert.ok(!stats.contactTriage.error);
 const done=(await history())[0];assert.equal(done.status,"complete");assert.equal(done.requested_by,actor);assert.equal(done.analysis.category,"nao_recebeu");assert.equal(done.evidence.contact.message,undefined);
 const repeated=await tick(process.env.QA_CRON_SECRET);assert.equal(repeated.status,200);assert.deepEqual((await history())[0],done);
 const again=await request(path,{contato:contact.id});assert.equal(again.status,200);assert.equal((await again.json()).revision,done.revision+1);
 assert.equal((await tick(process.env.QA_CRON_SECRET)).status,200);const versions=await history();assert.equal(versions[0].status,"complete");assert.deepEqual(versions[1],done);
 assert.deepEqual(await signatures(),before);assert.equal(await count("mail_outbox"),0);assert.equal(await count("contact_replies"),0);
 const report={ok:true,httpAuth:true,cronAuth:true,workerComplete:true,reprocessingVersioned:true,previousVersionPreserved:true,noSignerWrites:true,noParticipantMail:true};
 await writeFile(`${output}/triage.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(token)await U.encerrarSessao(token);await db._closeDbForTests();}
