import test from "node:test";
import assert from "node:assert/strict";
import { contactListOptions, listContactPage } from "./contact-list";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("filtros de contato validam tipos, limites e cursor sem coerção ambígua", () => {
  assert.deepEqual(contactListOptions({ before: "123", kind: "bug", search: " QA " }), { before: 123, kind: "bug", search: "QA", limit: 25 });
  for (const options of [{ before: "01" }, { before: "1e3" }, { before: -1 }, { before: 2147483648 }, { before: [1] }, { kind: ["bug"] }, { kind: "invalid" }, { search: [] }, { search: "x".repeat(121) }, { search: "QA\0" }, { limit: "25" }, { limit: 0 }, { limit: 51 }]) assert.equal(contactListOptions(options), null);
});

test("paginação alcança contatos além dos200 antigos e não repete nova inserção no cursor", async () => {
  const db = await import("./db"); await db._openForTests("t_contact_list_pages");
  try {
    await db.query("INSERT INTO contact_messages(name,email,kind,message,created_at) SELECT 'QA Pessoa '||n,'qa-contact-'||n||'@example.test',CASE WHEN n%2=0 THEN 'bug' ELSE 'duvida' END,'QA ORIGINAL '||n,'2026-11-08T10:00:00.123456Z'::timestamptz FROM generate_series(1,207)n");
    const originals = (await db.query("SELECT row_to_json(c)::text raw FROM contact_messages c ORDER BY id")).rows;
    const first = await listContactPage({ limit: 17 }); assert.ok(first.ok); assert.equal(first.total, 207); assert.equal(first.records.length, 17); assert.equal(first.records[0].created_at, "2026-11-08T10:00:00.123456Z");
    await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA Nova','qa-new@example.test','outro','QA NEW')");
    const ids = first.records.map(r => r.id); let before = first.nextBefore;
    while (before !== null) { const page = await listContactPage({ before, limit: 17 }); assert.ok(page.ok); ids.push(...page.records.map(r => r.id)); before = page.nextBefore; }
    assert.equal(ids.length, 207); assert.equal(new Set(ids).size, 207); assert.equal(Math.min(...ids), 1);
    assert.deepEqual((await db.query("SELECT row_to_json(c)::text raw FROM contact_messages c WHERE email<>'qa-new@example.test' ORDER BY id")).rows, originals);
    assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM contact_replies UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM mail_messages")).rowCount, 0);
  } finally { await db._closeDbForTests(); }
});

test("busca literal e tipo são cumulativos e preservam o total de todas as páginas filtradas", async () => {
  const db = await import("./db"); await db._openForTests("t_contact_list_filters");
  try {
    await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA%_ Literal','qa-literal@example.test','bug','QA'),('QAAB Literal','qa-other@example.test','bug','QA'),('QA Literal','qa-third@example.test','duvida','QA'),('QA Outro','qa-literal@example.test','duvida','QA')");
    const literal = await listContactPage({ search: "%_" }); assert.ok(literal.ok); assert.equal(literal.total, 1); assert.equal(literal.records[0].name, "QA%_ Literal");
    const filtered = await listContactPage({ search: "LITERAL", kind: "bug", limit: 1 }); assert.ok(filtered.ok); assert.equal(filtered.total, 2); assert.ok(filtered.nextBefore);
    const second = await listContactPage({ search: "LITERAL", kind: "bug", limit: 1, before: filtered.nextBefore }); assert.ok(second.ok); assert.equal(second.total, 2); assert.equal(second.records.length, 1); assert.notEqual(second.records[0].id, filtered.records[0].id); assert.equal(second.nextBefore, null);
    const email = await listContactPage({ search: "qa-literal@example.test", kind: "duvida" }); assert.ok(email.ok); assert.equal(email.total, 1); assert.equal(email.records[0].name, "QA Outro");
    const empty = await listContactPage({ search: "absent" }); assert.ok(empty.ok); assert.equal(empty.total, 0); assert.deepEqual(empty.records, []); assert.equal(empty.nextBefore, null);
    assert.deepEqual(await listContactPage({ limit: 51 }), { ok: false, error: "parameters" });
  } finally { await db._closeDbForTests(); }
});
