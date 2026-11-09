import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";delete process.env.MAIL_PROVIDERS;
process.env.APP_URL="https://sancionaintegral.org";
const ADDRESS="maria@respostas-teste.example",POR={userId:1,email:"dona@example.org"};
const ENT={assunto:"Re: sua dúvida sobre a petição",corpo:"Obrigado pelo contato.\n\nA sua assinatura foi confirmada."};
const setup=async()=>{const db=await import("./db");await db._openForTests("t_contact_replies");return{db,C:await import("./contact-replies"),D:await import("./contact-delivery"),H:await import("./security")};};
async function scenario(c:Awaited<ReturnType<typeof setup>>,code=true){
 const id=(await c.db.query<{id:number}>("INSERT INTO contact_messages(name,email,kind,message) VALUES('Maria Souza',$1,'duvida','Mensagem fictícia de contato') RETURNING id",[ADDRESS])).rows[0].id;
 if(code){const signature=(await c.db.query<{id:number}>("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status) VALUES('Maria Souza',$1,$2,'apoiador','fixture','2026-10-01T00:00:00Z','confirmed') RETURNING id",[ADDRESS,c.H.hmac(ADDRESS)])).rows[0].id;await c.db.query("INSERT INTO referrers(code,signature_id) VALUES('MARIA1',$1)",[signature]);}
 const sent:any[]=[];const sender=async(mail:any,kind:string,opts:any)=>{sent.push({mail,kind,opts});return "sent" as const;};
 const preview=(await c.C.montarPrevia(id,ENT,1))!;
 return{id,sent,sender,preview,input:{contactId:id,entrada:ENT,selo:preview.selo,por:POR,enviar:sender as never}};
}
const jobs=async(c:Awaited<ReturnType<typeof setup>>)=>(await c.db.query("SELECT * FROM contact_replies ORDER BY id")).rows;
async function until(fn:()=>Promise<boolean>){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}assert.fail("state did not settle");}

test("resposta preserva modelos, guarda os dois conteúdos antes do envio e só libera o card após aceite",async()=>{
 const c=await setup();try{
  const a=await scenario(c);
  assert.match(a.preview.texto.texto,/^Olá, Maria,\n\nObrigado pelo contato\./);
  assert.ok(a.preview.card?.html.includes("/api/cartaz/MARIA1.png"));assert.equal(a.preview.texto.assunto,ENT.assunto);
  assert.equal((await c.C.enviarResposta({...a.input,selo:"errado"})).ok,false);assert.equal((await jobs(c)).length,0);
  const sender=async(mail:any,kind:string,opts:any)=>{
   const rows=await jobs(c);assert.deepEqual(rows.map(r=>r.estado),["sending","blocked"]);
   assert.equal(rows[0].payload.text,a.preview.texto.texto);assert.equal(rows[1].payload.html,a.preview.card!.html);
   return a.sender(mail,kind,opts);
  };
  assert.deepEqual(await c.C.enviarResposta({...a.input,enviar:sender as never}),{ok:true,texto:"enviado",card:"agendado",rodada:1});
  let rows=await jobs(c);assert.deepEqual(rows.map(r=>[r.estado,r.ok]),[["accepted",true],["prepared",false]]);
  assert.equal(a.sent.length,1);assert.equal(a.sent[0].mail.html,undefined);assert.equal(a.sent[0].mail.to,ADDRESS);
  assert.ok(a.sent[0].mail.bcc.length&&a.sent[0].mail.replyTo);assert.deepEqual(a.sent[0].opts,{queue:false,singleAttempt:true,messageKey:`contact-reply:${rows[0].id}`});
  assert.ok(new Date(rows[1].due_at).getTime()>Date.now()+50_000);
  assert.equal((await c.D.drainContactReplies(5,{enviar:a.sender as never})).tried,0);
  await c.db.query("UPDATE contact_replies SET due_at=now()-interval '1 second' WHERE versao='card'");
  assert.equal((await c.D.drainContactReplies(5,{enviar:a.sender as never})).accepted,1);
  assert.equal(a.sent.length,2);assert.equal(a.sent[1].mail.subject,c.C.ASSUNTO_CARD);
  rows=await jobs(c);assert.ok(rows.every(row=>row.estado==="accepted"&&row.ok&&row.attempts===1));
  await c.D.drainContactReplies(5,{enviar:a.sender as never});assert.equal(a.sent.length,2);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n,0);
  assert.deepEqual(await c.C.enviarResposta(a.input),{ok:false,erro:"ja_respondida"});assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});
