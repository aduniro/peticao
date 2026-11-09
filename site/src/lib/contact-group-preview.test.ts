import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
process.env.CONTACT_BCC = "qa-owner@example.test";
const TEMPLATE = { assunto: "Resposta para {nome}", corpo: "Olá {nome}, recebemos seu contato e vamos verificar os dados informados." };
async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const users = await import("./admin-users"), M = await import("./contact-group-preview");
  const created = await users.criarUsuario({ email: "qa-group@example.test", nome: "QA Operator", nivel: "total", senha: "QA-Tests-2026-Ficticia" }); assert.ok(created.ok);
  const token = (await users.abrirSessao(created.usuario.id, "127.0.0.1")).token, actor = (await users.sessaoPorToken(token))!;
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [actor.sessaoId]);
  const contacts = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('Alice Matos','qa-alice@example.test','duvida','QA Original Alice'),('Bruno Costa','qa-bruno@example.test','duvida','QA Original Bruno') RETURNING id")).rows.map(x => x.id as number);
  const input = (extra = {}) => ({ selections: contacts.map(contactId => ({ contactId })), template: TEMPLATE, ...extra });
  const snapshot = async () => (await db.query("SELECT 'contact' kind,row_to_json(c)::text raw FROM contact_messages c UNION ALL SELECT 'draft',row_to_json(d)::text FROM contact_drafts d UNION ALL SELECT 'reply',row_to_json(r)::text FROM contact_replies r UNION ALL SELECT 'signature',row_to_json(s)::text FROM signatures s UNION ALL SELECT 'queue',row_to_json(q)::text FROM mail_outbox q UNION ALL SELECT 'mail',row_to_json(m)::text FROM mail_messages m UNION ALL SELECT 'audit',row_to_json(a)::text FROM audit_log a ORDER BY kind,raw")).rows;
  return { db, users, M, actor, token, contacts, input, snapshot };
}

test("one selected template expands only name and reuses exact individual seals/copies without mail, queue, draft or audit writes", async () => {
  const c = await setup("t_contact_group_preview"); const fetch = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = (async () => { calls++; throw new Error("Network forbidden in preview"); }) as typeof fetch;
    const sig = (await c.db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status) VALUES('Alice Matos','qa-alice@example.test','QA-HASH','apoiador','QA',now(),'confirmed') RETURNING id")).rows[0].id;
    await c.db.query("INSERT INTO referrers(code,signature_id) VALUES('ABCDEFG',$1)", [sig]);
    const before = await c.snapshot(), result = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(result.ok); assert.equal(result.automaticSend, false); assert.equal(result.groupReserved, false); assert.deepEqual(result.ownerCopies, ["qa-owner@example.test"]);
    assert.equal(result.recipients.length, 2);
    const individual = await import("./contact-replies");
    for (const row of result.recipients) {
      assert.ok(row.preview); assert.ok("expandedInput" in row && row.expandedInput); assert.equal(row.preview.selo, (await individual.montarPrevia(row.contactId, row.expandedInput, 1))!.selo);
      assert.ok(!row.preview.texto.texto.includes("{nome}")); assert.equal("html" in row.preview, false); assert.equal("card" in row.preview, false);
    }
    assert.ok(result.recipients[0].preview!.cardPlanned); assert.equal(result.recipients[1].preview!.cardPlanned, false);
    const repeated = await c.M.prepareContactGroupPreview(c.input({ expectedProof: result.proof }), c.actor); assert.ok(repeated.ok); assert.equal(repeated.proof, result.proof);
    const reordered = await c.M.prepareContactGroupPreview(c.input({ selections: [...c.contacts].reverse().map(contactId => ({ newRound: false, contactId })), expectedProof: result.proof }), c.actor); assert.ok(reordered.ok); assert.equal(reordered.proof, result.proof);
    assert.deepEqual(await c.snapshot(), before); assert.equal(calls, 0);
  } finally { globalThis.fetch = fetch; await c.db._closeDbForTests(); }
});

