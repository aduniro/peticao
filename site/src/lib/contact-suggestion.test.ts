import test from "node:test";
import assert from "node:assert/strict";
import { replyBody } from "./contact-triage/suggestion";
import type { Analysis, Category } from "./contact-triage/analyze";
(process.env as Record<string,string>).NODE_ENV="test";process.env.MAIL_PROVIDER="dev";
async function setup(){const db=await import("./db");await db._openForTests("t_contact_suggestion");return{db,J:await import("./contact-triage/jobs"),S:await import("./contact-triage/suggestion"),U:await import("./admin-users")};}
async function contact(c:Awaited<ReturnType<typeof setup>>,message="Não recebi o e-mail",email="qa-suggestion@example.test"){
 const id=(await c.db.query("INSERT INTO contact_messages(name,email,kind,message,created_at) VALUES('PRIVATE_NAME',$1,'duvida',$2,'2026-11-01T00:00:00Z') RETURNING id",[email,message])).rows[0].id;
 await c.J.requestTriage(id,"qa-editor@example.test");assert.equal((await c.J.processTriage()).status,"complete");return id as number;
}
const analysis=(category:Category,reasons:string[]=[]):Analysis=>({engine:"contact-triage-v1",category,state:"review",priority:"normal",reasons,suggestedActions:["human_review"],campus:null});
const snapshot=async(c:Awaited<ReturnType<typeof setup>>)=>(await c.db.query("SELECT row_to_json(c) data FROM contact_messages c UNION ALL SELECT row_to_json(j) FROM contact_triage_jobs j UNION ALL SELECT row_to_json(s) FROM signatures s UNION ALL SELECT row_to_json(a) FROM audit_log a UNION ALL SELECT row_to_json(m) FROM mail_messages m UNION ALL SELECT row_to_json(r) FROM contact_replies r UNION ALL SELECT row_to_json(q) FROM mail_outbox q")).rows;

test("propostas por regras cabem no editor, não prometem ações concluídas e não usam nome/CPF como prova de identidade",async()=>{
 const {validarEntrada}=await import("./contact-replies");
 for(const category of ["remover","cpf","campus","expirou","corrigir","email_recusado","nao_recebeu","erro","duvida"] as Category[]){const body=replyBody(analysis(category));assert.ok(validarEntrada({assunto:"Sobre seu contato com a petição",corpo:body}).ok);assert.ok(!/removemos|reenviamos|corrigimos|assinatura segue valendo|está contada|gmail\.com/i.test(body));}
 assert.ok(!replyBody(analysis("cpf",["name_match_not_identity_proof"])).includes("está confirmada"));
 const incomplete=replyBody(analysis("nao_recebeu",["incomplete_evidence"]));assert.ok(!incomplete.includes("Não localizamos"));
 assert.ok(replyBody({...analysis("nao_recebeu",["confirmed_after_report"]),state:"resolved"}).includes("consta como confirmado"));
});

test("sugestão é somente leitura, baseada na revisão atual, sem copiar relato, dados privados ou selecionar retenção",async()=>{
 const c=await setup();try{const id=await contact(c,"Meu CPF 123.456.789-09 não confere; NEVER_COPY_BODY"),before=await snapshot(c);const result=await c.S.suggestContactReply(id);assert.ok(result.ok);assert.equal(result.source,"rules");assert.equal(result.persisted,false);assert.equal(result.requiresHumanReview,true);assert.equal(result.context.contactId,id);assert.match(result.proof,/^[a-f0-9]{64}$/);
 assert.ok((await c.S.validateReplySuggestion(id,result.proof)).ok);assert.deepEqual(await snapshot(c),before);
 for(const secret of ["123.456.789-09","PRIVATE_NAME","NEVER_COPY_BODY","input_hash","evidence","payload"])assert.ok(!JSON.stringify(result).includes(secret));
 }finally{await c.db._closeDbForTests();}
});

test("mensagem ou destinatário alterados e reanálise nova invalidam o contexto anterior",async()=>{
 const c=await setup();try{const id=await contact(c),first=await c.S.suggestContactReply(id);assert.ok(first.ok);
 await c.db.query("UPDATE contact_messages SET email='qa-changed@example.test' WHERE id=$1",[id]);const stale=await c.S.suggestContactReply(id);assert.ok(!stale.ok);assert.equal(stale.error,"analysis_stale");
 await c.J.requestTriage(id,"qa-editor@example.test");await c.J.processTriage();const next=await c.S.suggestContactReply(id);assert.ok(next.ok);assert.notEqual(next.proof,first.proof);assert.equal((await c.S.validateReplySuggestion(id,first.proof)).ok,false);assert.equal((await c.J.triageHistory(id))!.length,2);
 }finally{await c.db._closeDbForTests();}
});