test("selo amarra destinatário, conteúdo e origem; alteração exige nova prévia",async()=>{
 const c=await setup();try{
  const a=await scenario(c,false);
  assert.equal((await c.C.enviarResposta({...a.input,entrada:{...ENT,corpo:ENT.corpo+" alteração"}}) as any).erro,"selo");
  assert.equal((await c.C.enviarResposta({...a.input,origin:"https://other.example"}) as any).erro,"selo");
  await c.db.query("UPDATE contact_messages SET email='outro@example.org' WHERE id=$1",[a.id]);
  assert.equal((await c.C.enviarResposta(a.input) as any).erro,"selo");assert.equal(a.sent.length,0);assert.equal((await jobs(c)).length,0);
  assert.equal(c.C.validarEntrada({assunto:"ab",corpo:"texto suficientemente longo"}).ok,false);
 }finally{await c.db._closeDbForTests();}
});
test("duas abas reservam uma rodada só; nova rodada exige outro selo e intenção explícita",async()=>{
 const c=await setup();try{
  const a=await scenario(c,false);
  const results=await Promise.all([c.C.enviarResposta(a.input),c.C.enviarResposta(a.input)]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(a.sent.length,1);assert.equal((await jobs(c)).length,1);
  assert.equal((await c.C.enviarResposta({...a.input,nova:true}) as any).erro,"selo");
  const second=(await c.C.montarPrevia(a.id,ENT,2))!;
  assert.ok((await c.C.enviarResposta({...a.input,nova:true,selo:second.selo})).ok);
  assert.equal(a.sent.length,2);assert.equal((await c.C.historicoDeRespostas([a.id]))[a.id].length,2);
 }finally{await c.db._closeDbForTests();}
});
test("erro após possível aceite fica inconclusivo; tempo e repetição não apagam reserva nem reenviam",async()=>{
 const c=await setup();try{
  const a=await scenario(c);let attempts=0;
  const sender=async()=>{attempts++;throw new Error("provedor pode ter aceitado antes da queda");};
  assert.deepEqual(await c.C.enviarResposta({...a.input,enviar:sender as never}),{ok:false,erro:"envio_inconclusivo"});
  const before=await jobs(c);assert.deepEqual(before.map(r=>r.estado),["uncertain","blocked"]);
  await c.db.query("UPDATE contact_replies SET criada_em=now()-interval '10 minutes',started_at=now()-interval '10 minutes'");
  assert.equal((await c.D.drainContactReplies(5,{enviar:sender as never})).tried,0);
  assert.equal((await c.C.enviarResposta(a.input) as any).erro,"envio_inconclusivo");
  assert.equal(attempts,1);assert.deepEqual((await jobs(c)).map(r=>r.id),before.map(r=>r.id));
 }finally{await c.db._closeDbForTests();}
});
test("interrupção após reserva retoma o primeiro envio; falha na reserva não cria mensagem órfã",async()=>{
 const c=await setup();try{
  const a=await scenario(c);
  await c.db.query(`CREATE FUNCTION fail_contact_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contato_envio_iniciado' THEN RAISE EXCEPTION 'claim failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER fail_contact_claim BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_contact_claim();`);
  assert.equal((await c.C.enviarResposta(a.input) as any).erro,"envio_inconclusivo");assert.equal(a.sent.length,0);
  assert.deepEqual((await jobs(c)).map(r=>r.estado),["prepared","blocked"]);
  await c.db.query("DROP TRIGGER fail_contact_claim ON audit_log");
  assert.equal((await c.D.drainContactReplies(5,{enviar:a.sender as never})).accepted,1);assert.equal(a.sent.length,1);
  assert.deepEqual((await jobs(c)).map(r=>r.estado),["accepted","prepared"]);
 }finally{await c.db._closeDbForTests();}
 const d=await setup();try{
  const a=await scenario(d);
  await d.db.query(`CREATE FUNCTION fail_card_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.versao='card' THEN RAISE EXCEPTION 'card reservation failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER fail_card_reservation BEFORE INSERT ON contact_replies FOR EACH ROW EXECUTE FUNCTION fail_card_reservation();`);
  await assert.rejects(d.C.enviarResposta(a.input),/card reservation failure/);assert.equal((await jobs(d)).length,0);assert.equal(a.sent.length,0);
 }finally{await d.db._closeDbForTests();}
});
test("falha ao registrar aceite ou liberar card mantém texto inconclusivo e não repete o envio",async()=>{
 for(const target of ["texto","card"]){const c=await setup();try{
  const a=await scenario(c);
  await c.db.query(`CREATE FUNCTION fail_contact_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.versao='${target}' AND NEW.estado='${target==="texto"?"accepted":"prepared"}' THEN RAISE EXCEPTION 'result failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER fail_contact_result BEFORE UPDATE ON contact_replies FOR EACH ROW EXECUTE FUNCTION fail_contact_result();`);
  assert.equal((await c.C.enviarResposta(a.input) as any).erro,"envio_inconclusivo");assert.equal(a.sent.length,1);
  const rows=await jobs(c);assert.deepEqual(rows.map(r=>r.estado),["uncertain","blocked"]);assert.equal(rows[0].error_code,"persistence_after_accept");
  await c.db.query("DROP TRIGGER fail_contact_result ON contact_replies");await c.D.drainContactReplies(5,{enviar:a.sender as never});assert.equal(a.sent.length,1);
 }finally{await c.db._closeDbForTests();}}
});
test("timeout não reenvia; confirmação tardia da mesma tentativa pode liberar o card",async()=>{
 const c=await setup();try{
  const a=await scenario(c);let resolve!:()=>void;const gate=new Promise<void>(r=>{resolve=r;});let count=0;
  const sender=async()=>{count++;await gate;return "sent" as const;};
  assert.equal((await c.C.enviarResposta({...a.input,enviar:sender as never,deadlineMs:15}) as any).erro,"envio_inconclusivo");
  assert.equal((await jobs(c))[0].estado,"uncertain");assert.equal(count,1);
  resolve();await until(async()=>(await jobs(c))[0].estado==="accepted");
  assert.deepEqual((await jobs(c)).map(r=>r.estado),["accepted","prepared"]);
  await c.D.drainContactReplies(5,{enviar:sender as never});assert.equal(count,1);
 }finally{await c.db._closeDbForTests();}
});
test("worker perdido vira inconclusivo; legado é preservado; guardas barram destinatário proibido e supressão",async()=>{
 const c=await setup();try{
  const a=await scenario(c,false);
  await c.db.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto) VALUES($1,1,'texto','legado','Histórico antigo')",[a.id]);
  const old=(await jobs(c))[0];assert.equal(old.estado,"legacy");
  assert.equal((await c.D.drainContactReplies(5,{enviar:a.sender as never})).tried,0);assert.equal((await jobs(c))[0].id,old.id);
  await c.db.query("UPDATE contact_replies SET estado='sending',started_at=now()-interval '6 minutes',attempt_id='lost' WHERE id=$1",[old.id]);
  assert.equal(await c.D.reconcileInterruptedContacts(),1);assert.equal((await jobs(c))[0].estado,"uncertain");assert.equal(a.sent.length,0);
  const forbidden=(await c.db.query<{id:number}>("INSERT INTO contact_messages(name,email,kind,message) VALUES('Teste','adunir.andes@gmail.com','outro','Mensagem fictícia') RETURNING id")).rows[0].id;
  const p=(await c.C.montarPrevia(forbidden,ENT,1))!;
  assert.equal((await c.C.enviarResposta({contactId:forbidden,entrada:ENT,selo:p.selo,por:POR,enviar:a.sender as never}) as any).erro,"falhou");assert.equal(a.sent.length,0);
  const {suppress}=await import("./mail/suppression");await suppress(ADDRESS,"bounce");
  const p2=(await c.C.montarPrevia(a.id,ENT,2))!;
  assert.equal((await c.C.enviarResposta({...a.input,nova:true,selo:p2.selo}) as any).erro,"falhou");
 }finally{await c.db._closeDbForTests();}
});
test("rota de resposta e worker mantêm autorização: total + step-up e segredo do agendador",async()=>{
 const {readFileSync}=await import("node:fs"),{join}=await import("node:path");
 assert.match(readFileSync(join(__dirname,"../app/api/admin/contato/responder/route.ts"),"utf8"),/exigirNivel\(req, "total", \d+, \{ stepup: true \}\)/);
 const route=readFileSync(join(__dirname,"../app/api/cron/fila/route.ts"),"utf8");assert.ok(route.indexOf("safeEqual(got, secret)")<route.indexOf("await drainContactReplies"));
});

