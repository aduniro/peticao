import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { analyze } from "./contact-triage/analyze";
import { outboundReasons, type OutboundEvidence } from "./contact-triage/outbound";
(process.env as Record<string,string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

async function setup() {
  const db = await import("./db");
  await db._openForTests("t_triage_outbound");
  const E = await import("./contact-triage/evidence"), J = await import("./contact-triage/jobs"), R = await import("./contact-triage/refresh"), S = await import("./contact-triage/suggestion");
  const email = "qa-outbound@example.test", scope = "b".repeat(64);
  const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA',$1,'duvida','Não recebi o e-mail') RETURNING id", [email])).rows[0].id;
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,token_expires_at) VALUES('QA',$1,'qa-outbound-email','qa-outbound-cpf','apoiador','QA',now(),'2030-01-01T00:00:00Z')", [email]);
  const message = async (options: { email?: string; kind?: string; channel?: string; old?: boolean; state?: string } = {}) => {
    const id = randomUUID(), attempt = randomUUID(), providerId = `QA-${id}`;
    await db.query(`INSERT INTO mail_messages(id,kind,channel,to_addr,status,content_fingerprint,content_state,content_cipher,created_at)
      VALUES($1,$2,$3,$4,'accepted','NEVER_FINGERPRINT','stored','NEVER_CIPHER',now()-$5::interval)`, [id, options.kind ?? "confirmacao", options.channel ?? "transactional", options.email ?? email, options.old ? "15 days" : "10 minutes"]);
    await db.query(`INSERT INTO mail_message_attempts(id,message_id,provider,from_addr,state,started_at,finished_at,provider_id,account_scope,error_code)
      VALUES($1,$2,'brevo','NEVER_FROM@example.test',$3,now()-interval '9 minutes',now()-interval '8 minutes',$4,$5,'NEVER_ERROR')`, [attempt, id, options.state ?? "accepted", providerId, scope]);
    return { id, attempt, providerId };
  };
  const event = async (m: Awaited<ReturnType<typeof message>>, type = "delivered", extra: Record<string,string> = {}) => {
    const M = await import("./mail/message-events");
    return M.recordMessageEvents([{ provider: "brevo", accountScope: scope, providerId: m.providerId, recipient: email, type, timestamp: new Date(Date.now() - 60_000).toISOString(), source: "webhook", ...extra }]);
  };
  const collect = async () => { const s = await E.collectEvidence(contact); assert.ok(s); return s; };
  return { db, E, J, R, S, email, scope, contact, message, event, collect };
}

test("triagem coleta somente metadados de confirmação, sem corpo, destinatário, recibo, escopo ou erro livre", async () => {
  const c = await setup();
  try {
    const m = await c.message(); await c.event(m);
    await c.message({ channel: "marketing" }); await c.message({ kind: "contato" }); await c.message({ email: "other@example.test" }); await c.message({ old: true });
    const before = (await c.db.query("SELECT row_to_json(s) data FROM signatures s UNION ALL SELECT row_to_json(m) FROM mail_messages m UNION ALL SELECT row_to_json(a) FROM mail_message_attempts a UNION ALL SELECT row_to_json(e) FROM mail_message_events e")).rows;
    const snapshot = await c.collect(), json = JSON.stringify(snapshot);
    assert.equal(snapshot.evidence.outbound?.messages.length, 1); assert.equal(snapshot.evidence.outbound?.attempts.length, 1); assert.equal(snapshot.evidence.outbound?.events.length, 1);
    for (const forbidden of ["NEVER_", c.email, c.scope, m.providerId, "qa-outbound-cpf"]) assert.ok(!json.includes(forbidden), forbidden);
    assert.deepEqual(snapshot.evidence.unavailable, []);
    assert.deepEqual((await c.db.query("SELECT row_to_json(s) data FROM signatures s UNION ALL SELECT row_to_json(m) FROM mail_messages m UNION ALL SELECT row_to_json(a) FROM mail_message_attempts a UNION ALL SELECT row_to_json(e) FROM mail_message_events e")).rows, before);
  } finally { await c.db._closeDbForTests(); }
});

