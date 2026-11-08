import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";delete process.env.MAIL_PROVIDERS;
const CANDIDATE="a".repeat(64), REQUEST="0123456789abcdef", ACTOR={userId:9,email:"qa-reconciler@example.test"};
async function setup() {
 const db=await import("./db");await db._openForTests("t_action_reconcile");const H=await import("./acoes/history");
 await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES($1,$2,'QA Reconciler','total','QA-NOT-A-LOGIN-HASH')",[ACTOR.userId,ACTOR.email]);
 const previous=process.env.PUBLICAR_ESTADO_DIR, dir=mkdtempSync(join(tmpdir(),"action-reconcile-"));process.env.PUBLICAR_ESTADO_DIR=dir;
 const add=async (request=REQUEST, state="indeterminado", action="publicar.pedir")=>(await db.query("INSERT INTO admin_acoes(user_id,email,acao,modo,parametros,central_estado,central_request_id,ok,resultado) VALUES(1,'original@example.test',$1,'executar',$2,$3,$4,false,'{\"erro\":\"lost response\"}') RETURNING id",[action,JSON.stringify({candidato:CANDIDATE}),state,request])).rows[0].id as number;
 const proof=(extra:Record<string,unknown>={})=>writeFileSync(join(dir,`resultado-${typeof extra.id === "string" ? extra.id : REQUEST}.json`),JSON.stringify({format:1,id:REQUEST,candidato:CANDIDATE,estado:"ok",inicio:"2026-11-06T10:00:00Z",fim:"2026-11-06T10:10:00Z",codigo:0,...extra}));
 const close=async()=>{if(previous===undefined)delete process.env.PUBLICAR_ESTADO_DIR;else process.env.PUBLICAR_ESTADO_DIR=previous;rmSync(dir,{recursive:true,force:true});await db._closeDbForTests();};
 return {db,H,dir,add,proof,close};
}

test("conciliação usa o comprovante exato, preserva autoria/data e não executa novamente",async()=>{
 const c=await setup();
 try {
  const id=await c.add(), original=(await c.db.query("SELECT * FROM admin_acoes WHERE id=$1",[id])).rows[0];
  assert.deepEqual(await c.H.conciliarPublicacao(id,ACTOR),{ok:false,erro:"sem_evidencia"});
  // Latest mutable status cannot be used as evidence, even with matching request/candidate.
  writeFileSync(join(c.dir,"publicar.estado"),JSON.stringify({id:REQUEST,candidato:CANDIDATE,estado:"ok"}));
  assert.equal((await c.H.conciliarPublicacao(id,ACTOR)).ok,false);
  c.proof({candidato:"b".repeat(64)});assert.equal((await c.H.conciliarPublicacao(id,ACTOR)).ok,false);
  c.proof();const result=await c.H.conciliarPublicacao(id,ACTOR);assert.ok(result.ok);assert.equal(result.estado,"aceito");assert.equal(result.alterado,true);
  const current=(await c.db.query("SELECT * FROM admin_acoes WHERE id=$1",[id])).rows[0];
  for(const key of ["id","user_id","email","ts","parametros","central_request_id"]) assert.deepEqual(current[key],original[key]);
  assert.equal(current.resultado.erro,"lost response");assert.equal(current.resultado.publicacao.estado,"ok");
  const again=await c.H.conciliarPublicacao(id,ACTOR);assert.ok(again.ok);assert.equal(again.alterado,false);
  assert.equal((await c.db.query("SELECT 1 FROM admin_acoes")).rowCount,1);
  const logs=(await c.db.query("SELECT data FROM audit_log WHERE event='admin_acao_conciliada'")).rows;assert.equal(logs.length,1);assert.equal(JSON.parse(logs[0].data).por,ACTOR.email);
  assert.ok((await c.db.verifyAuditChain()).ok);
 } finally {await c.close();}
});