test("workers concorrentes despacham cada item uma vez e preservam o vínculo entre texto e card", async () => {
  const c = await setup();
  try {
    const a = await scenario(c);
    await c.db.query("CREATE FUNCTION stop_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contato_envio_iniciado' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$");
    await c.db.query("CREATE TRIGGER stop_claim BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION stop_claim()");
    assert.equal((await c.C.enviarResposta(a.input) as any).erro, "envio_inconclusivo");
    await c.db.query("DROP TRIGGER stop_claim ON audit_log");
    const pair = await Promise.all([c.D.drainContactReplies(5, { enviar: a.sender as never }), c.D.drainContactReplies(5, { enviar: a.sender as never })]);
    assert.equal(pair.reduce((sum, r) => sum + r.accepted, 0), 1);
    assert.equal(a.sent.length, 1);
    await c.db.query("UPDATE contact_replies SET due_at=now()-interval '1 second' WHERE versao='card'");
    const cards = await Promise.all([c.D.drainContactReplies(5, { enviar: a.sender as never }), c.D.drainContactReplies(5, { enviar: a.sender as never })]);
    assert.equal(cards.reduce((sum, r) => sum + r.accepted, 0), 1);
    assert.equal(a.sent.length, 2);
    assert.ok((await jobs(c)).every(row => row.attempts === 1 && row.estado === "accepted"));
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("agendador recusa chamada sem segredo sem tocar a fila de contato", async () => {
  const c = await setup();
  const previous = process.env.CRON_SECRET;
  try {
    const a = await scenario(c, false);
    const { NextRequest } = await import("next/server");
    const { POST } = await import("../app/api/cron/fila/route");
    process.env.CRON_SECRET = "fixture-cron-not-a-real-secret";
    const response = await POST(new NextRequest("http://localhost/api/cron/fila", { method: "POST", headers: { authorization: "Bearer wrong" } }));
    assert.equal(response.status, 401);
    assert.equal((await jobs(c)).length, 0);
    assert.equal(a.sent.length, 0);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
    await c.db._closeDbForTests();
  }
});