test("fatos novos, análise alterada e trabalho pendente não liberam proposta velha",async()=>{
 const c=await setup();try{const id=await contact(c),first=await c.S.suggestContactReply(id);assert.ok(first.ok);
 await c.db.query("INSERT INTO mail_events(ts,provider,type,email,reason) VALUES(now(),'brevo','blocked','qa-suggestion@example.test','QA')");assert.equal((await c.S.suggestContactReply(id)).ok,false);
 await c.J.requestTriage(id,"qa-editor@example.test");const queued=await c.S.suggestContactReply(id);assert.ok(!queued.ok);assert.equal(queued.error,"analysis_pending");await c.J.processTriage();assert.ok((await c.S.suggestContactReply(id)).ok);
 await c.db.query("UPDATE contact_triage_jobs SET analysis=jsonb_set(analysis,'{state}','\"resolved\"') WHERE contact_id=$1 AND revision=2",[id]);const mismatch=await c.S.suggestContactReply(id);assert.ok(!mismatch.ok);assert.equal(mismatch.error,"analysis_stale");
 }finally{await c.db._closeDbForTests();}
});

test("prova de outro contato não serve e motor desconhecido exige revisão própria",async()=>{
 const c=await setup();try{const a=await contact(c),b=await contact(c),first=await c.S.suggestContactReply(a);assert.ok(first.ok);assert.equal((await c.S.validateReplySuggestion(b,first.proof)).ok,false);
 await c.db.query("UPDATE contact_triage_jobs SET engine='future-engine' WHERE contact_id=$1",[a]);const unknown=await c.S.suggestContactReply(a);assert.ok(!unknown.ok);assert.equal(unknown.error,"engine_unsupported");
 }finally{await c.db._closeDbForTests();}
});

test("fonte incompleta não produz conclusão definitiva e confirmação futura é inconsistente",async()=>{
 const c=await setup();try{const id=await contact(c);await c.db.query("DROP TABLE mail_events");await c.J.requestTriage(id,"qa-editor@example.test");await c.J.processTriage();const incomplete=await c.S.suggestContactReply(id);assert.ok(incomplete.ok);assert.ok(incomplete.draft.corpo.includes("Ainda precisamos conferir"));
 await c.db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,confirmed_at) VALUES('QA','qa-suggestion@example.test','qa-eh','apoiador','QA','2026-11-01Z','confirmed','2099-01-01T00:00:00Z')");await c.J.requestTriage(id,"qa-editor@example.test");await c.J.processTriage();const future=await c.S.suggestContactReply(id);assert.ok(!future.ok);assert.equal(future.error,"evidence_inconsistent");
 }finally{await c.db._closeDbForTests();}
});

test("API exige Edição/origem e só valida contexto, sem aceitar enviar ou gravar conteúdo",async()=>{
 const c=await setup();try{process.env.ADMIN_NO_PASSWORD="0";const id=await contact(c),R=await import("../app/api/admin/contato/minuta/route"),{NextRequest}=await import("next/server");
 const user=await c.U.criarUsuario({email:"qa-suggestion-editor@example.test",nome:"QA",nivel:"edicao",senha:"QA-Suggestion-2026-Ficticia"});assert.ok(user.ok);const session=await c.U.abrirSessao(user.usuario.id,"127.0.0.1");
 const req=(method="GET",body:unknown={},token=session.token,origin="http://localhost")=>new NextRequest(`http://localhost/api/admin/contato/minuta?contato=${id}`,{method,headers:{host:"localhost",origin,cookie:token?`adm=${token}`:""},...(method==="POST"?{body:JSON.stringify(body)}:{})});
 assert.equal((await R.GET(req("GET",{},""))).status,401);const response=await R.GET(req());assert.equal(response.status,200);const result=await response.json();assert.equal((await R.POST(req("POST",{contato:id,proof:result.proof}))).status,200);
 assert.equal((await R.POST(req("POST",{contato:id,proof:result.proof,modo:"enviar"}))).status,400);const sender=await import("../app/api/admin/contato/responder/route");assert.equal((await sender.POST(req("POST",{contactId:id,modo:"enviar",assunto:"QA",corpo:"QA corpo fictício",selo:result.proof}))).status,403);assert.equal((await R.POST(req("POST",{padding:"é".repeat(1000)}))).status,413);assert.equal((await R.GET(req("GET",{},session.token,"https://foreign.example"))).status,403);
 await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1",[user.usuario.id]);assert.equal((await R.GET(req())).status,403);await c.U.encerrarSessao(session.token);
 assert.equal((await c.db.query("SELECT count(*)::int n FROM contact_replies")).rows[0].n,0);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n,0);
 }finally{await c.db._closeDbForTests();}
});
