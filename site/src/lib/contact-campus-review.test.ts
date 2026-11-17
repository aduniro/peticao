import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCampusProposal, type ReviewInput } from "./contact-triage/campus-review";
import { categoryOf, redact } from "./contact-triage/analyze";
(process.env as Record<string,string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

const proposal = () => ({ institution: "unir", cityIbge: 1200401, campusName: "Campus Fictício de Rio Branco", sourceUrl: "https://www.unir.br/qa-campus-ficticio" });
async function setup() {
  const db = await import("./db"); await db._openForTests("t_campus_review");
  const J = await import("./contact-triage/jobs"), C = await import("./contact-triage/campus-review"), U = await import("./admin-users");
  const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA','qa-campus@example.test','duvida','Não achei meu campus; NEVER_COPY_BODY 123.456.789-09') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at) VALUES('QA','qa-campus@example.test','QA-EMAIL','QA-CPF','apoiador','QA',now())");
  await J.requestTriage(contact, "qa@example.test"); assert.equal((await J.processTriage()).status, "complete");
  const actor = async (nivel: "edicao" | "total" | "leitura", suffix = "") => {
    const r = await U.criarUsuario({ email: `qa-campus-${nivel}${suffix}@example.test`, nome: "QA Campus", nivel, senha: "QA-Campus-Review-2026-Ficticia" }); assert.ok(r.ok);
    return { userId: r.usuario.id, email: r.usuario.email };
  };
  const total = await actor("total");
  const input = (): ReviewInput => ({ contato: contact, proposal: proposal(), decision: "approved", sourceReviewed: true, expectedDecisionId: null });
  return { db, J, C, U, actor, total, contact, input };
}
const untouched = async (db: Awaited<ReturnType<typeof setup>>["db"]) => (await db.query("SELECT row_to_json(s) data FROM signatures s UNION ALL SELECT row_to_json(r) FROM contact_replies r UNION ALL SELECT row_to_json(o) FROM mail_outbox o UNION ALL SELECT row_to_json(t) FROM contact_triage_jobs t")).rows;

test("proposta de campus exige IFES/município conhecidos e URL de referência sem buscar ou alegar que é oficial", () => {
  const p = normalizeCampusProposal(proposal()); assert.ok(p); assert.equal(p.institution, "UNIR"); assert.equal(p.municipality.uf, "AC"); assert.equal(p.listedMunicipality, false);
  for (const patch of [{ institution: "desconhecida" }, { cityIbge: 1 }, { campusName: "<script>" }, { campusName: "a\nb" }, { sourceUrl: "javascript:alert(1)" }, { sourceUrl: "https://user:secret@unir.br/" }, { sourceUrl: "http://unir.br/" }, { sourceUrl: "https://127.0.0.1/" }, { sourceUrl: "https://host.local/" }, { sourceUrl: "https://unir.br/?token=secret" }, { sourceUrl: "https://unir.br/#secret" }, { unknown: true }]) assert.equal(normalizeCampusProposal({ ...proposal(), ...patch }), null);
});

test("marcadores de ocultação não transformam pedido de campus em problema de CPF", () => {
  assert.equal(categoryOf(redact("Não achei meu campus; 123.456.789-09 a@example.test")), "campus");
  assert.equal(categoryOf(redact("Meu CPF não confere: 123.456.789-09")), "cpf");
});

test("prévia é somente leitura e não copia relato, CPF ou segredos para a decisão", async () => {
  const c = await setup(); try {
    const before = (await c.db.query("SELECT row_to_json(a) data FROM audit_log a UNION ALL SELECT row_to_json(r) FROM contact_campus_reviews r")).rows;
    const p = await c.C.previewCampusReview(c.input(), c.total); assert.ok(p.ok); assert.equal(p.published, false); assert.equal(p.requiresHumanReview, true); assert.match(p.proof, /^[a-f0-9]{64}$/);
    assert.deepEqual((await c.db.query("SELECT row_to_json(a) data FROM audit_log a UNION ALL SELECT row_to_json(r) FROM contact_campus_reviews r")).rows, before);
    for (const hidden of ["NEVER_COPY_BODY", "123.456.789-09", "QA-CPF", "input_hash", "qa-campus@example.test"]) assert.ok(!JSON.stringify(p).includes(hidden));
    const missing = await c.C.previewCampusReview({ ...c.input(), sourceReviewed: false }, c.total); assert.ok(!missing.ok); assert.equal(missing.error, "parameters");
  } finally { await c.db._closeDbForTests(); }
});

test("decisão é atômica, idempotente, versionada e não publica campus nem altera assinaturas", async () => {
  const c = await setup(); try {
    const publicBefore = readFileSync(join(__dirname, "../../public/data/ifes.json"));
    const before = await untouched(c.db), input = c.input(), p = await c.C.previewCampusReview(input, c.total); assert.ok(p.ok);
    const first = await c.C.recordCampusReview(input, p.proof, c.total); assert.ok(first.ok); assert.equal(first.existing, false); assert.equal(first.published, false);
    const again = await c.C.recordCampusReview(input, p.proof, c.total); assert.ok(again.ok); assert.equal(again.id, first.id); assert.equal(again.existing, true);
    const old = (await c.C.campusReviewHistory(c.contact)); assert.ok(old.ok); assert.equal(old.records.length, 1);
    const revised = { ...input, decision: "rejected" as const, sourceReviewed: false, expectedDecisionId: first.id };
    const next = await c.C.previewCampusReview(revised, c.total); assert.ok(next.ok);
    const second = await c.C.recordCampusReview(revised, next.proof, c.total); assert.ok(second.ok); assert.equal(second.revision, 2);
    const history = await c.C.campusReviewHistory(c.contact); assert.ok(history.ok); assert.deepEqual(history.records[1], old.records[0]); assert.equal(history.records[0].previous_id, first.id);
    assert.ok(!(await c.C.recordCampusReview(input, p.proof, c.total)).ok, "Old intent must not revive after another decision");
    assert.ok(!JSON.stringify(history).includes("intent_hash")); assert.deepEqual(await untouched(c.db), before); assert.deepEqual(readFileSync(join(__dirname, "../../public/data/ifes.json")), publicBefore);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("prova vincula proposta, decisão, revisor e versão; dados alterados ou reanálise invalidam intenção", async () => {
  const c = await setup(); try {
    const input = c.input(), p = await c.C.previewCampusReview(input, c.total); assert.ok(p.ok);
    for (const changed of [{ ...input, decision: "rejected" }, { ...input, proposal: { ...input.proposal, campusName: "Outro Campus" } }, { ...input, expectedDecisionId: 123 }]) assert.ok(!(await c.C.recordCampusReview(changed, p.proof, c.total)).ok);
    const other = await c.actor("total", "-other"); assert.ok(!(await c.C.recordCampusReview(input, p.proof, other)).ok);
    await c.db.query("UPDATE contact_messages SET message=message||' atualizado' WHERE id=$1", [c.contact]); assert.ok(!(await c.C.recordCampusReview(input, p.proof, c.total)).ok);
    await c.J.requestTriage(c.contact, "qa@example.test"); assert.ok(!(await c.C.recordCampusReview(input, p.proof, c.total)).ok); await c.J.processTriage();
    assert.ok(!(await c.C.recordCampusReview(input, p.proof, c.total)).ok); assert.equal((await c.db.query("SELECT 1 FROM contact_campus_reviews")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("revisores concorrentes não sobrescrevem decisão; falha de auditoria reverte a inserção", async () => {
  const c = await setup(); try {
    const a = c.input(), b = { ...a, decision: "rejected" as const, sourceReviewed: false };
    const pa = await c.C.previewCampusReview(a, c.total), pb = await c.C.previewCampusReview(b, c.total); assert.ok(pa.ok && pb.ok);
    await c.db.query("CREATE FUNCTION fail_campus_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contact_campus_review_recorded' THEN RAISE EXCEPTION 'QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_campus_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_campus_audit()");
    await assert.rejects(c.C.recordCampusReview(a, pa.proof, c.total)); assert.equal((await c.db.query("SELECT 1 FROM contact_campus_reviews")).rowCount, 0);
    await c.db.query("DROP TRIGGER fail_campus_audit ON audit_log");
    const results = await Promise.all([c.C.recordCampusReview(a, pa.proof, c.total), c.C.recordCampusReview(b, pb.proof, c.total)]); assert.equal(results.filter(r => r.ok).length, 1); assert.equal((await c.db.query("SELECT 1 FROM contact_campus_reviews")).rowCount, 1); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("permissão permanente e vínculo da conta são rechecados; categoria/motor diferentes não aceitam curadoria", async () => {
  const c = await setup(); try {
    const input = c.input(), editor = await c.actor("edicao"), pe = await c.C.previewCampusReview(input, editor); assert.ok(pe.ok); assert.ok(!(await c.C.recordCampusReview(input, pe.proof, editor)).ok);
    const p = await c.C.previewCampusReview(input, c.total); assert.ok(p.ok);
    assert.ok(!(await c.C.recordCampusReview(input, p.proof, { ...c.total, email: "forged@example.test" })).ok);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.total.userId]); assert.ok(!(await c.C.recordCampusReview(input, p.proof, c.total)).ok);
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=$1", [c.total.userId]); await c.db.query("UPDATE contact_triage_jobs SET engine='future'"); assert.ok(!(await c.C.previewCampusReview(input, c.total)).ok);
    await c.db.query("UPDATE contact_triage_jobs SET engine='contact-triage-v1',analysis=jsonb_set(analysis,'{category}','\"cpf\"')"); assert.ok(!(await c.C.previewCampusReview(input, c.total)).ok);
    assert.equal((await c.db.query("SELECT 1 FROM contact_campus_reviews")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("API exige Edição para ler/prever e Total com confirmação extra para registrar", async () => {
  const c = await setup(), old = { preview: process.env.PREVIEW_MODE, noPassword: process.env.ADMIN_NO_PASSWORD }; delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
  try {
    const { NextRequest } = await import("next/server"), { GET, POST } = await import("../app/api/admin/contato/campus/route");
    const request = (method: string, token = "", body?: unknown, origin = "http://localhost") => new NextRequest(`http://localhost/api/admin/contato/campus?contato=${c.contact}`, { method, headers: { host: "localhost", origin, cookie: `adm=${token}`, "content-type": "application/json" }, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
    assert.equal((await GET(request("GET"))).status, 401); assert.equal((await POST(request("POST", "", {}))).status, 401);
    const reader = await c.actor("leitura"), readerToken = (await c.U.abrirSessao(reader.userId, "127.0.0.1")).token; assert.equal((await GET(request("GET", readerToken))).status, 403);
    const editor = await c.actor("edicao"), editorToken = (await c.U.abrirSessao(editor.userId, "127.0.0.1")).token;
    assert.equal((await GET(request("GET", editorToken))).status, 200);
    const preview = { modo: "preview", input: c.input() };
    assert.equal((await POST(request("POST", editorToken, preview))).status, 200);
    assert.equal((await POST(request("POST", editorToken, { modo: "record", input: c.input(), proof: "a".repeat(64) }))).status, 403);
    const token = (await c.U.abrirSessao(c.total.userId, "127.0.0.1")).token;
    assert.equal((await POST(request("POST", token, preview, "https://other.example.test"))).status, 403);
    assert.equal((await POST(request("POST", token, "x".repeat(4097)))).status, 413);
    assert.equal((await POST(request("POST", token, { ...preview, forged: true }))).status, 400);
    const p = await (await POST(request("POST", token, preview))).json(); assert.ok(p.ok);
    const record = { modo: "record", input: c.input(), proof: p.proof };
    assert.equal((await POST(request("POST", token, record))).status, 403);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [c.total.userId]);
    assert.equal((await POST(request("POST", token, record))).status, 200);
    assert.equal((await POST(request("POST", token, record))).status, 200);
    const history = await (await GET(request("GET", editorToken))).json(); assert.equal(history.records.length, 1); assert.equal(history.records[0].created_by, c.total.userId); assert.equal(history.published, false);
  } finally {
    if (old.preview === undefined) delete process.env.PREVIEW_MODE; else process.env.PREVIEW_MODE = old.preview;
    if (old.noPassword === undefined) delete process.env.ADMIN_NO_PASSWORD; else process.env.ADMIN_NO_PASSWORD = old.noPassword;
    await c.db._closeDbForTests();
  }
});