test("the preparation proof binds its authenticated owner and configured copy without allowing a missing owner copy", async () => {
  const c = await setup("t_contact_group_owner"); const owner = process.env.CONTACT_BCC;
  try {
    const first = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(first.ok);
    process.env.CONTACT_BCC = "qa-other-owner@example.test";
    assert.deepEqual(await c.M.prepareContactGroupPreview(c.input({ expectedProof: first.proof }), c.actor), { ok: false, error: "conflict" });
    process.env.CONTACT_BCC = "";
    const blocked = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(blocked.ok); assert.ok(blocked.recipients.every(r => r.issues.includes("owner_copy_unavailable") && !r.preview));
    process.env.CONTACT_BCC = owner;
    const second = await c.users.criarUsuario({ email: "qa-second-owner@example.test", nome: "QA Second", nivel: "total", senha: "QA-Tests-2026-Ficticia" }); assert.ok(second.ok);
    const token = (await c.users.abrirSessao(second.usuario.id, "127.0.0.1")).token, actor = (await c.users.sessaoPorToken(token))!;
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [actor.sessaoId]);
    assert.deepEqual(await c.M.prepareContactGroupPreview(c.input({ expectedProof: first.proof }), actor), { ok: false, error: "conflict" });
  } finally { process.env.CONTACT_BCC = owner; await c.db._closeDbForTests(); }
});

test("selection, template, actor, source, draft and reply revisions invalidate an expected group preview", async () => {
  const c = await setup("t_contact_group_revisions");
  try {
    const first = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(first.ok);
    assert.deepEqual(await c.M.prepareContactGroupPreview(c.input({ selections: [{ contactId: c.contacts[0] }], expectedProof: first.proof }), c.actor), { ok: false, error: "conflict" });
    assert.deepEqual(await c.M.prepareContactGroupPreview(c.input({ template: { ...TEMPLATE, corpo: TEMPLATE.corpo + " QA Change" }, expectedProof: first.proof }), c.actor), { ok: false, error: "conflict" });
    await c.db.query("UPDATE contact_messages SET name='Alice Novo' WHERE id=$1", [c.contacts[0]]);
    assert.deepEqual(await c.M.prepareContactGroupPreview(c.input({ expectedProof: first.proof }), c.actor), { ok: false, error: "conflict" });
    const latest = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(latest.ok);
    const drafts = await import("./contact-drafts"); await drafts.writeContactDraft(c.contacts[0], 0, { assunto: "QA Existing draft", corpo: "QA Existing draft preserved" }, c.actor);
    assert.deepEqual(await c.M.prepareContactGroupPreview(c.input({ expectedProof: latest.proof }), c.actor), { ok: false, error: "conflict" });
    const selection = await c.M.prepareContactGroupPreview(c.input({ selections: [{ contactId: c.contacts[0], expectedDraftRevision: 0 }] }), c.actor); assert.ok(selection.ok); assert.ok(selection.recipients[0].issues.includes("draft_conflict")); assert.equal(selection.recipients[0].preview, null);
    const again = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(again.ok);
    await c.db.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto,estado,ok) VALUES($1,1,'texto','qa@example.test','QA Prior','accepted',true)", [c.contacts[0]]);
    assert.deepEqual(await c.M.prepareContactGroupPreview(c.input({ expectedProof: again.proof }), c.actor), { ok: false, error: "conflict" });
  } finally { await c.db._closeDbForTests(); }
});

test("duplicates, suppressions, unknown contacts and uncertain history remain visible without choosing or repeating a recipient", async () => {
  const c = await setup("t_contact_group_blocked");
  try {
    await c.db.query("UPDATE contact_messages SET email='qa-alice@example.test' WHERE id=$1", [c.contacts[1]]);
    let result = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(result.ok); assert.ok(result.recipients.every(r => r.issues.includes("duplicate_recipient") && !r.preview));
    await c.db.query("UPDATE contact_messages SET email='qa-bruno@example.test' WHERE id=$1", [c.contacts[1]]);
    await c.db.query("INSERT INTO email_suppressions(email,reason) VALUES('qa-alice@example.test','bounce')");
    await c.db.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto,estado) VALUES($1,1,'texto','qa@example.test','QA Uncertain','uncertain')", [c.contacts[1]]);
    result = await c.M.prepareContactGroupPreview(c.input({ selections: [{ contactId: c.contacts[0] }, { contactId: c.contacts[1], newRound: true, expectedReplyRound: 1 }, { contactId: 2147483647 }] }), c.actor); assert.ok(result.ok);
    assert.ok(result.recipients[0].issues.includes("suppressed")); assert.ok(result.recipients[1].issues.includes("history_needs_review")); assert.ok(result.recipients[2].issues.includes("not_found")); assert.ok(result.recipients.every(r => r.preview === null));
  } finally { await c.db._closeDbForTests(); }
});

