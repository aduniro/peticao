import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("portal pagina metadados, seleciona final antigo e preserva bytes sem expor payload", async () => {
  const db = await import("./db"); await db._openForTests("t_president_documents");
  const P = await import("./president-document"), actor = { userId: 1, email: "qa-president@example.test" };
  try {
    await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA President','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
    await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) SELECT n,CASE WHEN n=1 THEN 'final' ELSE 'partial' END,'prepared',0,1,'QA-LIST-'||n,convert_to('NEVER_RETURN_PDF_BYTES','UTF8'),'QA-SHA-'||n,'none' FROM generate_series(1,55) n");
    const before = (await db.query("SELECT row_to_json(b)::text raw FROM batches b ORDER BY id")).rows;
    const first = await P.presidentDocuments(actor); assert.ok(first.ok); assert.equal(first.documents.length, 50); assert.equal(first.selected!.seq, 1); assert.equal(first.finalId, 1); assert.equal(first.nextBefore, 6);
    assert.ok(!JSON.stringify(first).includes("NEVER_RETURN_PDF_BYTES"));
    const older = await P.presidentDocuments(actor, { before: first.nextBefore!, id: 2 }); assert.ok(older.ok); assert.equal(older.documents.length, 5); assert.equal(older.selected!.id, 2); assert.equal(older.nextBefore, null);
    assert.deepEqual(P.documentActions(first.selected!), { upload: true, cancel: true, approval: false });
    const bytes = await P.presidentDocumentBytes(1, false, true, actor); assert.ok(bytes.ok); assert.equal(bytes.pdf.toString(), "NEVER_RETURN_PDF_BYTES");
    const event = JSON.parse((await db.query("SELECT data FROM audit_log WHERE event='batch_pdf_downloaded'")).rows[0].data); assert.equal(event.userId, 1); assert.equal(event.preview, true); assert.equal(event.por, actor.email);
    await db.query("UPDATE admin_users SET nivel='edicao' WHERE id=1");
    assert.deepEqual(await P.presidentDocuments(actor), { ok: false, error: "forbidden" }); assert.deepEqual(await P.presidentDocumentBytes(1, false, false, actor), { ok: false, error: "forbidden" });
    assert.deepEqual((await db.query("SELECT row_to_json(b)::text raw FROM batches b ORDER BY id")).rows, before); assert.ok((await db.verifyAuditChain()).ok);
  } finally { await db._closeDbForTests(); }
});

test("retorno do portal é interno e não aceita destino arbitrário", async () => {
  const { batchReturnUrl } = await import("./batch-return");
  const req = (query: string) => new NextRequest(`http://localhost/api/admin/lotes/1/aprovar?${query}`, { headers: { host: "localhost" } });
  assert.equal(batchReturnUrl(req("portal=presidente"), 7).pathname, "/admin/presidente"); assert.equal(batchReturnUrl(req("portal=presidente"), 7).searchParams.get("lote"), "7");
  for (const query of ["", "portal=https://evil.example.test", "returnTo=https://evil.example.test"]) assert.equal(batchReturnUrl(req(query), 7).pathname, "/admin/lotes");
});

