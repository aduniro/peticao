import test from "node:test";
import assert from "node:assert/strict";
import { brevoApiEvents, mailersendApiEvents, mailrelayApiEvents } from "./mail/api-message-events";
import { credentialScope, mailrelayScope } from "./mail/event-scope";
(process.env as Record<string,string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
const TO = "qa-api-events@example.test", AT = "2026-11-07T03:00:00.123456Z", KEY = "QA_PRIVATE_CREDENTIAL";
const response = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{"content-type":"application/json"}});
const creds = {brevo:null,mailersend:null,sendpulse:null,mailrelayP:null};
async function setup() { const db=await import("./db");await db._openForTests("t_mail_api_events");return {db,A:await import("./mail/archive"),E:await import("./mail/events"),G:await import("./mail/engajamento")}; }
async function receipt(c:Awaited<ReturnType<typeof setup>>,provider:string,id:string,scope:string,to=TO) {
  const message=await c.A.prepareMessage({to,subject:"QA",text:"QA"},"confirmacao","transactional");
  const attempt=await c.A.beginAttempt(message.id,provider,"qa-sender@example.test");assert.ok(attempt.ok);
  assert.ok((await c.A.finishAttempt(attempt.id,"accepted",{providerId:id,accountScope:scope})).ok);return message.id;
}
const brevo=(extra={})=>({messageId:"brevo-qa-id",email:TO,date:AT,reason:"QA_REASON",...extra});
const ms=(extra={})=>({id:"activity-is-not-message",type:"delivered",created_at:AT,email:{message_id:"ms-qa-id",recipient:{email:TO}},...extra});

test("APIs usam IDs documentados, escopo local, data com fuso e projeção mínima",()=>{
  const b=brevoApiEvents([brevo({accountScope:"forged",html:"NEVER_STORE_BODY",url:"NEVER_STORE_LINK"})],KEY,"delivered");
  assert.equal(b.length,1);assert.equal(b[0].accountScope,credentialScope("brevo",KEY));assert.equal(b[0].timestamp,AT);
  assert.deepEqual(mailersendApiEvents([ms()],KEY).map(e=>e.providerId),["ms-qa-id"]);
  for(const row of [ms({email:{id:"activity-id",recipient:{email:TO}}}),ms({created_at:"2026-11-07 03:00:00"}),ms({type:"unknown"})])assert.deepEqual(mailersendApiEvents([row],KEY),[]);
  for(const row of [brevo({messageId:undefined}),brevo({date:"2026-02-31T00:00:00Z"}),brevo({email:"bad"}),null])assert.deepEqual(brevoApiEvents([row],KEY,"delivered"),[]);
  const output=JSON.stringify(b);for(const s of [KEY,"forged","NEVER_STORE_BODY","NEVER_STORE_LINK","QA_REASON"])assert.ok(!output.includes(s));
});

test("Mailrelay distingue conta/host e ID SMTP; processed_at e spam sem data não viram eventos",()=>{
  const row={id:123,email:TO,message_id:"rfc-not-receipt",delivered_at:AT,bounced_at:"2026-11-07T03:01:00Z",soft_bounced_at:"2026-11-07T03:00:30Z",reported_as_spam:true,processed_at:AT,updated_at:AT};
  const facts=mailrelayApiEvents([row],KEY,"qa.ipzmarketing.com","mailrelay");assert.deepEqual(facts.map(e=>e.type),["delivered","hard_bounce","soft_bounce"]);assert.ok(facts.every(e=>e.providerId==="123"));
  assert.equal(facts[0].accountScope,mailrelayScope("mailrelay","qa.ipzmarketing.com",KEY));
  assert.notEqual(facts[0].accountScope,mailrelayApiEvents([row],KEY,"other.ipzmarketing.com","mailrelay")[0].accountScope);
  assert.notEqual(facts[0].accountScope,mailrelayApiEvents([row],KEY,"qa.ipzmarketing.com","mailrelaypresidente")[0].accountScope);
  assert.deepEqual(mailrelayApiEvents([{id:1,email:TO,processed_at:AT,reported_as_spam:true}],KEY,"qa.ipzmarketing.com","mailrelay"),[]);
  for(const id of [0,-1,"123",1.2,Number.MAX_SAFE_INTEGER+1])assert.deepEqual(mailrelayApiEvents([{...row,id}],KEY,"qa.ipzmarketing.com","mailrelay"),[]);
});

