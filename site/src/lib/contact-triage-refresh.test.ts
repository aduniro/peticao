import test from "node:test";
import assert from "node:assert/strict";
import { evidenceFingerprint } from "./contact-triage/fingerprint";
import type { Evidence } from "./contact-triage/analyze";
(process.env as Record<string,string>).NODE_ENV="test";process.env.MAIL_PROVIDER="dev";
const empty=():Evidence=>({contact:{id:1,kind:"duvida",created_at:"2026-11-01T00:00:00Z",message:"NEVER_COPY_BODY"},snapshotAt:"2026-11-07T00:00:00Z",signatures:[],mail:[],events:[],suppression:null,queue:{pending:0,failed:0},unavailable:[],truncated:[]});
async function setup(){const db=await import("./db");await db._openForTests("t_triage_refresh");const jobs=await import("./contact-triage/jobs"),E=await import("./contact-triage/evidence"),R=await import("./contact-triage/refresh");
 const add=async(n=1)=>{const email=`qa-refresh-${n}@example.test`;const id=(await db.query("INSERT INTO contact_messages(name,email,kind,message,created_at) VALUES('QA',$1,'duvida','Não recebi o e-mail','2026-11-01T00:00:00Z') RETURNING id",[email])).rows[0].id;
 await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,token_expires_at) VALUES('QA',$1,$2,$3,'apoiador','QA','2026-11-01T00:00:00Z','2030-01-01T00:00:00Z')",[email,`qa-eh-${n}`,`qa-ch-${n}`]);
 await jobs.requestTriage(id,"qa-operator@example.test");assert.equal((await jobs.processTriage()).status,"complete");return{id,email};};
 const refresh=async(limit=2,collect?:typeof E.collectEvidence)=>R.refreshTriages(limit,{collect,deadline:Date.now()+60000});return{db,jobs,E,R,add,refresh};}

test("fingerprint é canônico, ignora relógio/texto livre e percebe expiração efetiva do link",()=>{
 const a=empty(),b={...a,snapshotAt:"2026-11-08T00:00:00Z",contact:{...a.contact,message:"OTHER_PRIVATE_BODY"}};
 assert.equal(evidenceFingerprint(a),evidenceFingerprint(b));assert.match(evidenceFingerprint(a),/^[a-f0-9]{64}$/);
 const reordered=JSON.parse(JSON.stringify(a,(key,value)=>value&&!Array.isArray(value)&&typeof value==="object"?Object.fromEntries(Object.entries(value).reverse()):value));assert.equal(evidenceFingerprint(a),evidenceFingerprint(reordered));
 a.signatures=[{id:1,status:"pending",category:"apoiador",created_at:"2026-11-01T00:00:00Z",confirmed_at:null,token_expires_at:"2026-11-07T01:00:00Z",cpf_name_check:null,email_domain_kind:null,institution:null,campus:null,campus_ibge:null,uf:null}];
 assert.notEqual(evidenceFingerprint(a),evidenceFingerprint({...a,snapshotAt:"2026-11-07T02:00:00Z"}));
 a.signatures[0].status="confirmed";assert.equal(evidenceFingerprint(a),evidenceFingerprint({...a,snapshotAt:"2026-11-07T02:00:00Z"}));
});

