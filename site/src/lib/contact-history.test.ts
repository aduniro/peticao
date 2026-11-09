import test from "node:test";
import assert from "node:assert/strict";
import { readContactHistory } from "./contact-history";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;

async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const U = await import("./admin-users");
  const user = await U.criarUsuario({ email: "qa-history@example.test", nome: "QA Histórico", nivel: "edicao", senha: "Ficticia-Historico-Bom-2026" }); assert.ok(user.ok);
  const actor = { userId: user.usuario.id, email: user.usuario.email };
  const contacts = (await db.query("INSERT INTO contact_messages(name,email,kind,message,ip_hash,mail_error,created_at) VALUES('QA Um','qa-contact@example.test','duvida','QA original preservado','QA-HIDDEN-IP','QA-HIDDEN-MAIL-ERROR','2026-11-08T10:00:00.123456Z'),('QA Outro','qa-contact@example.test','duvida','QA-OTHER-CONTACT',null,null,now()) RETURNING id")).rows;
  const id = contacts[0].id as number, other = contacts[1].id as number;
  const job = (await db.query("INSERT INTO contact_triage_jobs(contact_id,revision,engine,status,input_hash,lease_token,evidence,analysis) VALUES($1,1,'QA-engine','complete','QA-HIDDEN-HASH','QA-HIDDEN-LEASE','{\"private\":true}','{\"private\":true}') RETURNING id", [id])).rows[0].id;
  let previous: number | null = null;
  for (let revision = 1; revision <= 3; revision++) {
    previous = (await db.query("INSERT INTO contact_campus_reviews(contact_id,triage_job_id,revision,previous_id,proposal,decision,source_reviewed,created_by,intent_hash,created_at) VALUES($1,$2,$3,$4,'{\"institution\":\"UNIR\",\"campusName\":\"QA Campus\"}','approved',true,$5,$6,'2026-11-08T10:01:00.123456Z') RETURNING id", [id, job, revision, previous, actor.userId, `QA-HIDDEN-INTENT-${revision}`])).rows[0].id;
  }
  const states = ["legacy", "prepared", "blocked", "sending", "accepted", "uncertain", "rejected"];
  for (const [index, state] of states.entries()) await db.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto,estado,ok,agendada,payload,selo,attempt_id,erro,criada_em) VALUES($1,$2,'texto','qa-operator@example.test','QA assunto',$3,true,true,'{\"text\":\"QA-HIDDEN-PAYLOAD\"}','QA-HIDDEN-SEAL','QA-HIDDEN-ATTEMPT','QA-HIDDEN-ERROR','2026-11-08T10:02:00.123456Z')", [id, index + 1, state]);
  return { db, U, actor, id, other };
}

