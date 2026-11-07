import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string,string>).NODE_ENV="test";process.env.MAIL_PROVIDER="dev";
const mail={to:"qa-recovery@example.test",subject:"NEVER_EXPOSE_SUBJECT",text:"NEVER_EXPOSE_BODY"};
async function setup(){const db=await import("./db");await db._openForTests("t_mail_recovery");const U=await import("./admin-users"),user=await U.criarUsuario({email:"qa-recovery-actor@example.test",nome:"QA",nivel:"total",senha:"QA-Recovery-2026-Ficticia"});assert.ok(user.ok);return{db,U,actor:{userId:user.usuario.id,email:user.usuario.email},A:await import("./mail/archive"),O:await import("./mail/outbox"),R:await import("./mail/recovery")};}
async function pair(c:Awaited<ReturnType<typeof setup>>,state?:"accepted"|"rejected"|"indeterminate"|"prepared"){
 const m=await c.A.prepareMessage(mail,"confirmacao","transactional"),q=await c.A.queueMessage(mail,"confirmacao","QA",m.id);let aid:string|undefined;
 if(state){const a=await c.A.beginAttempt(m.id,"dev","qa@example.test");assert.ok(a.ok);aid=a.id;if(state!=="prepared")await c.A.finishAttempt(a.id,state);}
 return{mid:m.id,q,aid};
}
const snapshot=async(c:Awaited<ReturnType<typeof setup>>)=>(await c.db.query("SELECT * FROM mail_outbox ORDER BY id")).rows;

