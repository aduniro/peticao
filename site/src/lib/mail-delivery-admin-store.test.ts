import test, { mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
const stamp = "2026-11-10T12:00:00.123456Z";
async function setup(schema: string) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.ok(["54375", "54381"].includes(url.port));
  assert.equal(url.pathname, "/peticao"); assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
  const db = await import("@/lib/db"); await db._openForTests(schema);
  const U = await import("@/lib/admin-users"), S = await import("./mail-delivery-admin-store"), C = await import("./mail-delivery-admin-contract");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-delivery-edit@example.test','QA Editor','edicao','QA-NOT-LOGIN'),(2,'qa-delivery-read@example.test','QA Reader','leitura','QA-NOT-LOGIN')");
  const edit = await U.abrirSessao(1, "127.0.0.1"), read = await U.abrirSessao(2, "127.0.0.1"), actor = (await U.sessaoPorToken(edit.token))!, reader = (await U.sessaoPorToken(read.token))!;
  const options = (q = "") => { const p = C.mailDeliverySearch(new URLSearchParams(q)); assert.ok(p.ok); return p.options; };
  return { db, U, S, C, edit, read, actor, reader, options };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function seed(c: Fixture, n: number) {
  await c.db.query("INSERT INTO signatures(name,email,email_hash,category,institution,role,campus,city,uf,text_version,consent_at,created_at,status)SELECT CASE WHEN i=1 THEN 'José QA' ELSE 'QA Delivery '||i END,'qa'||i||'@example.test','QA-DELIVERY-'||i,'servidor','UNIR','docente','Porto Velho','Porto Velho','RO','QA',$2,$2,'pending' FROM generate_series(1,$1::int)i", [n, stamp]);
}
async function state(c: Fixture) {
  const result: Record<string, unknown> = {};
  for (const table of ["signatures", "mail_log", "mail_messages", "mail_message_attempts", "mail_message_events", "mail_events", "mail_engagement", "mail_outbox"]) {
    result[table] = (await c.db.query(`SELECT count(*)::text n,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) checksum FROM ${table} t`)).rows[0];
  }
  return result;
}

test("delivery inventory retains registration IDs sharing one email and explicit orphan addresses; provider filter scopes every signal", async () => {
  const c = await setup("t_delivery_scope"); let network = 0;
  const fetchMock = mock.method(globalThis, "fetch", async () => { network++; throw new Error("QA network forbidden"); });
  const dnsMock = mock.method(dns, "resolveMx", async () => { network++; throw new Error("QA DNS forbidden"); });
  try {
    await seed(c, 3);
    await c.db.query("UPDATE signatures SET email='qa1@example.test',status='confirmed',confirmed_at=$1 WHERE id=2", [stamp]);
    await c.db.query("INSERT INTO mail_log(ts,kind,provider,to_addr,status)VALUES('2026-11-06T12:00:00Z','confirmacao','brevo','qa1@example.test','sent'),('2026-11-07T12:00:00Z','contato','failed-only','failed-only@example.test','failed')");
    await c.db.query("INSERT INTO mail_engagement(provider,email,opened_at,clicked_at)VALUES('brevo','qa1@example.test','2026-11-07T12:00:00Z','2026-11-08T12:00:00Z')");
    await c.db.query("INSERT INTO mail_events(ts,provider,type,email,reason)VALUES('2026-11-09T12:00:00Z','ses','hard_bounce','qa1@example.test','QA adverse after click')");
    await c.db.query("INSERT INTO mail_message_events(fingerprint,provider,account_scope,provider_id,recipient,event_type,occurred_at,source)VALUES('QA-DELIVERY-EVENT','event-only',$1,'QA-ID','orphan@example.test','delivered','2026-11-08T12:00:00.123456Z','webhook')", ["a".repeat(64)]);
    await c.db.query("INSERT INTO mail_messages(id,kind,channel,to_addr,status,content_fingerprint,content_state)VALUES('00000000-0000-4000-8000-000000000001','contato','transactional','prepared-orphan@example.test','prepared',$1,'unavailable')", ["b".repeat(64)]);
    await c.db.query("INSERT INTO mail_messages(id,kind,channel,to_addr,status,content_fingerprint,content_state)VALUES('00000000-0000-4000-8000-000000000002','contato','transactional','qa3@example.test','accepted',$1,'unavailable')", ["c".repeat(64)]);
    await c.db.query("INSERT INTO mail_message_attempts(id,message_id,provider,from_addr,state,finished_at)VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','journal-only','qa@example.test','accepted','2026-11-09T13:00:00.654321Z')");
    const before = await state(c), all = await c.S.readMailDeliveryPage(c.actor, c.options()); assert.ok(all.ok);
    assert.equal(all.unit, "registration_or_unregistered_address"); assert.equal(all.total, 6);
    assert.deepEqual(all.inventory, { records: 6, registrations: 3, pending: 2, confirmed: 1, unregisteredAddresses: 3 });
    const repeated = all.linhas.filter(r => r.email === "qa1@example.test"); assert.equal(repeated.length, 2); assert.deepEqual(new Set(repeated.map(r => r.recordKey)), new Set(["registration:1", "registration:2"]));
    assert.ok(repeated.every(r => r.situacao === "devolvido" && r.evidence.registrationLink === "email_only" && r.evidence.relationToCurrentConfirmation === "not_proven"));
    assert.ok(repeated.every(r => r.cadastradoEm === stamp && r.clicouEm === "2026-11-08T12:00:00.000000Z"));
    assert.equal(all.linhas.find(r => r.cadastroId === 2)!.confirmadoEm, stamp); assert.equal(all.linhas.find(r => r.cadastroId === 3)!.situacao, "aceito");
    const journal = all.linhas.find(r => r.cadastroId === 3)!; assert.equal(journal.envios, 0); assert.equal(journal.evidence.acceptedJournalAttempts, 1); assert.equal(journal.ultimoTipo, "contato"); assert.equal(journal.ultimoEnvio, "2026-11-09T13:00:00.654321Z");
    const journalOnly = await c.S.readMailDeliveryPage(c.actor, c.options("provedor=journal-only")); assert.ok(journalOnly.ok); assert.equal(journalOnly.total, 1); assert.equal(journalOnly.linhas[0].cadastroId, 3);
    const orphan = all.linhas.find(r => r.email === "orphan@example.test")!; assert.equal(orphan.cadastroId, null); assert.equal(orphan.rowKind, "unregistered_address"); assert.equal(orphan.nome, ""); assert.equal(orphan.situacao, "entregue");
    const ses = await c.S.readMailDeliveryPage(c.actor, c.options("provedor=ses")); assert.ok(ses.ok); assert.equal(ses.total, 2);
    assert.ok(ses.linhas.every(r => r.provedores === "ses" && r.abertoEm === "" && r.clicouEm === "" && r.envios === 0 && r.situacao === "devolvido" && r.evidence.providersAll.includes("brevo")));
    const eventOnly = await c.S.readMailDeliveryPage(c.actor, c.options("provedor=event-only")); assert.ok(eventOnly.ok); assert.equal(eventOnly.total, 1); assert.equal(eventOnly.linhas[0].email, "orphan@example.test");
    const noRegistration = await c.S.readMailDeliveryPage(c.actor, c.options("cadastro=sem")); assert.ok(noRegistration.ok); assert.equal(noRegistration.total, 3); assert.ok(noRegistration.linhas.every(r => r.cadastroId === null));
    const confirmed = await c.S.readMailDeliveryPage(c.actor, c.options("cadastro=confirmado")); assert.ok(confirmed.ok); assert.equal(confirmed.total, 1); assert.equal(confirmed.linhas[0].cadastroId, 2);
    const jose = await c.S.readMailDeliveryPage(c.actor, c.options("busca=Jose")); assert.ok(jose.ok); assert.equal(jose.linhas[0].cadastroId, 1);
    const pending = await (await import("@/lib/pending-email-admin-store")).readPendingEmailPage(c.actor); assert.ok(pending.ok);
    assert.equal(pending.rows.find(r => r.id === 1)!.state, "adverse"); assert.equal(pending.rows.find(r => r.id === 1)!.evidence.lastSignal!.provider, repeated[0].evidence.lastSignal!.provider);
    assert.equal(network, 0); assert.deepEqual(await state(c), before);
  } finally { fetchMock.mock.restore(); dnsMock.mock.restore(); await c.db._closeDbForTests(); }
});

test("delivery page beyond range retains total, full CSV includes50001 records and source state remains unchanged", async () => {
  const c = await setup("t_delivery_full"); try {
    await seed(c, 50001); const before = await state(c);
    const page = await c.S.readMailDeliveryPage(c.actor, c.options("pagina=251&limite=200")); assert.ok(page.ok); assert.equal(page.total, 50001); assert.equal(page.linhas.length, 1); assert.equal(page.summary.pending, 50001);
    const empty = await c.S.readMailDeliveryPage(c.actor, c.options("pagina=252&limite=200")); assert.ok(empty.ok); assert.equal(empty.total, 50001); assert.equal(empty.linhas.length, 0); assert.equal(empty.coverage.matched, 50001);
    const source = await c.S.readMailDeliveryExport(c.actor); assert.ok(source.ok); assert.equal(source.total, 50001); assert.equal(new Set(source.rows.map(r => r.recordKey)).size, 50001); assert.ok(source.rows.some(r => r.cadastroId === 50001));
    const { buildMailDeliveryCsv, MAIL_DELIVERY_CSV_HEADERS } = await import("./mail-delivery-csv"), file = buildMailDeliveryCsv(source.rows, source.total);
    assert.equal(MAIL_DELIVERY_CSV_HEADERS.length, 24); assert.equal(file.rows, 50001); assert.ok(file.body.toString("utf8").includes("qa50001@example.test")); assert.equal(file.bytes, file.body.length);
    assert.deepEqual(await state(c), before);
  } finally { await c.db._closeDbForTests(); }
});

test("delivery contact requires opt-in and Edição; failed decryption is explicit and prevents a misleading CSV", async () => {
  const c = await setup("t_delivery_contacts"); try {
    await seed(c, 3); const { cifrar } = await import("@/lib/crypto-dados");
    await c.db.query("UPDATE signatures SET wa_cipher=$1,wa_optin_at=now() WHERE id=1", [cifrar("+5569999990000", "wa:1")]);
    await c.db.query("UPDATE signatures SET wa_cipher=$1 WHERE id=2", [cifrar("+5569999990001", "wa:2")]);
    await c.db.query("UPDATE signatures SET wa_cipher='QA-invalid-cipher',wa_optin_at=now() WHERE id=3"); const before = await state(c);
    const result = await c.S.readMailDeliveryPage(c.actor); assert.ok(result.ok); const by = new Map(result.linhas.map(r => [r.cadastroId, r]));
    assert.equal(by.get(1)!.evidence.contactState, "available"); assert.equal(by.get(1)!.whatsapp, "+5569999990000");
    assert.equal(by.get(2)!.evidence.contactState, "withheld_no_opt_in"); assert.equal(by.get(2)!.whatsapp, "");
    assert.equal(by.get(3)!.evidence.contactState, "unavailable"); assert.equal(by.get(3)!.whatsapp, "");
    assert.deepEqual(await c.S.readMailDeliveryExport(c.actor), { ok: false, error: "unavailable" });
    assert.deepEqual(await c.S.readMailDeliveryPage(c.reader), { ok: false, error: "forbidden" });
    for (const actor of [{ ...c.actor, email: "wrong@example.test" }, { ...c.actor, sessaoId: null }, { ...c.actor, sessaoId: c.reader.sessaoId }]) assert.deepEqual(await c.S.readMailDeliveryPage(actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=1"); assert.deepEqual(await c.S.readMailDeliveryPage(c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=1"); await c.U.encerrarSessao(c.edit.token); assert.deepEqual(await c.S.readMailDeliveryExport(c.actor), { ok: false, error: "forbidden" });
    assert.deepEqual(await state(c), before);
  } finally { await c.db._closeDbForTests(); }
});

test("delivery inventory, matched count and rows share one RR snapshot during a concurrent insert", async () => {
  const c = await setup("t_delivery_rr"), blocker = await c.db.getPool().connect(); try {
    await seed(c, 1); await blocker.query("BEGIN"); await blocker.query("LOCK TABLE signatures IN ACCESS EXCLUSIVE MODE");
    const pending = c.S.readMailDeliveryPage(c.actor); let waiting = false;
    for (let i = 0; i < 80; i++) { waiting = !!(await c.db.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE $1", ["WITH registrations AS (%"])) .rowCount; if (waiting) break; await new Promise(r => setTimeout(r, 5)); }
    assert.ok(waiting, "source read waits after successful current account/session authorization");
    await blocker.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,created_at,status)VALUES('QA Concurrent','concurrent@example.test','QA-DELIVERY-NEW','apoiador','QA',$1,$1,'pending')", [stamp]); await blocker.query("COMMIT");
    const first = await pending; assert.ok(first.ok); assert.equal(first.inventory.records, 1); assert.equal(first.total, 1); assert.equal(first.linhas.length, 1);
    const fresh = await c.S.readMailDeliveryPage(c.actor); assert.ok(fresh.ok); assert.equal(fresh.total, 2); assert.equal(fresh.inventory.pending, 2);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); blocker.release(); await c.db._closeDbForTests(); }
});

test("delivery export final audit is actor-scoped, excludes search/email and rolls back on audit failure", async () => {
  const c = await setup("t_delivery_audit"); try {
    await seed(c, 1); const source = await c.S.readMailDeliveryExport(c.actor); assert.ok(source.ok);
    const { buildMailDeliveryCsv } = await import("./mail-delivery-csv"), file = buildMailDeliveryCsv(source.rows, source.total), data = { rows: file.rows, bytes: file.bytes, sha256: file.sha256, asOf: source.asOf };
    assert.equal(await c.S.auditMailDeliveryExport(c.actor, data), true);
    const entry = (await c.db.query("SELECT data FROM audit_log WHERE event='export_entregas' ORDER BY id DESC LIMIT 1")).rows[0]; const value = JSON.parse(entry.data);
    assert.equal(value.rows, 1); assert.equal(value.unit, "registration_or_unregistered_address"); assert.equal(value.actorId, c.actor.userId); assert.equal(value.meaning, "file_prepared_not_delivery"); assert.equal(JSON.stringify(value).includes("@"), false);
    const previous = Number((await c.db.query("SELECT count(*)::text n FROM audit_log WHERE event='export_entregas'")).rows[0].n);
    await c.db.query("CREATE FUNCTION qa_delivery_audit_fail()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event='export_entregas' THEN RAISE EXCEPTION 'QA audit failure';END IF;RETURN NEW;END$$;CREATE TRIGGER qa_delivery_audit_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_delivery_audit_fail()");
    assert.equal(await c.S.auditMailDeliveryExport(c.actor, data), false); assert.equal(Number((await c.db.query("SELECT count(*)::text n FROM audit_log WHERE event='export_entregas'")).rows[0].n), previous); assert.ok((await c.db.verifyAuditChain()).ok);
    assert.deepEqual(await c.S.readMailDeliveryPage(c.actor, { extra: true } as never), { ok: false, error: "invalid" });
  } finally { await c.db._closeDbForTests(); }
});


test("delivery session expiry during an authorized source wait prevents both page and export release", async () => {
  const c = await setup("t_delivery_expiry_read"), blocker = await c.db.getPool().connect();
  try {
    await seed(c, 1); const before = await state(c);
    for (const mode of ["page", "export"]) {
      await c.db.query("UPDATE admin_sessions SET expira_em=clock_timestamp()+interval '500 milliseconds' WHERE id=$1", [c.actor.sessaoId]);
      await blocker.query("BEGIN"); await blocker.query("LOCK TABLE signatures IN ACCESS EXCLUSIVE MODE");
      const pending = mode === "page" ? c.S.readMailDeliveryPage(c.actor) : c.S.readMailDeliveryExport(c.actor);
      let active = false;
      for (let i = 0; i < 80; i++) {
        active = !!(await c.db.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE $1", ["WITH registrations AS (%"])) .rowCount;
        if (active) break; await new Promise(r => setTimeout(r, 5));
      }
      assert.ok(active, "the real source query started after successful account/session authorization");
      assert.equal((await blocker.query("SELECT expira_em>clock_timestamp() valid FROM admin_sessions WHERE id=$1", [c.actor.sessaoId])).rows[0].valid, true, "expiry initially remains in the future");
      await new Promise(r => setTimeout(r, 750));
      assert.equal((await blocker.query("SELECT expira_em>clock_timestamp() valid FROM admin_sessions WHERE id=$1", [c.actor.sessaoId])).rows[0].valid, false, "session expired during source-table wait");
      await blocker.query("COMMIT"); assert.deepEqual(await pending, { ok: false, error: "forbidden" });
    }
    assert.deepEqual(await state(c), before);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); blocker.release(); await c.db._closeDbForTests(); }
});