test("entrega, abertura e clique não confirmam assinatura nem identificam o titular", async () => {
  const c = await setup();
  try {
    const m = await c.message();
    for (const type of ["delivered", "opened", "clicked"]) await c.event(m, type);
    const result = analyze((await c.collect()).evidence);
    assert.equal(result.state, "review");
    for (const reason of ["provider_accepted_not_delivery_proof", "message_delivery_recorded_not_signature_confirmation", "message_open_recorded_not_identity_proof", "message_click_recorded_not_identity_proof"]) assert.ok(result.reasons.includes(reason));
    assert.equal((await c.db.query("SELECT status FROM signatures")).rows[0].status, "pending");
    assert.equal((await c.db.query("SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM contact_replies")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("evento sem vínculo, de outra conta ou destinatário não é evidência da mensagem; ambiguidade desfaz vínculo", async () => {
  const c = await setup();
  try {
    const m = await c.message();
    await c.event(m, "delivered", { accountScope: "c".repeat(64) });
    await c.event(m, "opened", { recipient: "other@example.test" });
    assert.equal((await c.collect()).evidence.outbound?.events.length, 0);
    await c.event(m); assert.equal((await c.collect()).evidence.outbound?.events.length, 1);
    const other = await c.message();
    await c.db.query("UPDATE mail_message_attempts SET provider_id=$1 WHERE id=$2", [m.providerId, other.attempt]);
    await c.event(m); // Reconciles the receipt as ambiguous, rather than picking either message.
    assert.equal((await c.collect()).evidence.outbound?.events.length, 0);
    assert.ok(!analyze((await c.collect()).evidence).reasons.includes("message_delivery_recorded_not_signature_confirmation"));
  } finally { await c.db._closeDbForTests(); }
});

test("falha, transiente, incerteza e conflito de entrega continuam exigindo revisão", async () => {
  const c = await setup();
  try {
    const m = await c.message();
    for (const type of ["delivered", "hard_bounce", "soft_bounce"]) await c.event(m, type);
    await c.message({ state: "indeterminate" }); await c.message({ state: "rejected" });
    const r = analyze((await c.collect()).evidence); assert.equal(r.state, "review");
    for (const reason of ["message_failure_recorded", "message_transient_failure_recorded", "message_attempt_unresolved", "send_failure_recorded", "message_delivery_conflict_requires_review"]) assert.ok(r.reasons.includes(reason));
  } finally { await c.db._closeDbForTests(); }
});

test("evento futuro ou anterior à tentativa não comprova entrega; abertura isolada não inventa entrega", () => {
  const a = { id: "attempt", message_id: "message", provider: "brevo", state: "accepted", started_at: "2026-11-07T10:00:00Z", finished_at: "2026-11-07T10:00:01Z" };
  const e = { id: "1", message_id: "message", attempt_id: "attempt", provider: "brevo", type: "delivered", ts: "2026-11-07T12:00:00Z" };
  const evidence: OutboundEvidence = { messages: [], attempts: [a], events: [e] };
  for (const ts of ["2026-11-07T12:00:00Z", "2026-11-07T09:00:00Z", "invalid"]) {
    evidence.events = [{ ...e, ts }];
    const reasons = outboundReasons(evidence, "2026-11-07T11:00:00Z");
    assert.ok(reasons.includes("message_event_timing_or_context_inconsistent")); assert.ok(!reasons.includes("message_delivery_recorded_not_signature_confirmation"));
  }
  evidence.events = [{ ...e, ts: "2026-11-07T10:01:00Z", type: "opened" }];
  const reasons = outboundReasons(evidence, "2026-11-07T11:00:00Z");
  assert.ok(reasons.includes("message_open_recorded_not_identity_proof")); assert.ok(!reasons.includes("message_delivery_recorded_not_signature_confirmation"));
});

test("fonte ausente e limites de mensagens/tentativas/eventos tornam o diagnóstico inconclusivo", async () => {
  for (const source of ["missing", "messages", "attempts", "events"]) {
    const c = await setup();
    try {
      const m = await c.message();
      if (source === "missing") await c.db.query("DROP TABLE mail_message_attempts CASCADE");
      if (source === "messages") for (let n = 0; n < 20; n++) await c.message();
      if (source === "attempts") await c.db.query(`INSERT INTO mail_message_attempts(id,message_id,provider,from_addr,state)
        SELECT md5('qa-attempt-'||n)::uuid,$1,'brevo','qa@example.test','rejected' FROM generate_series(1,200) n`, [m.id]);
      if (source === "events") await c.db.query(`INSERT INTO mail_message_events(fingerprint,provider,account_scope,provider_id,recipient,event_type,occurred_at,source,association_state,message_id,attempt_id)
        SELECT 'qa-event-'||n,'brevo',$1,$2,$3,'opened',now()-interval '1 minute','webhook','linked',$4,$5 FROM generate_series(1,101) n`, [c.scope, m.providerId, c.email, m.id, m.attempt]);
      const snapshot = await c.collect(); assert.equal(analyze(snapshot.evidence).state, "inconclusive");
      if (source === "missing") assert.ok(snapshot.evidence.unavailable.includes("outbound"));
      else assert.ok(snapshot.evidence.truncated.includes(`outbound_${source}`));
    } finally { await c.db._closeDbForTests(); }
  }
});

test("evento vinculado atualiza revisão e invalida sugestão, preservando histórico humano e assinatura", async () => {
  const c = await setup();
  try {
    const m = await c.message(); await c.J.requestTriage(c.contact, "qa@example.test"); assert.equal((await c.J.processTriage()).status, "complete");
    const before = (await c.J.triageHistory(c.contact))!, proposal = await c.S.suggestContactReply(c.contact); assert.ok(proposal.ok);
    await c.db.query("INSERT INTO contact_replies(contact_id,versao,assunto,estado) VALUES($1,'texto','QA decisão humana','legacy')", [c.contact]);
    const untouched = (await c.db.query("SELECT row_to_json(s) data FROM signatures s UNION ALL SELECT row_to_json(r) FROM contact_replies r")).rows;
    await c.event(m); assert.equal((await c.S.validateReplySuggestion(c.contact, proposal.proof)).ok, false);
    assert.equal((await c.R.refreshTriages(2, { deadline: Date.now() + 60_000 })).queued, 1); assert.equal((await c.J.processTriage()).status, "complete");
    const after = (await c.J.triageHistory(c.contact))!; assert.equal(after.length, 2); assert.deepEqual(after[1], before[0]);
    assert.ok(after[0].analysis.reasons.includes("message_delivery_recorded_not_signature_confirmation")); assert.equal(after[0].analysis.state, "review");
    assert.equal((await c.R.refreshTriages(2, { deadline: Date.now() + 60_000 })).unchanged, 1);
    assert.deepEqual((await c.db.query("SELECT row_to_json(s) data FROM signatures s UNION ALL SELECT row_to_json(r) FROM contact_replies r")).rows, untouched);
    assert.equal((await c.db.query("SELECT 1 FROM mail_outbox")).rowCount, 0); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("revisão antiga sem nova fonte e análise desatualizada são renovadas sem apagar versões", async () => {
  const c = await setup();
  try {
    await c.J.requestTriage(c.contact, "qa@example.test"); await c.J.processTriage();
    await c.db.query("UPDATE contact_triage_jobs SET evidence=evidence-'outbound'");
    assert.equal((await c.R.refreshTriages(2, { deadline: Date.now() + 60_000 })).queued, 1); await c.J.processTriage();
    await c.db.query(`UPDATE contact_triage_jobs SET analysis=jsonb_set(analysis,'{reasons}','["outdated_context"]') WHERE revision=2`);
    assert.equal((await c.R.refreshTriages(2, { deadline: Date.now() + 60_000 })).queued, 1); await c.J.processTriage();
    const history = (await c.J.triageHistory(c.contact))!; assert.equal(history.length, 3); assert.deepEqual(history[1].analysis.reasons, ["outdated_context"]);
    assert.equal((await c.R.refreshTriages(2, { deadline: Date.now() + 60_000 })).unchanged, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("mudança efetiva de contexto temporal renova análise mesmo com metadados idênticos", async () => {
  const c = await setup();
  try {
    const m = await c.message(), future = new Date(Date.now() + 3_600_000).toISOString();
    await c.event(m, "delivered", { timestamp: future });
    await c.J.requestTriage(c.contact, "qa@example.test"); await c.J.processTriage();
    const old = (await c.J.triageHistory(c.contact))![0];
    assert.ok(old.analysis.reasons.includes("message_event_timing_or_context_inconsistent"));
    const later: typeof c.E.collectEvidence = async id => {
      const snapshot = await c.E.collectEvidence(id); assert.ok(snapshot);
      snapshot.evidence.snapshotAt = new Date(Date.parse(future) + 1000).toISOString();
      return snapshot;
    };
    const r = await c.R.refreshTriages(2, { deadline: Date.now() + 60_000, collect: later }); assert.equal(r.queued, 1);
    assert.equal((await c.J.processTriage({ collect: later })).status, "complete");
    const current = (await c.J.triageHistory(c.contact))!; assert.deepEqual(current[1], old);
    assert.ok(current[0].analysis.reasons.includes("message_delivery_recorded_not_signature_confirmation")); assert.equal(current[0].analysis.state, "review");
    assert.equal((await c.R.refreshTriages(2, { deadline: Date.now() + 60_000, collect: later })).unchanged, 1);
  } finally { await c.db._closeDbForTests(); }
});