test("rejeição comprovada libera outro pedido; falhas de publicação continuam indeterminadas",async()=>{
 const c=await setup();const A=await import("./acoes"), action=A.ACOES.find(a=>a.id==="publicar.pedir")!, previous=action.executar;let effects=0;
 action.executar=async()=>{effects++;return {pedido:"new-fixture"};};
 try {
  const id=await c.add();c.proof({estado:"recusado",codigo:null});const rejected=await c.H.conciliarPublicacao(id,ACTOR);assert.ok(rejected.ok);assert.equal(rejected.estado,"falhou");
  assert.ok((await A.rodarAcao(action.id,"executar",{candidato:CANDIDATE},"PUBLICAR",ACTOR)).ok);assert.equal(effects,1);
  await c.db.query("DELETE FROM admin_acoes WHERE id<>$1",[id]);
  // Exit status is not proof that a partial deploy or child processes were fully recovered.
  for(const [index,code] of [3,124,-9].entries()){
   const request=(15-index).toString(16).repeat(16), timedId=await c.add(request);c.proof({id:request,estado:"falhou",codigo:code});
   const timed=await c.H.conciliarPublicacao(timedId,ACTOR);assert.ok(timed.ok);assert.equal(timed.estado,"indeterminado");
  }
  assert.equal((await A.rodarAcao(action.id,"executar",{candidato:CANDIDATE},"PUBLICAR",ACTOR)).ok,false);assert.equal(effects,1);
 } finally {action.executar=previous;await c.close();}
});

test("conciliação revalida conta Total atual antes de aceitar recibo e não altera pedido revogado",async()=>{
 const c=await setup();
 try {
  const id=await c.add();c.proof();
  const snapshot=async()=>(await c.db.query("SELECT row_to_json(a)::text raw FROM admin_acoes a WHERE id=$1",[id])).rows[0];
  const original=await snapshot();
  for(const change of ["ativo=false","nivel='edicao'","email='qa-changed@example.test'"]){
   await c.db.query(`UPDATE admin_users SET ativo=true,nivel='total',email=$1 WHERE id=$2`,[ACTOR.email,ACTOR.userId]);
   await c.db.query(`UPDATE admin_users SET ${change} WHERE id=$1`,[ACTOR.userId]);
   assert.deepEqual(await c.H.conciliarPublicacao(id,ACTOR),{ok:false,erro:"nao_autorizado"});
   assert.deepEqual(await snapshot(),original);assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='admin_acao_conciliada'")).rowCount,0);
  }
  await c.db.query("UPDATE admin_users SET ativo=true,nivel='total',email=$1 WHERE id=$2",[ACTOR.email,ACTOR.userId]);
  assert.deepEqual(await c.H.conciliarPublicacao(id,{...ACTOR,email:"forged@example.test"}),{ok:false,erro:"nao_autorizado"});
  assert.deepEqual(await c.H.conciliarPublicacao(id,{...ACTOR,userId:0}),{ok:false,erro:"nao_autorizado"});
  const result=await c.H.conciliarPublicacao(id,ACTOR);assert.ok(result.ok);assert.equal(result.estado,"aceito");assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.close();}
});

test("resultado e auditoria da conciliação são atômicos; falha não desbloqueia pedido",async()=>{
 const c=await setup();
 try {
  const id=await c.add();c.proof();
  await c.db.query(`CREATE FUNCTION fail_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_acao_conciliada' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER fail_reconciliation BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_reconciliation()`);
  await assert.rejects(c.H.conciliarPublicacao(id,ACTOR));
  const row=(await c.db.query("SELECT central_estado,resultado FROM admin_acoes WHERE id=$1",[id])).rows[0];assert.equal(row.central_estado,"indeterminado");assert.equal(row.resultado.publicacao,undefined);
 } finally {await c.close();}
});

test("conciliação concorrente registra uma decisão; disputa com executor respeita a trava",async()=>{
 const c=await setup();
 try {
  const id=await c.add();c.proof();
  const results=await Promise.all(Array.from({length:6},()=>c.H.conciliarPublicacao(id,ACTOR)));
  assert.equal(results.filter(r=>r.ok && r.alterado).length,1);
  assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='admin_acao_conciliada'")).rowCount,1);
  await c.db.tx(async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('acao-grupo:publicar'))");
   assert.deepEqual(await c.H.conciliarPublicacao(id,ACTOR),{ok:false,erro:"ocupado"});
  });
 } finally {await c.close();}
});