test("coletores preservam retorno legado e publicam apenas a página atual ao sink",async()=>{
  const {brevoEvents}=await import("./mail/events");
  const pages:number[]=[];const fake=(async(url:string)=>response({events:url.includes("event=hardBounces")?Array.from({length:url.includes("offset=0")?500:1},(_,i)=>brevo({email:`qa-${url.includes("offset=0")?i:500}@example.test`})) : []})) as typeof fetch;
  const direct=await brevoEvents(KEY,3,fake);
  const withSink=await brevoEvents(KEY,3,fake,async(old,facts)=>{if(old.length){pages.push(old.length);assert.equal(old.length,facts.length);}});
  assert.deepEqual(withSink,direct);assert.deepEqual(pages,[500,1]);assert.equal(direct.length,501);
});

test("poll e engajamento vinculam fatos a mensagens sem alterar recibos, fila ou assinaturas; retry deduplica",async()=>{
  const c=await setup();try {
    const id=await receipt(c,"brevo","brevo-qa-id",credentialScope("brevo",KEY)!);
    await receipt(c,"mailersend","ms-qa-id",credentialScope("mailersend",KEY)!);
    await receipt(c,"mailrelay","123",mailrelayScope("mailrelay","qa.ipzmarketing.com",KEY)!);
    const before={signers:(await c.db.query("SELECT * FROM signatures")).rows,queue:(await c.db.query("SELECT * FROM mail_outbox")).rows,attempts:(await c.db.query("SELECT * FROM mail_message_attempts ORDER BY id")).rows};
    const fake=(async(url:string)=>{
      if(url.includes("api.brevo.com"))return response({events:url.includes("event=hardBounces")||url.includes("event=delivered")?[brevo()]:[]});
      if(url.includes("/domains"))return response({data:[{id:"qa-domain"}]});
      if(url.includes("/activity/"))return response({data:[ms({type:url.includes("event[]=hard_bounced")?"soft_bounced":"delivered"})]});
      if(url.includes("ipzmarketing.com"))return response([{id:123,email:TO,delivered_at:AT}]);
      return response({},404);
    }) as typeof fetch;
    const cfg={...creds,brevo:KEY,mailersend:KEY,mailrelay:{key:KEY,host:"qa.ipzmarketing.com"}};
    assert.ok(Object.values(await c.E.pollProviders(3,fake,cfg)).every(r=>r.ok));
    assert.ok(Object.values(await c.G.syncEngajamento(3,fake,cfg)).every(r=>r.ok));
    const facts=(await c.db.query("SELECT * FROM mail_message_events ORDER BY id")).rows;assert.equal(facts.length,5);assert.ok(facts.every(e=>e.association_state==="linked"));
    assert.equal(facts.filter(e=>e.message_id===id).length,2);
    await c.E.pollProviders(3,fake,cfg);await c.G.syncEngajamento(3,fake,cfg);
    assert.deepEqual((await c.db.query("SELECT * FROM mail_message_events ORDER BY id")).rows,facts);
    assert.deepEqual((await c.db.query("SELECT * FROM signatures")).rows,before.signers);assert.deepEqual((await c.db.query("SELECT * FROM mail_outbox")).rows,before.queue);assert.deepEqual((await c.db.query("SELECT * FROM mail_message_attempts ORDER BY id")).rows,before.attempts);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally {await c.db._closeDbForTests();}
});

test("falha na página seguinte preserva anteriores; retomada não duplica e conta alterada não força vínculo",async()=>{
  const c=await setup();try {
    await receipt(c,"brevo","brevo-qa-id",credentialScope("brevo",KEY)!);
    let fail=true;
    const fake=(async(url:string)=>{
      if(!url.includes("event=hardBounces"))return response({events:[]});
      if(url.includes("offset=500"))return fail?response({},503):response({events:[brevo({email:"qa-other@example.test"})]});
      return response({events:[brevo(),...Array.from({length:499},()=>({}))]});
    }) as typeof fetch;
    assert.equal((await c.E.pollProviders(3,fake,{...creds,brevo:KEY})).brevo.ok,false);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,1);
    fail=false;assert.equal((await c.E.pollProviders(3,fake,{...creds,brevo:KEY})).brevo.ok,true);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,2);
    await c.E.pollProviders(3,fake,{...creds,brevo:"QA_CHANGED_KEY"});
    const facts=(await c.db.query("SELECT association_state FROM mail_message_events")).rows;assert.equal(facts.filter(e=>e.association_state==="linked").length,1);assert.equal(facts.filter(e=>e.association_state==="unlinked").length,3);
  } finally {await c.db._closeDbForTests();}
});