test("download preserva original/assinado, exige Total confirmado e registra o ator real", async () => {
  const db = await import("./db"); await db._openForTests("t_president_download_http");
  const U = await import("./admin-users"), route = await import("../app/api/admin/lotes/[id]/pdf/route");
  const original = Buffer.from("%PDF-QA-ORIGINAL"), signed = Buffer.from("%PDF-QA-SIGNED");
  try {
    await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-document-owner@example.test','QA Owner','total','QA-NOT-A-LOGIN-HASH')");
    const session = await U.abrirSessao(1, "127.0.0.1");
    await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,signed_pdf) VALUES(7,'final','prepared',0,1,'QA-LIST',$1,$2)", [original, signed]);
    const request = (query = "", cookie = `adm=${session.token}`) => new NextRequest(`http://localhost/api/admin/lotes/1/pdf${query}`, { headers: { host: "localhost", cookie } });
    assert.equal((await route.GET(request("", ""), { params: { id: "1" } })).status, 401);
    const unconfirmed = await route.GET(request(), { params: { id: "1" } });
    assert.equal(unconfirmed.status, 403); assert.equal((await unconfirmed.json()).erro, "stepup");
    await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
    for (const [query, bytes, disposition] of [["", original, "attachment"], ["?assinado=1&previa=1", signed, "inline"]] as const) {
      const response = await route.GET(request(query), { params: { id: "1" } });
      assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.match(response.headers.get("content-disposition")!, new RegExp(`^${disposition}; filename="lote-7`));
      assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    const events = (await db.query("SELECT data FROM audit_log WHERE event='batch_pdf_downloaded' ORDER BY id")).rows.map(r => JSON.parse(r.data));
    assert.equal(events.length, 2);
    for (const [index, event] of events.entries()) {
      assert.equal(event.userId, 1); assert.equal(event.por, "qa-document-owner@example.test");
      assert.equal(event.signed, index === 1); assert.equal(event.preview, index === 1);
      assert.equal(event.sha256, createHash("sha256").update(index ? signed : original).digest("hex"));
    }
    for (const nivel of ["leitura", "edicao", "exclusao"]) {
      await db.query("UPDATE admin_users SET nivel=$1 WHERE id=1", [nivel]);
      assert.equal((await route.GET(request(), { params: { id: "1" } })).status, 403);
    }
    await db.query("UPDATE admin_users SET nivel='total' WHERE id=1");
    for (const id of ["0", "01", "1.0", "2147483648", "1 OR 1=1"]) assert.equal((await route.GET(request(), { params: { id } })).status, 400);
    assert.equal((await route.GET(request(), { params: { id: "99" } })).status, 404);
    await db.query("UPDATE admin_users SET ativo=false WHERE id=1");
    assert.equal((await route.GET(request(), { params: { id: "1" } })).status, 401);
    assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM batch_sends UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
    assert.ok((await db.verifyAuditChain()).ok);
  } finally { await db._closeDbForTests(); }
});

test("download falha fechado quando a auditoria não pode registrar a leitura", async () => {
  const db = await import("./db"); await db._openForTests("t_president_download_audit");
  const P = await import("./president-document"), actor = { userId: 1, email: "qa-audit@example.test" };
  try {
    await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Audit','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
    await db.query("INSERT INTO batches(seq,kind,n_servidor,n_apoiador,list_hash,pdf) VALUES(1,'final',0,1,'QA-LIST',convert_to('QA-ORIGINAL','UTF8'))");
    await db.query("CREATE FUNCTION qa_download_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='batch_pdf_downloaded' THEN RAISE EXCEPTION 'QA download audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_download_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_download_audit_failure()");
    await assert.rejects(P.presidentDocumentBytes(1, false, false, actor), /QA download audit failure/);
    assert.equal((await db.query("SELECT 1 FROM audit_log WHERE event='batch_pdf_downloaded'")).rowCount, 0);
    assert.deepEqual(await P.presidentDocumentBytes(1, true, false, actor), { ok: false, error: "not_found" });
    assert.deepEqual(await P.presidentDocuments({ ...actor, email: "forged@example.test" }), { ok: false, error: "forbidden" });
    for (const value of [0, -1, 1.5, NaN, 2147483648]) {
      assert.deepEqual(await P.presidentDocuments(actor, { id: value }), { ok: false, error: "parameters" });
      assert.deepEqual(await P.presidentDocuments(actor, { before: value }), { ok: false, error: "parameters" });
      assert.deepEqual(await P.presidentDocumentBytes(value, false, false, actor), { ok: false, error: "parameters" });
    }
  } finally { await db._closeDbForTests(); }
});

test("documento congelado e método próprio não são liberados como assinatura ICP", async () => {
  const { documentActions } = await import("./president-document"), { assertSendable } = await import("./signer");
  const base = { has_pdf: true, status: "prepared", approved_at: null, signature_kind: "none" } as import("./president-document").PresidentDocument;
  for (const kind of ["none", "externa-nao-validada", "propria", "govbr", null]) {
    assert.equal(documentActions({ ...base, signature_kind: kind }).approval, false);
    assert.throws(() => assertSendable(kind, "production"), /ICP-Brasil/);
  }
  for (const status of ["preparing", "sent", "cancelled"]) assert.deepEqual(documentActions({ ...base, status }), { upload: false, cancel: false, approval: false });
  assert.deepEqual(documentActions({ ...base, approved_at: "2026-11-08T00:00:00Z" }), { upload: false, cancel: false, approval: false });
  assert.deepEqual(documentActions({ ...base, has_pdf: false, signature_kind: "icp-brasil" }), { upload: false, cancel: false, approval: false });
  assert.equal(documentActions({ ...base, signature_kind: "icp-brasil" }).approval, true);
});