test("histórico pagina por ID, limita resultados e não expõe tokens, parâmetros ou resultados brutos",async()=>{
 const c=await setup();
 try {
  const ids=[];for(let i=1;i<=4;i++)ids.push(await c.add(i.toString(16).padStart(16,"0")));
  await c.db.query("UPDATE admin_acoes SET central_simulacao_hash='never-expose',resultado=resultado||'{\"segredo_fixture\":\"never-expose\"}'::jsonb");
  const first=await c.H.historicoAcoes(undefined,2);assert.ok(first.ok);assert.deepEqual(first.registros.map(r=>r.id),ids.slice(2).reverse());assert.equal(first.proximo,ids[2]);
  const next=await c.H.historicoAcoes(first.proximo!,2);assert.ok(next.ok);assert.deepEqual(next.registros.map(r=>r.id),ids.slice(0,2).reverse());assert.equal(next.proximo,null);
  assert.ok(!JSON.stringify(first).includes("never-expose"));assert.ok(!JSON.stringify(first).includes(CANDIDATE));
  for(const [before,limit] of [[0,2],[1,0],[1,51],[1,1.5]])assert.equal((await c.H.historicoAcoes(before,limit)).ok,false);
  assert.deepEqual(await c.H.conciliarPublicacao(-1,ACTOR),{ok:false,erro:"parametros"});
  assert.deepEqual(await c.H.conciliarPublicacao(2147483647,ACTOR),{ok:false,erro:"nao_encontrado"});
  await c.db.query("UPDATE admin_acoes SET central_estado='legacy'");c.proof();assert.equal((await c.H.conciliarPublicacao(ids[0],ACTOR)).ok,false);
 } finally {await c.close();}
});

test("API de histórico/conciliação exige Total e step-up e grava autor da sessão",async()=>{
 const c=await setup();const previous={preview:process.env.PREVIEW_MODE,noPassword:process.env.ADMIN_NO_PASSWORD};
 delete process.env.PREVIEW_MODE;delete process.env.ADMIN_NO_PASSWORD;
 const U=await import("./admin-users"),{NextRequest}=await import("next/server"),{GET,POST}=await import("../app/api/admin/acoes/route");
 try {
  const id=await c.add();c.proof();
  const request=(method:string,token="",origin="http://localhost",query="")=>new NextRequest(`http://localhost/api/admin/acoes${query}`,{method,headers:{host:"localhost",origin,cookie:`adm=${token}`,"content-type":"application/json"},...(method==="POST"?{body:JSON.stringify({modo:"conciliar",id,email:"forged@example.test",estado:"concluido"})}:{})});
  assert.equal((await GET(request("GET"))).status,401);assert.equal((await POST(request("POST"))).status,401);
  for(const nivel of ["leitura","edicao","exclusao","total"] as const){
   const email=`history-${nivel}@example.test`, created=await U.criarUsuario({email,nome:`QA ${nivel}`,nivel,senha:"QA-Local-Teste-2026-Historico"});assert.ok(created.ok);
   const session=await U.abrirSessao(created.usuario.id,"127.0.0.1");
   assert.equal((await GET(request("GET",session.token))).status,403);
   assert.equal((await POST(request("POST",session.token))).status,403);
   if(nivel==="total"){
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1",[created.usuario.id]);
    assert.equal((await POST(request("POST",session.token,"https://external.example.test"))).status,403);
    const before=(await c.db.query("SELECT central_estado FROM admin_acoes WHERE id=$1",[id])).rows[0];assert.equal(before.central_estado,"indeterminado");
    const result=await POST(request("POST",session.token));assert.equal(result.status,200);assert.equal((await result.json()).estado,"aceito");
    const history=await GET(request("GET",session.token));assert.equal(history.status,200);assert.equal((await history.json()).registros[0].email,"original@example.test");
    assert.equal((await GET(request("GET",session.token,"http://localhost","?limite=51"))).status,400);
    const log=(await c.db.query("SELECT data FROM audit_log WHERE event='admin_acao_conciliada'")).rows[0];assert.equal(JSON.parse(log.data).por,email);assert.ok(!log.data.includes("forged@example.test"));
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()-interval '1 minute' WHERE user_id=$1",[created.usuario.id]);
    assert.equal((await GET(request("GET",session.token))).status,403);
   }
  }
  assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{
  if(previous.preview===undefined)delete process.env.PREVIEW_MODE;else process.env.PREVIEW_MODE=previous.preview;
  if(previous.noPassword===undefined)delete process.env.ADMIN_NO_PASSWORD;else process.env.ADMIN_NO_PASSWORD=previous.noPassword;
  await c.close();
 }
});