test("falha do journal conserva supressão e agregado; provedor seguinte segue e repetição recupera fatos",async()=>{
  const c=await setup();try {
    await c.db.query("CREATE FUNCTION fail_api_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_message_events_received' THEN RAISE EXCEPTION 'qa_api_audit_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_api_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_api_audit()");
    const fake=(async(url:string)=>url.includes("brevo")?response({events:url.includes("event=hardBounces")?[brevo()]:[]}):response([{id:1,email:"qa-relay@example.test",bounced_at:AT}])) as typeof fetch;
    const cfg={...creds,brevo:KEY,mailrelayP:{key:KEY,host:"qa.ipzmarketing.com"}};
    const result=await c.E.pollProviders(3,fake,cfg);assert.equal(result.brevo.ok,false);assert.equal(result.mailrelaypresidente.ok,false);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_events")).rows[0].n,2);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
    const {isSuppressed}=await import("./mail/suppression");assert.equal(await isSuppressed(TO),true);assert.equal(await isSuppressed("qa-relay@example.test"),true);
    await c.db.query("DROP TRIGGER fail_api_audit ON audit_log; DROP FUNCTION fail_api_audit()");
    assert.ok(Object.values(await c.E.pollProviders(3,fake,cfg)).every(r=>r.ok));assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,2);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally {await c.db._closeDbForTests();}
});

test("SendPulse conserva agregado anterior sem inventar horário de entrega a partir de send_date",async()=>{
  const c=await setup();try {
    const fake=(async(url:string)=>url.includes("oauth")?response({access_token:"QA_TOKEN"}):response([{id:"sp-id",recipient:TO,send_date:"2026-11-07 03:00:00",smtp_answer_code:250}])) as typeof fetch;
    const cfg={...creds,sendpulse:"QA_ID\nQA_SECRET"};assert.equal((await c.G.syncEngajamento(3,fake,cfg)).sendpulse.ok,true);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_engagement")).rows[0].n,1);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,0);
  } finally {await c.db._closeDbForTests();}
});

test("journal divide páginas maiores que cem e descarta campos que não pertencem ao fato",async()=>{
  const c=await setup();try {
    const {recordApiEvents}=await import("./mail/api-message-events");
    const facts=brevoApiEvents(Array.from({length:205},(_,i)=>brevo({messageId:`qa-batch-${i}`})),KEY,"opened");
    await recordApiEvents(facts);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,205);
    await recordApiEvents(facts);assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,205);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally {await c.db._closeDbForTests();}
});

test("engajamento mantém agregado se journal falhar, continua outro provedor e recupera no retry",async()=>{
  const c=await setup();try {
    await c.db.query("CREATE FUNCTION fail_api_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider='brevo' THEN RAISE EXCEPTION 'qa_scope_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_api_scope BEFORE INSERT ON mail_message_events FOR EACH ROW EXECUTE FUNCTION fail_api_scope()");
    const fake=(async(url:string)=>{
      if(url.includes("brevo"))return response({events:url.includes("event=delivered")?[brevo()]:[]});
      if(url.includes("/domains"))return response({data:[{id:"qa-domain"}]});
      return response({data:[ms()]});
    }) as typeof fetch;
    const cfg={...creds,brevo:KEY,mailersend:KEY};const result=await c.G.syncEngajamento(3,fake,cfg);
    assert.equal(result.brevo.ok,false);assert.equal(result.mailersend.ok,true);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_engagement")).rows[0].n,2);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,1);
    await c.db.query("DROP TRIGGER fail_api_scope ON mail_message_events; DROP FUNCTION fail_api_scope()");
    assert.ok(Object.values(await c.G.syncEngajamento(3,fake,cfg)).every(r=>r.ok));assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_events")).rows[0].n,2);
  } finally {await c.db._closeDbForTests();}
});