test("coleta igual não cria revisões em cada polling e não muda diagnóstico anterior",async()=>{
 const c=await setup();try{const p=await c.add(),before=await c.jobs.triageHistory(p.id);
 for(let i=0;i<3;i++){const r=await c.refresh();assert.equal(r.queued,0);assert.equal(r.unchanged,1);}assert.deepEqual(await c.jobs.triageHistory(p.id),before);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("evento novo agenda revisão, preserva anterior e decisões humanas, sem envio ou escrita de assinatura",async()=>{
 const c=await setup();try{const p=await c.add(),old=(await c.jobs.triageHistory(p.id))![0];
 await c.db.query("INSERT INTO contact_replies(contact_id,versao,assunto,estado) VALUES($1,'texto','QA humana','legacy')",[p.id]);
 await c.db.query("INSERT INTO mail_events(ts,provider,type,email,reason,source) VALUES(now(),'brevo','blocked',$1,'QA','api')",[p.email]);
 const before=(await c.db.query("SELECT row_to_json(s) data FROM signatures s UNION ALL SELECT row_to_json(r) FROM contact_replies r UNION ALL SELECT row_to_json(q) FROM mail_outbox q")).rows;
 const r=await c.refresh();assert.equal(r.queued,1);let history=(await c.jobs.triageHistory(p.id))!;assert.equal(history.length,2);assert.equal(history[0].requested_by,"system:evidence-refresh");assert.equal(history[0].status,"queued");assert.deepEqual(history[1],old);
 assert.equal((await c.jobs.processTriage()).status,"complete");history=(await c.jobs.triageHistory(p.id))!;assert.ok(history[0].analysis.reasons.includes("address_event_not_message_linked"));assert.deepEqual(history[1],old);assert.equal((await c.refresh()).queued,0);
 assert.deepEqual((await c.db.query("SELECT row_to_json(s) data FROM signatures s UNION ALL SELECT row_to_json(r) FROM contact_replies r UNION ALL SELECT row_to_json(q) FROM mail_outbox q")).rows,before);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("confirmação posterior ao relato atualiza apenas diagnóstico em nova versão",async()=>{
 const c=await setup();try{const p=await c.add();await c.db.query("UPDATE signatures SET status='confirmed',confirmed_at=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),seq=77 WHERE email=$1",[p.email]);const before=(await c.db.query("SELECT * FROM signatures")).rows;
 assert.equal((await c.refresh()).queued,1);assert.equal((await c.jobs.processTriage()).status,"complete");const history=(await c.jobs.triageHistory(p.id))!;assert.equal(history[0].analysis.state,"resolved");assert.equal(history.length,2);assert.deepEqual((await c.db.query("SELECT * FROM signatures")).rows,before);
 }finally{await c.db._closeDbForTests();}
});

test("reanálise concorrente/manual não duplica revisão e leitura antiga não se sobrepõe a pedido mais recente",async()=>{
 const c=await setup();try{const p=await c.add();await c.db.query("INSERT INTO mail_events(ts,provider,type,email,reason) VALUES(now(),'brevo','hard_bounce',$1,'QA')",[p.email]);
 const results=await Promise.all([c.refresh(),c.refresh()]);assert.equal(results.reduce((n,r)=>n+r.queued,0),1);assert.equal((await c.jobs.triageHistory(p.id))!.length,2);
 assert.equal((await c.jobs.processTriage()).status,"complete");
 const later=await c.refresh(1,async id=>{await c.db.query("UPDATE signatures SET cpf_name_check='match' WHERE email=$1",[p.email]);const e=await c.E.collectEvidence(id);assert.ok(e);await c.jobs.requestTriage(id,"qa-manual@example.test");return e;});
 assert.equal(later.queued,0);assert.equal(later.stale,1);const history=(await c.jobs.triageHistory(p.id))!;assert.equal(history.length,3);assert.equal(history[0].requested_by,"qa-manual@example.test");
 }finally{await c.db._closeDbForTests();}
});

test("falha temporária e auditoria com erro não apagam revisão; ciclo posterior recupera",async()=>{
 const c=await setup();try{const p=await c.add(),before=await c.jobs.triageHistory(p.id);
 const error=await c.refresh(1,async()=>{throw new Error("NEVER_STORE_RAW_ERROR");});assert.equal(error.unavailable,1);assert.deepEqual(await c.jobs.triageHistory(p.id),before);
 await c.db.query("INSERT INTO mail_events(ts,provider,type,email,reason) VALUES(now(),'brevo','blocked',$1,'QA')",[p.email]);
 await c.db.query("CREATE FUNCTION fail_refresh_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contact_triage_refresh_requested' THEN RAISE EXCEPTION 'QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_refresh_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_refresh_audit()");
 assert.equal((await c.refresh()).unavailable,1);assert.deepEqual(await c.jobs.triageHistory(p.id),before);await c.db.query("DROP TRIGGER fail_refresh_audit ON audit_log; DROP FUNCTION fail_refresh_audit()");assert.equal((await c.refresh()).queued,1);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});

test("scan faz rodízio limitado e não reabre trabalho esgotado ou de outro motor",async()=>{
 const c=await setup();try{const items=[];for(let n=1;n<=3;n++)items.push(await c.add(n));const seen:number[]=[];
 for(let n=0;n<3;n++)await c.refresh(1,async id=>{seen.push(id);return c.E.collectEvidence(id);});assert.deepEqual(seen,items.map(p=>p.id));
 await c.db.query("UPDATE contact_triage_jobs SET status='failed',error_code='attempts_exhausted' WHERE contact_id=$1",[items[0].id]);await c.db.query("UPDATE contact_triage_jobs SET engine='future-engine' WHERE contact_id=$1",[items[1].id]);
 seen.length=0;await c.refresh(2,async id=>{seen.push(id);return c.E.collectEvidence(id);});assert.deepEqual(seen,[items[2].id]);assert.equal((await c.jobs.triageHistory(items[0].id))!.length,1);
 const expired=await c.R.refreshTriages(1,{deadline:Date.now()-1});assert.equal(expired.scanned,0);
 }finally{await c.db._closeDbForTests();}
});
