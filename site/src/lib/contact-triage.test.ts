import test from "node:test";
import assert from "node:assert/strict";
import { analyze, categoryOf, proposeCampus, redact, type Evidence } from "./contact-triage/analyze";
(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";delete process.env.MAIL_PROVIDERS;
const evidence=(message="Não recebi o e-mail"):Evidence=>({contact:{id:1,kind:"duvida",created_at:"2026-11-06T10:00:00Z",message},snapshotAt:"2026-11-06T12:00:00Z",signatures:[],mail:[],events:[],suppression:null,queue:{pending:0,failed:0},unavailable:[],truncated:[]});
const signature=()=>({id:1,status:"pending",category:"apoiador",created_at:"2026-11-06T09:00:00Z",confirmed_at:null as string|null,token_expires_at:"2026-11-07T09:00:00Z",cpf_name_check:"match",email_domain_kind:null,institution:null,campus:null,campus_ibge:null,uf:null});

test("triagem preserva categorias sensíveis e acrescenta campus, sem adivinhar causas",()=>{
 for(const [message,expected] of [["Quero remover minha assinatura, LGPD","remover"],["CPF e nome não conferem","cpf"],["Não achei meu campus na lista","campus"],["O link expirou","expirou"],["Errei meu e-mail, quero corrigir","corrigir"],["O e-mail é inválido","email_recusado"],["Não recebi o e-mail","nao_recebeu"],["A página travou","erro"],["Onde leio o PLV?","duvida"]])assert.equal(categoryOf(message),expected);
 assert.equal(categoryOf("Quero remover a assinatura; meu CPF deu erro"),"remover");
 const e=evidence();e.signatures=[signature()];assert.equal(analyze(e).state,"inconclusive");
 e.mail=[{ts:e.snapshotAt,provider:"dev",status:"sent",kind:"confirmacao"}];
 assert.equal(analyze(e).state,"review");assert.ok(analyze(e).reasons.includes("provider_accepted_not_delivery_proof"));
});

test("nome compatível não confirma identidade; confirmação anterior não resolve automaticamente relato novo",()=>{
 const cpf=evidence("CPF não confere");cpf.signatures=[{...signature(),status:"confirmed",confirmed_at:"2026-11-06T11:00:00Z"}];
 assert.equal(analyze(cpf).state,"inconclusive");assert.ok(analyze(cpf).reasons.includes("name_match_not_identity_proof"));
 const e=evidence();e.signatures=[{...signature(),status:"confirmed",confirmed_at:"2026-11-06T09:30:00Z"}];
 assert.equal(analyze(e).state,"inconclusive");e.signatures[0].confirmed_at="2026-11-06T11:00:00Z";assert.equal(analyze(e).state,"resolved");
 e.signatures.push(signature());assert.ok(analyze(e).reasons.includes("multiple_registrations"));assert.equal(analyze(e).state,"inconclusive");
});

test("fonte indisponível e truncamento não viram ausência de erro nem resolução",()=>{
 for(const key of ["unavailable","truncated"] as const){const e=evidence();e.signatures=[{...signature(),status:"confirmed",confirmed_at:e.snapshotAt}];e[key]=["mail"];assert.equal(analyze(e).state,"inconclusive");assert.deepEqual(analyze(e).reasons,["incomplete_evidence"]);}
 const e=evidence("Quero remover meus dados, LGPD");e.unavailable=["mail"];assert.equal(analyze(e).priority,"high");
});

test("eventos por endereço não são vinculados indevidamente a uma mensagem",()=>{
 const e=evidence();e.signatures=[{...signature(),token_expires_at:"2026-11-05T10:00:00Z"}];e.events=[{ts:e.snapshotAt,provider:"dev",type:"hard_bounce"}];e.suppression={reason:"bounce",created_at:e.snapshotAt};e.queue={pending:1,failed:1};
 const result=analyze(e);assert.equal(result.state,"review");
 for(const code of ["address_event_not_message_linked","address_suppressed","confirmation_link_expired","confirmation_queued","send_failure_recorded"])assert.ok(result.reasons.includes(code));
 assert.ok(result.suggestedActions.includes("human_review"));
});

test("campus: usa a base existente, exige desambiguação e não inclui outro município silenciosamente",()=>{
 assert.equal(proposeCampus({institution:"unir",city:"Campus de Porto Velho"}).status,"listed");
 const unlisted=proposeCampus({institution:"UNIR",city:"Rio Branco",uf:"AC"});assert.equal(unlisted.status,"needs_evidence");assert.equal(unlisted.candidates[0].id,1200401);assert.ok(unlisted.sources.includes("public/data/ifes.json"));
 assert.equal(proposeCampus({institution:"UNIR",city:"Bom Jesus"}).status,"ambiguous_city");
 assert.equal(proposeCampus({institution:"UNIR",city:"Porto Velho",ibge:1200401}).status,"invalid_location");
 assert.equal(proposeCampus({institution:"Universidade inventada",city:"Porto Velho"}).status,"unknown_institution");
 assert.equal(proposeCampus({institution:"UNIR",city:"Vila inventada"}).status,"unknown_city");
 assert.equal(redact("123.456.789-09 a@exemplo.test 10.1.2.3").includes("123.456"),false);
});

async function setup(){const db=await import("./db");await db._openForTests("t_contact_triage");const jobs=await import("./contact-triage/jobs"),collector=await import("./contact-triage/evidence");
 const add=async(message="Não recebi o e-mail",email="triage@example.test")=>(await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('Pessoa Fictícia',$1,'duvida',$2) RETURNING id",[email,message])).rows[0].id as number;
 const signer=async(email="triage@example.test")=>db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,token_hash) VALUES('Pessoa Fictícia',$1,$2,$3,'apoiador','test','2026-11-01T10:00:00Z','never-token')",[email,`hash-${email}`,`cpf-${email}`]);
 return {db,jobs,collector,add,signer};}

test("coleta por campos permitidos preserva a assinatura e não arquiva CPF, segredos novos ou payloads de e-mail",async()=>{
 const c=await setup();try{
  const id=await c.add("Meu CPF 123.456.789-09 está correto? Contato a@exemplo.test");await c.signer();
  await c.db.query("ALTER TABLE signatures ADD COLUMN future_private_data TEXT DEFAULT 'never-future-secret'");
  await c.db.query("INSERT INTO mail_outbox(kind,to_addr,payload) VALUES('confirmacao','triage@example.test','{\"token\":\"never-mail-token\"}')");
  const before=(await c.db.query("SELECT * FROM signatures")).rows;
  const snapshot=await c.collector.collectEvidence(id);assert.ok(snapshot);const json=JSON.stringify(snapshot);
  for(const forbidden of ["123.456.789-09","never-token","never-future-secret","never-mail-token","cpf-triage","hash-triage"])assert.ok(!json.includes(forbidden),forbidden);
  assert.deepEqual((await c.db.query("SELECT * FROM signatures")).rows,before);
  assert.equal(snapshot.evidence.queue?.pending,1);assert.deepEqual(snapshot.evidence.unavailable,[]);
  await c.db.query("DROP TABLE mail_events");const partial=await c.collector.collectEvidence(id);assert.ok(partial);assert.ok(partial.evidence.unavailable.includes("events"));assert.equal(analyze(partial.evidence).state,"inconclusive");
 }finally{await c.db._closeDbForTests();}});

test("descoberta retoma todo o backlog; pedidos simultâneos compartilham uma revisão ativa",async()=>{
 const c=await setup();try{
  const ids:number[]=[];for(let i=0;i<3;i++)ids.push(await c.add());
  assert.equal(await c.jobs.discoverTriages(2),2);assert.equal(await c.jobs.discoverTriages(2),1);assert.equal(await c.jobs.discoverTriages(),0);
  const requested=await Promise.all(Array.from({length:5},()=>c.jobs.requestTriage(ids[0],"operator@example.test")));
  assert.ok(requested.every(r=>r.ok && r.existing));assert.equal(new Set(requested.map(r=>r.ok?r.id:null)).size,1);
  const first=await c.jobs.processTriage();assert.equal(first.status,"complete");
  const old=(await c.jobs.triageHistory(ids[0]))![0];
  const next=await Promise.all(Array.from({length:5},()=>c.jobs.requestTriage(ids[0],"operator@example.test")));
  assert.equal(next.filter(r=>r.ok&&!r.existing).length,1);assert.equal((await c.jobs.triageHistory(ids[0]))!.length,2);
  assert.deepEqual((await c.jobs.triageHistory(ids[0]))![1],old);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("trabalhador antigo perde a posse e não sobrescreve o resultado após reinício",async()=>{
 const c=await setup();let release!:()=>void,started!:()=>void;
 const waiting=new Promise<void>(r=>{release=r;}),began=new Promise<void>(r=>{started=r;});let pending:ReturnType<typeof c.jobs.processTriage>|undefined;
 try{
  const id=await c.add();await c.jobs.requestTriage(id,"operator@example.test");
  pending=c.jobs.processTriage({collect:async contactId=>{const snapshot=await c.collector.collectEvidence(contactId);started();await waiting;return snapshot;}});
  await began;await c.db.query("UPDATE contact_triage_jobs SET lease_until=now()-interval '1 second'");
  const resumed=await c.jobs.processTriage();assert.equal(resumed.status,"complete");release();assert.equal((await pending).status,"stale");
  const history=(await c.jobs.triageHistory(id))!;assert.equal(history.length,1);assert.equal(history[0].attempts,2);
  assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='contact_triage_completed'")).rowCount,1);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{release();await pending;await c.db._closeDbForTests();}});

test("mudança na mensagem durante a análise reencaminha sem publicar resultado antigo",async()=>{
 const c=await setup();try{
  const id=await c.add();await c.jobs.requestTriage(id,"operator@example.test");
  const result=await c.jobs.processTriage({collect:async contactId=>{const snapshot=await c.collector.collectEvidence(contactId);await c.db.query("UPDATE contact_messages SET message='Quero remover a assinatura, LGPD' WHERE id=$1",[id]);return snapshot;}});
  assert.equal(result.status,"queued");let history=(await c.jobs.triageHistory(id))!;assert.equal(history[0].analysis,null);assert.equal(history[0].error_code,"source_changed");
  await c.db.query("UPDATE contact_triage_jobs SET next_attempt_at=now()");assert.equal((await c.jobs.processTriage()).status,"complete");
  history=(await c.jobs.triageHistory(id))!;assert.equal(history[0].analysis.category,"remover");assert.equal(history[0].analysis.priority,"high");
 }finally{await c.db._closeDbForTests();}});

test("falha técnica tem tentativas limitadas, guarda código seguro e permite reprocessamento versionado",async()=>{
 const c=await setup();try{
  const id=await c.add();await c.jobs.requestTriage(id,"operator@example.test");
  for(let n=1;n<=3;n++){
   const result=await c.jobs.processTriage({collect:async()=>{throw new Error("never-secret 123.456.789-09");}});assert.equal(result.status,n===3?"failed":"queued");
   await c.db.query("UPDATE contact_triage_jobs SET next_attempt_at=now()");
  }
  assert.equal((await c.jobs.processTriage()).status,"idle");const old=(await c.jobs.triageHistory(id))![0];assert.equal(old.status,"failed");assert.equal(old.error_code,"evidence_failure");assert.ok(!JSON.stringify(old).includes("never-secret"));
  const requested=await c.jobs.requestTriage(id,"other-operator@example.test");assert.ok(requested.ok && requested.revision===2);assert.equal((await c.jobs.processTriage()).status,"complete");assert.deepEqual((await c.jobs.triageHistory(id))![1],old);
 }finally{await c.db._closeDbForTests();}});

test("falha de auditoria impede a reserva e impede publicar uma análise sem registro",async()=>{
 const c=await setup();try{
  const id=await c.add();
  await c.db.query(`CREATE FUNCTION fail_triage_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('contact_triage_requested','contact_triage_completed') THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER fail_triage_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_triage_audit()`);
  await assert.rejects(c.jobs.requestTriage(id,"operator@example.test"));assert.equal((await c.db.query("SELECT 1 FROM contact_triage_jobs")).rowCount,0);
  await c.jobs.discoverTriages();assert.equal((await c.jobs.processTriage()).status,"queued");let row=(await c.jobs.triageHistory(id))![0];assert.equal(row.analysis,null);assert.equal(row.evidence,null);
  await c.db.query("DROP TRIGGER fail_triage_audit ON audit_log; UPDATE contact_triage_jobs SET next_attempt_at=now()");assert.equal((await c.jobs.processTriage()).status,"complete");row=(await c.jobs.triageHistory(id))![0];assert.equal(row.status,"complete");assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("esgotamento após queda não deixa pedido eternamente em execução",async()=>{
 const c=await setup();let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>{release=r;}),began=new Promise<void>(r=>{started=r;});let pending:ReturnType<typeof c.jobs.processTriage>|undefined;
 try{
  const id=await c.add();await c.jobs.requestTriage(id,"operator@example.test");
  pending=c.jobs.processTriage({collect:async contactId=>{const snapshot=await c.collector.collectEvidence(contactId);started();await waiting;return snapshot;}});
  await began;await c.db.query("UPDATE contact_triage_jobs SET attempts=3,lease_until=now()-interval '1 second'");
  assert.equal((await c.jobs.processTriage()).status,"idle");release();assert.equal((await pending).status,"stale");
  const row=(await c.jobs.triageHistory(id))![0];assert.equal(row.status,"failed");assert.equal(row.error_code,"attempts_exhausted");assert.equal(row.analysis,null);
 }finally{release();await pending;await c.db._closeDbForTests();}});

test("trabalhadores simultâneos não duplicam resultados nem registram texto livre nos snapshots",async()=>{
 const c=await setup();try{
  const id=await c.add("Não recebi. Nome da mãe: never-copy-family. Nascimento: 01/01/1900.");
  await c.add();await c.add();await c.signer();await c.jobs.discoverTriages();
  const before=(await c.db.query("SELECT * FROM signatures")).rows;
  const results=await Promise.all(Array.from({length:4},()=>c.jobs.processTriage()));assert.equal(results.filter(r=>r.status==="complete").length,3);
  assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='contact_triage_completed'")).rowCount,3);
  const history=(await c.jobs.triageHistory(id))!;assert.ok(!JSON.stringify(history).includes("never-copy-family"));assert.equal(history[0].evidence.contact.message,undefined);
  assert.deepEqual((await c.db.query("SELECT * FROM signatures")).rows,before);
  assert.equal((await c.db.query("SELECT 1 FROM contact_replies")).rowCount,0);assert.equal((await c.db.query("SELECT 1 FROM mail_outbox")).rowCount,0);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}});

test("API de triagem exige Edição, usa autor da sessão e não envia resposta",async()=>{
 const c=await setup();const previous={preview:process.env.PREVIEW_MODE,noPassword:process.env.ADMIN_NO_PASSWORD};delete process.env.PREVIEW_MODE;delete process.env.ADMIN_NO_PASSWORD;
 const U=await import("./admin-users"),{NextRequest}=await import("next/server"),{GET,POST}=await import("../app/api/admin/contato/triagem/route");
 try{
  const id=await c.add();const req=(method:string,token="",origin="http://localhost",contact:unknown=id)=>new NextRequest(`http://localhost/api/admin/contato/triagem?contato=${contact}`,{method,headers:{host:"localhost",origin,cookie:`adm=${token}`,"content-type":"application/json"},...(method==="POST"?{body:JSON.stringify({contato:contact,por:"forged@example.test"})}:{})});
  assert.equal((await GET(req("GET"))).status,401);assert.equal((await POST(req("POST"))).status,401);
  for(const nivel of ["leitura","edicao"] as const){
   const email=`triage-${nivel}@example.test`,created=await U.criarUsuario({email,nome:`QA ${nivel}`,nivel,senha:"QA-Triagem-2026-Teste-Local"});assert.ok(created.ok);const session=await U.abrirSessao(created.usuario.id,"127.0.0.1");
   if(nivel==="leitura"){assert.equal((await GET(req("GET",session.token))).status,403);assert.equal((await POST(req("POST",session.token))).status,403);continue;}
   assert.equal((await POST(req("POST",session.token,"https://other.example.test"))).status,403);assert.equal((await c.db.query("SELECT 1 FROM contact_triage_jobs")).rowCount,0);
   assert.equal((await POST(req("POST",session.token))).status,200);assert.equal((await GET(req("GET",session.token))).status,200);
   const row=(await c.jobs.triageHistory(id))![0];assert.equal(row.requested_by,email);assert.ok(!JSON.stringify(row).includes("forged@example.test"));
   assert.equal((await GET(req("GET",session.token,"http://localhost",0))).status,400);assert.equal((await POST(req("POST",session.token,"http://localhost",2147483647))).status,404);
  }
  assert.equal((await c.db.query("SELECT 1 FROM contact_replies")).rowCount,0);assert.equal((await c.db.query("SELECT 1 FROM mail_outbox")).rowCount,0);
 }finally{
  if(previous.preview===undefined)delete process.env.PREVIEW_MODE;else process.env.PREVIEW_MODE=previous.preview;
  if(previous.noPassword===undefined)delete process.env.ADMIN_NO_PASSWORD;else process.env.ADMIN_NO_PASSWORD=previous.noPassword;await c.db._closeDbForTests();
 }});

test("agendador autentica antes da triagem e processa o backlog sem escrever em assinaturas",async()=>{
 const c=await setup();const previous=process.env.CRON_SECRET;process.env.CRON_SECRET="fixture-only-triage-cron";
 try{
  await c.add();await c.signer();const before=(await c.db.query("SELECT * FROM signatures")).rows;
  const {NextRequest}=await import("next/server"),{POST}=await import("../app/api/cron/fila/route");
  const req=(secret:string)=>new NextRequest("http://localhost/api/cron/fila",{method:"POST",headers:{authorization:`Bearer ${secret}`}});
  assert.equal((await POST(req("wrong"))).status,401);assert.equal((await c.db.query("SELECT 1 FROM contact_triage_jobs")).rowCount,0);
  const response=await POST(req("fixture-only-triage-cron"));assert.equal(response.status,200);const json=await response.json();assert.equal(json.contactTriage.discovered,1);assert.equal(json.contactTriage.results[0].status,"complete");
  assert.deepEqual((await c.db.query("SELECT * FROM signatures")).rows,before);assert.equal((await c.db.query("SELECT 1 FROM contact_replies")).rowCount,0);assert.equal((await c.db.query("SELECT 1 FROM mail_outbox")).rowCount,0);
 }finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;await c.db._closeDbForTests();}});