test("a prior accepted response needs explicit new-round intention with matching revision; no round is created by preview", async () => {
  const c = await setup("t_contact_group_new_round");
  try {
    await c.db.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto,estado,ok) VALUES($1,1,'texto','qa@example.test','QA Prior','accepted',true)", [c.contacts[0]]);
    const blocked = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(blocked.ok); assert.ok(blocked.recipients[0].issues.includes("explicit_new_round_required"));
    const before = await c.snapshot();
    const next = await c.M.prepareContactGroupPreview(c.input({ selections: [{ contactId: c.contacts[0], expectedReplyRound: 1, newRound: true }] }), c.actor); assert.ok(next.ok); assert.ok(next.recipients[0].preview); assert.ok("nextReplyRound" in next.recipients[0]); assert.equal(next.recipients[0].nextReplyRound, 2);
    assert.deepEqual(await c.snapshot(), before);
  } finally { await c.db._closeDbForTests(); }
});

test("Total identity and current stepup/session are mandatory even for preparation", async () => {
  const c = await setup("t_contact_group_authorization");
  try {
    assert.deepEqual(await c.M.prepareContactGroupPreview(c.input(), { ...c.actor, email: "other@example.test" }), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]); assert.deepEqual(await c.M.prepareContactGroupPreview(c.input(), c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [c.actor.sessaoId]); await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.prepareContactGroupPreview(c.input(), c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET nivel='total',ativo=false WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.prepareContactGroupPreview(c.input(), c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=$1", [c.actor.userId]); await c.users.encerrarSessao(c.token); assert.deepEqual(await c.M.prepareContactGroupPreview(c.input(), c.actor), { ok: false, error: "forbidden" });
  } finally { await c.db._closeDbForTests(); }
});

test("bounded explicit selection and rendered size cannot silently truncate data or accept arbitrary sending fields", async () => {
  const c = await setup("t_contact_group_input");
  try {
    for (const input of [c.input({ selections: [] }), c.input({ selections: Array.from({ length: 21 }, (_, i) => ({ contactId: i + 1 })) }), c.input({ selections: [{ contactId: 1 }, { contactId: 1 }] }), c.input({ enviar: true }), c.input({ template: { ...TEMPLATE, corpo: "x".repeat(5001) } })]) assert.deepEqual(await c.M.prepareContactGroupPreview(input, c.actor), { ok: false, error: "parameters" });
    await c.db.query("UPDATE contact_messages SET name=$2 WHERE id=$1", [c.contacts[0], "a".repeat(160)]);
    const result = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(result.ok); assert.ok(result.recipients[0].issues.includes("rendered_input_invalid")); assert.equal(result.recipients[0].preview, null);
    await c.db.query("UPDATE contact_messages SET message=$2 WHERE id=$1", [c.contacts[1], "x".repeat(4001)]);
    const large = await c.M.prepareContactGroupPreview(c.input(), c.actor); assert.ok(large.ok); assert.ok(large.recipients[1].issues.includes("source_context_truncated"));
  } finally { await c.db._closeDbForTests(); }
});

test("HTTP preserves origin/stepup/body limits and reports stale group proof as 409", async () => {
  const c = await setup("t_contact_group_http");
  try {
    const { NextRequest } = await import("next/server"), { POST } = await import("../app/api/admin/contato/grupo/previa/route");
    const request = (body: unknown, auth = true, origin = "http://localhost") => new NextRequest("http://localhost/api/admin/contato/grupo/previa", { method: "POST", headers: { host: "localhost", origin, cookie: auth ? `adm=${c.token}` : "", "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await POST(request(c.input(), false))).status, 401); assert.equal((await POST(request(c.input(), true, "http://other.test"))).status, 403);
    assert.equal((await POST(request(c.input({ template: { ...TEMPLATE, corpo: "x".repeat(33000) } })))).status, 413);
    const first = await POST(request(c.input())); assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "no-store"); const content = await first.json();
    await c.db.query("UPDATE contact_messages SET message='QA Changed' WHERE id=$1", [c.contacts[0]]);
    assert.equal((await POST(request(c.input({ expectedProof: content.proof })))).status, 409);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]); assert.equal((await POST(request(c.input()))).status, 403);
  } finally { await c.db._closeDbForTests(); }
});