test("recuperação encerra fila com aceite comprovado, conserva data de aceite e não altera mensagem/assinatura/payload",async()=>{
 const c=await setup();try{
  const p=await pair(c,"accepted");await c.db.query("UPDATE mail_message_attempts SET finished_at='2026-11-01T10:00:00.123456Z' WHERE id=$1",[p.aid]);
  await c.db.query("UPDATE mail_outbox SET status='failed',last_error='mail_rollback_quarantine' WHERE id=$1",[p.q]);
  await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,confirmed_at,created_at,seq) VALUES('QA','qa-preserve@example.test','qa-eh','qa-ch','apoiador','QA','2026-01-01Z','confirmed','2026-01-02Z','2026-01-01Z',77)");
  const before=(await snapshot(c))[0],other=(await c.db.query("SELECT row_to_json(m) data FROM mail_messages m UNION ALL SELECT row_to_json(a) FROM mail_message_attempts a UNION ALL SELECT row_to_json(s) FROM signatures s")).rows;
  const auditBefore=(await c.db.query("SELECT * FROM audit_log ORDER BY id")).rows;
  const status=await c.R.mailRecoveryStatus(p.q);assert.ok(status.ok&&status.eligible);assert.equal(status.acceptedAt,"2026-11-01T10:00:00.123456Z");assert.ok(!JSON.stringify(status).includes("NEVER_EXPOSE"));assert.deepEqual((await c.db.query("SELECT * FROM audit_log ORDER BY id")).rows,auditBefore);
  assert.deepEqual(await c.R.settleAcceptedQueue(p.q,c.actor),{ok:true,existing:false,queueId:p.q});
  const after=(await snapshot(c))[0];assert.equal(after.status,"sent");assert.equal(after.last_error,null);
  assert.equal((await c.db.query("SELECT to_char(sent_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') at FROM mail_outbox WHERE id=$1",[p.q])).rows[0].at,status.acceptedAt);
  for(const k of ["payload","id","message_id","attempts","created_at","next_attempt_at","kind","to_addr"])assert.deepEqual(after[k],before[k]);
  assert.deepEqual((await c.db.query("SELECT row_to_json(m) data FROM mail_messages m UNION ALL SELECT row_to_json(a) FROM mail_message_attempts a UNION ALL SELECT row_to_json(s) FROM signatures s")).rows,other);
  assert.deepEqual(await c.R.settleAcceptedQueue(p.q,c.actor),{ok:true,existing:true,queueId:p.q});assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("incerteza, tentativa em curso, aceite sem prova, conteúdo alterado e legado não liberam recuperação",async()=>{
 const c=await setup();try{
  for(const state of [undefined,"prepared","indeterminate","rejected"] as const){const p=await pair(c,state);const before=await snapshot(c);const result=await c.R.settleAcceptedQueue(p.q,c.actor);assert.equal(result.ok,false);assert.deepEqual(await snapshot(c),before);}
  const missing=await pair(c);await c.db.query("UPDATE mail_messages SET status='accepted' WHERE id=$1",[missing.mid]);assert.equal((await c.R.settleAcceptedQueue(missing.q,c.actor)).ok,false);
  const altered=await pair(c,"accepted");await c.db.query("UPDATE mail_outbox SET payload=$2 WHERE id=$1",[altered.q,JSON.stringify({...mail,text:"changed"})]);assert.equal((await c.R.settleAcceptedQueue(altered.q,c.actor)).ok,false);
  const legacy=await c.O.enqueueMail(mail,"confirmacao","QA");assert.equal((await c.R.settleAcceptedQueue(legacy,c.actor)).ok,false);
 }finally{await c.db._closeDbForTests();}
});

test("concorrência recupera uma vez, audita autor real e falha da auditoria reverte status",async()=>{
 const c=await setup();try{
  const p=await pair(c,"accepted"),results=await Promise.all(Array.from({length:4},()=>c.R.settleAcceptedQueue(p.q,c.actor)));assert.equal(results.filter(r=>r.ok&&!r.existing).length,1);
  const log=(await c.db.query("SELECT data FROM audit_log WHERE event='mail_queue_acceptance_recovered'")).rows;assert.equal(log.length,1);assert.equal(JSON.parse(log[0].data).userId,c.actor.userId);
  const next=await pair(c,"accepted"),before=await snapshot(c);
  await c.db.query("CREATE FUNCTION fail_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_queue_acceptance_recovered' THEN RAISE EXCEPTION 'QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_recovery BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_recovery()");
  await assert.rejects(c.R.settleAcceptedQueue(next.q,c.actor));assert.deepEqual(await snapshot(c),before);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("worker atrasado não sobrescreve fila recuperada, tanto em sucesso quanto em falha",async()=>{
 const c=await setup();try{
  for(const fail of [false,true]){
   const p=await pair(c,"accepted");await c.db.query("UPDATE mail_outbox SET next_attempt_at=now()-interval '1 minute' WHERE id=$1",[p.q]);
   let settled:unknown;await c.O.drainOutbox(async()=>{assert.ok((await c.R.settleAcceptedQueue(p.q,c.actor)).ok);settled=await snapshot(c);if(fail)throw new Error("QA late worker");},1);
   assert.deepEqual(await snapshot(c),settled);
  }
 }finally{await c.db._closeDbForTests();}
});

test("rota exige Total, confirmação extra, origem e usuário atual; corpo não aceita estado ou autor",async()=>{
 const c=await setup();try{
  process.env.ADMIN_NO_PASSWORD="0";const {NextRequest}=await import("next/server"),route=await import("../app/api/admin/emails/recuperacao/route");const p=await pair(c,"accepted"),s=await c.U.abrirSessao(c.actor.userId,"127.0.0.1");
  const request=(method="GET",body:unknown={id:p.q},origin="http://localhost")=>new NextRequest(`http://localhost/api/admin/emails/recuperacao?id=${p.q}`,{method,headers:{host:"localhost",origin,cookie:`adm=${s.token}`},...(method==="POST"?{body:JSON.stringify(body)}:{})});
  assert.equal((await route.GET(request())).status,403);await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1",[c.actor.userId]);
  assert.equal((await route.GET(request())).status,200);assert.equal((await route.POST(request("POST",{id:p.q,userId:999,status:"sent"}))).status,400);assert.equal((await route.POST(request("POST",{id:p.q},"https://foreign.example"))).status,403);
  assert.equal((await route.POST(request("POST"))).status,200);await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1",[c.actor.userId]);assert.equal((await route.GET(request())).status,403);assert.equal((await c.R.settleAcceptedQueue(p.q,c.actor)).ok,false);
  await c.U.encerrarSessao(s.token);
 }finally{await c.db._closeDbForTests();}
});


test("entrega individual não transforma resultado incerto em aceite do envelope e tentativa aberta impede conciliação",async()=>{
 const c=await setup();try{
  const uncertain=await pair(c,"indeterminate");const {credentialScope}=await import("./mail/event-scope"),scope=credentialScope("brevo","qa-recovery-key")!;
  await c.db.query("UPDATE mail_message_attempts SET provider='brevo',account_scope=$2,provider_id='qa-id' WHERE id=$1",[uncertain.aid,scope]);
  const {recordMessageEvents}=await import("./mail/message-events");await recordMessageEvents([{provider:"brevo",accountScope:scope,providerId:"qa-id",recipient:mail.to,type:"delivered",timestamp:"2026-11-07T00:00:00Z",source:"api"}]);
  assert.equal((await c.R.settleAcceptedQueue(uncertain.q,c.actor)).ok,false);
  const active=await pair(c,"prepared");await c.db.query("UPDATE mail_messages SET status='accepted' WHERE id=$1",[active.mid]);
  const status=await c.R.mailRecoveryStatus(active.q);assert.ok(status.ok&&!status.eligible);assert.equal(status.reason,"attempt_unfinished");assert.equal((await c.R.settleAcceptedQueue(active.q,c.actor)).ok,false);
 }finally{await c.db._closeDbForTests();}
});