test("histórico mantém estados reais e microssegundos sem expor payload ou inferir entrega/identidade", async () => {
  const c = await setup("t_contact_history_projection");
  try {
    const snapshot = async () => (await c.db.query("SELECT 'contact' kind,row_to_json(c)::text raw FROM contact_messages c UNION ALL SELECT 'reply',row_to_json(r)::text FROM contact_replies r UNION ALL SELECT 'campus',row_to_json(v)::text FROM contact_campus_reviews v UNION ALL SELECT 'job',row_to_json(j)::text FROM contact_triage_jobs j ORDER BY kind,raw")).rows;
    const before = await snapshot();
    const result = await readContactHistory(c.id, c.actor, { limit: 20 }); assert.ok(result.ok);
    assert.equal(result.contact.message, "QA original preservado"); assert.equal(result.contact.created_at, "2026-11-08T10:00:00.123456Z");
    assert.deepEqual(result.replies.items.map(r => r.estado), ["rejected", "uncertain", "accepted", "sending", "blocked", "prepared", "legacy"]);
    assert.equal(result.replies.items[0].created_at, "2026-11-08T10:02:00.123456Z");
    assert.equal(result.delivery, "not_evaluated"); assert.equal(result.campus.published, false);
    assert.equal(result.campus.items[0].revision, 3); assert.equal(result.campus.items[0].created_at, "2026-11-08T10:01:00.123456Z");
    assert.equal(result.triage?.status, "complete");
    assert.ok(!JSON.stringify(result).includes("QA-HIDDEN")); assert.ok(!JSON.stringify(result).includes("QA-OTHER-CONTACT"));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await c.db.query("SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM signatures")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("paginação independente não perde respostas após inserção nova e isola o contato", async () => {
  const c = await setup("t_contact_history_pages");
  try {
    const first = await readContactHistory(c.id, c.actor, { limit: 2 }); assert.ok(first.ok);
    const replies = [...first.replies.items], campuses = [...first.campus.items];
    await c.db.query("INSERT INTO contact_replies(contact_id,rodada,versao,assunto) VALUES($1,8,'texto','QA New')", [c.id]);
    let cursor = first.replies.nextBefore;
    while (cursor !== null) { const next = await readContactHistory(c.id, c.actor, { limit: 2, replyBefore: cursor }); assert.ok(next.ok); replies.push(...next.replies.items); cursor = next.replies.nextBefore; }
    assert.equal(replies.length, 7); assert.equal(new Set(replies.map(r => r.id)).size, 7);
    assert.ok(first.campus.nextBefore); const next = await readContactHistory(c.id, c.actor, { limit: 2, campusBefore: first.campus.nextBefore }); assert.ok(next.ok); campuses.push(...next.campus.items);
    assert.equal(campuses.length, 3); assert.equal(next.campus.nextBefore, null);
    const other = await readContactHistory(c.other, c.actor); assert.ok(other.ok); assert.deepEqual(other.replies.items, []); assert.deepEqual(other.campus.items, []); assert.equal(other.triage, null);
  } finally { await c.db._closeDbForTests(); }
});

test("histórico revalida conta, nível e parâmetros sem autorização por modo prévia", async () => {
  const c = await setup("t_contact_history_actor");
  try {
    for (const id of [0, -1, 1.5, 2147483648]) assert.deepEqual(await readContactHistory(id, c.actor), { ok: false, error: "parameters" });
    for (const options of [{ limit: 0 }, { limit: 21 }, { replyBefore: 0 }, { campusBefore: -1 }]) assert.deepEqual(await readContactHistory(c.id, c.actor, options), { ok: false, error: "parameters" });
    assert.deepEqual(await readContactHistory(c.id, { ...c.actor, email: "forged@example.test" }), { ok: false, error: "forbidden" });
    assert.deepEqual(await readContactHistory(2147483647, c.actor), { ok: false, error: "not_found" });
    for (const update of ["nivel='leitura'", "nivel='total',ativo=false"]) {
      await c.db.query(`UPDATE admin_users SET ${update} WHERE id=$1`, [c.actor.userId]);
      assert.deepEqual(await readContactHistory(c.id, c.actor), { ok: false, error: "forbidden" });
    }
  } finally { await c.db._closeDbForTests(); }
});

test("API de histórico protege dados, parâmetros e cache e recupera após fonte indisponível", async () => {
  const c = await setup("t_contact_history_http");
  try {
    const { NextRequest } = await import("next/server"), { GET } = await import("../app/api/admin/contato/historico/route");
    const { token } = await c.U.abrirSessao(c.actor.userId, "127.0.0.1");
    const request = (query: string, cookie = `adm=${token}`, origin = "http://localhost") => new NextRequest(`http://localhost/api/admin/contato/historico?${query}`, { headers: { host: "localhost", origin, cookie } });
    assert.equal((await GET(request(`contato=${c.id}`, ""))).status, 401);
    assert.equal((await GET(request(`contato=${c.id}`, undefined, "https://elsewhere.example.test"))).status, 403);
    for (const q of ["", `contato=${c.id}&contato=${c.id}`, `contato=${c.id}&limit=21`, `contato=${c.id}&payload=1`, "contato=01", "contato=2147483648", `contato=${c.id}&replyBefore=0`]) assert.equal((await GET(request(q))).status, 400);
    const response = await GET(request(`contato=${c.id}&limit=2`)); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.ok(!(await response.text()).includes("QA-HIDDEN"));
    await c.db.query("ALTER TABLE contact_campus_reviews RENAME TO qa_missing_campus");
    try { const failed = await GET(request(`contato=${c.id}`)); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { ok: false, error: "unavailable" }); }
    finally { await c.db.query("ALTER TABLE qa_missing_campus RENAME TO contact_campus_reviews"); }
    assert.equal((await GET(request(`contato=${c.id}`))).status, 200);
    await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [c.actor.userId]);
    assert.equal((await GET(request(`contato=${c.id}`))).status, 403);
  } finally { await c.db._closeDbForTests(); }
});
