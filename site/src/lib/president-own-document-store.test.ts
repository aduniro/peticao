import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
const cpf = "52998224725"; // Public CPF algorithm example; fictitious provider/identity only.
const identity = { cpf, birthDate: "2000-01-01" };
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const ddl = async () => (await import("./president-own-document-schema")).PRESIDENT_OWN_DOCUMENT_SCHEMA_SQL;
async function fixture(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  await db.query(await ddl());
  const S = await import("./president-portal-store"), O = await import("./president-own-document-store"), U = await import("./admin-users"), C = await import("./cpf-check");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-own-owner@example.test','QA Own Owner','total','QA-NOT-A-LOGIN-HASH'),(2,'qa-own-president@example.test','Pessoa Responsavel QA','leitura','QA-NOT-A-LOGIN-HASH')");
  const session = await U.abrirSessao(1, "127.0.0.1");
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
  const actor = (await U.sessaoPorToken(session.token))!;
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]).drawText("FICTITIOUS OWN DOCUMENT QA", { x: 20, y: 370, size: 10 });
  const bytes = Buffer.from(await pdf.save());
  const batch = (await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf,pdf_sha256,signature_kind)VALUES(1,'partial','prepared',0,1,0,$1,$2,$3,'none')RETURNING id", ["a".repeat(64), bytes, digest(bytes)])).rows[0].id as number;
  const provider = C.mockProvider({ [cpf]: { nome: "Pessoa Responsavel QA", nasc: "01/01/2000" } });
  assert.deepEqual(await S.configurePresidentProfile(actor, { responsibleId: 2, cpf, enabled: true, expectedRevision: 0 }), { ok: true, revision: 1 });
  const issued = await S.issueConfiguredPresidentChallenge(batch, actor, provider); assert.ok(issued.ok);
  const receipt = await S.confirmConfiguredPresidentChallenge({ ...issued, ...identity }, provider); assert.ok(receipt.ok);
  const input = (requestId = randomUUID()) => ({ requestId, batchId: batch, receiptId: receipt.receiptId, expectedDocumentVersion: issued.documentVersion });
  const source = async () => (await db.query("SELECT row_to_json(b)::text data FROM batches b ORDER BY id")).rows;
  const counts = async () => (await db.query("SELECT (SELECT count(*)::int FROM president_own_document_intents) intents,(SELECT count(*)::int FROM president_own_document_results) results,(SELECT count(*)::int FROM president_own_document_artifacts) artifacts")).rows[0] as { intents: number; results: number; artifacts: number };
  const noExternal = async () => {
    assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount, 0);
    const journal = JSON.stringify((await db.query("SELECT data FROM audit_log UNION ALL SELECT row_to_json(t)::text FROM president_own_document_intents t UNION ALL SELECT row_to_json(t)::text FROM president_own_document_results t")).rows);
    for (const secret of [cpf, identity.birthDate, issued.token, issued.password]) assert.equal(journal.includes(secret), false);
    assert.ok((await db.verifyAuditChain()).ok);
  };
  return { db, S, O, U, actor, session, batch, bytes, issued, receipt, provider, input, source, counts, noExternal };
}

// Every case gets a distinct real PostgreSQL schema. No production database or identity provider.
test("own document concurrent same nonce creates one immutable effect and exact readback", async () => {
  const c = await fixture("t_own_db_nonce_once");
  try {
    const input = c.input(), source = await c.source();
    const results = await Promise.all([c.O.createPresidentOwnDocument(input, c.actor), c.O.createPresidentOwnDocument(input, c.actor)]);
    assert.ok(results.every(r => r.ok));
    const read = await c.O.readPresidentOwnDocumentRequest(input.requestId, c.actor); assert.ok(read.ok); assert.equal(read.document.state, "completed"); assert.ok(read.document.artifactId);
    assert.deepEqual(await c.counts(), { intents: 1, results: 1, artifacts: 1 });
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='president_own_document_created'")).rowCount, 1);
    const pdf = await c.O.readPresidentOwnDocumentPdf(read.document.artifactId, c.actor); assert.ok(pdf.ok); assert.equal(digest(pdf.bytes), read.document.sha256); assert.equal(pdf.sourceSha256, digest(c.bytes));
    assert.equal((await PDFDocument.load(pdf.bytes)).getPageCount(), 2);
    assert.deepEqual(await c.O.createPresidentOwnDocument(input, c.actor), { ok: true, document: read.document });
    assert.deepEqual(await c.source(), source); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});

test("two explicit nonces for one consumed receipt converge on the same artifact", async () => {
  const c = await fixture("t_own_db_artifact_once");
  try {
    const source = await c.source(), a = c.input(), b = c.input();
    const results = await Promise.all([c.O.createPresidentOwnDocument(a, c.actor), c.O.createPresidentOwnDocument(b, c.actor)]);
    assert.ok(results[0].ok && results[1].ok);
    assert.equal(results[0].document.state, "completed"); assert.equal(results[1].document.state, "completed");
    assert.equal(results[0].document.artifactId, results[1].document.artifactId); assert.equal(results[0].document.sha256, results[1].document.sha256);
    assert.deepEqual(await c.counts(), { intents: 2, results: 2, artifacts: 1 });
    assert.deepEqual(await c.source(), source); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});

test("nonce is actor scoped; a different payload cannot reuse another context", async () => {
  const c = await fixture("t_own_db_actor_scope");
  try {
    const input = c.input(), first = await c.O.createPresidentOwnDocument(input, c.actor); assert.ok(first.ok);
    assert.deepEqual(await c.O.createPresidentOwnDocument({ ...input, receiptId: randomUUID() }, c.actor), { ok: false, error: "conflict" });
    await c.db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(3,'qa-own-other@example.test','QA Other Owner','total','QA-NOT-A-LOGIN-HASH')");
    const session = await c.U.abrirSessao(3, "127.0.0.1"); await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=3");
    const other = (await c.U.sessaoPorToken(session.token))!;
    assert.deepEqual(await c.O.readPresidentOwnDocumentRequest(input.requestId, other), { ok: false, error: "not_found" });
    const independent = await c.O.createPresidentOwnDocument(input, other); assert.ok(independent.ok); assert.equal(independent.document.artifactId, first.document.artifactId);
    assert.deepEqual(await c.counts(), { intents: 2, results: 2, artifacts: 1 }); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});

test("post-render CAS rejects profile, source bytes, list or signed-source changes", async t => {
  for (const change of ["profile", "bytes", "list", "signed"] as const) {
    const c = await fixture(`t_own_db_cas_${change}`);
    try {
      const originalLoad = PDFDocument.load;
      let called = false;
      const mocked = t.mock.method(PDFDocument, "load", async (...args: Parameters<typeof PDFDocument.load>) => {
        const doc = await originalLoad.apply(PDFDocument, args);
        if (!called) {
          called = true;
          if (change === "profile") await c.S.configurePresidentProfile(c.actor, { responsibleId: 2, enabled: true, expectedRevision: 1 });
          else if (change === "bytes") { const changed = Buffer.concat([c.bytes, Buffer.from("\n% changed source")]); await c.db.query("UPDATE batches SET pdf=$1,pdf_sha256=$2 WHERE id=$3", [changed, digest(changed), c.batch]); }
          else if (change === "list") await c.db.query("UPDATE batches SET list_hash=$1 WHERE id=$2", ["b".repeat(64), c.batch]);
          else await c.db.query("UPDATE batches SET signed_pdf=$1,signed_pdf_sha256=$2,signature_kind='externa-nao-validada' WHERE id=$3", [c.bytes, digest(c.bytes), c.batch]);
        }
        return doc;
      });
      const input = c.input(); let result;
      try { result = await c.O.createPresidentOwnDocument(input, c.actor); } finally { mocked.mock.restore(); }
      assert.equal(called, true); assert.deepEqual(result, { ok: false, error: "conflict" });
      const read = await c.O.readPresidentOwnDocumentRequest(input.requestId, c.actor); assert.ok(read.ok); assert.equal(read.document.state, "failed"); assert.equal(read.document.error, "context_changed");
      assert.deepEqual(await c.counts(), { intents: 1, results: 1, artifacts: 0 }); await c.noExternal();
    } finally { await c.db._closeDbForTests(); }
  }
});

test("actor revocation during rendering prevents persistence and preserves inert pending recovery", async t => {
  const c = await fixture("t_own_db_actor_revoked");
  try {
    const originalLoad = PDFDocument.load; let called = false;
    const mocked = t.mock.method(PDFDocument, "load", async (...args: Parameters<typeof PDFDocument.load>) => { const doc = await originalLoad.apply(PDFDocument, args); if (!called) { called = true; await c.db.query("UPDATE admin_users SET ativo=false WHERE id=1"); } return doc; });
    const input = c.input(); let result;
    try { result = await c.O.createPresidentOwnDocument(input, c.actor); } finally { mocked.mock.restore(); }
    assert.equal(called, true); assert.deepEqual(result, { ok: false, error: "forbidden" });
    assert.deepEqual(await c.counts(), { intents: 1, results: 0, artifacts: 0 });
    assert.deepEqual(await c.O.readPresidentOwnDocumentRequest(input.requestId, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=1");
    const recovered = await c.O.readPresidentOwnDocumentRequest(input.requestId, c.actor); assert.ok(recovered.ok); assert.equal(recovered.document.state, "pending");
    assert.deepEqual(await c.O.createPresidentOwnDocument(input, c.actor), { ok: true, document: recovered.document });
    assert.deepEqual(await c.counts(), { intents: 1, results: 0, artifacts: 0 });
    const explicit = await c.O.createPresidentOwnDocument(c.input(), c.actor); assert.ok(explicit.ok); assert.equal(explicit.document.state, "completed"); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});

test("audit failure rolls back reserve or final artifact/result while recovery stays explicit", async () => {
  const c = await fixture("t_own_db_audit_atomic");
  try {
    const source = await c.source();
    const inject = async (event: "president_own_document_reserved" | "president_own_document_created" | "president_own_document_downloaded") => c.db.query(`CREATE FUNCTION qa_own_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'QA own audit fault'; END IF; RETURN NEW; END $$;CREATE TRIGGER qa_own_audit_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_own_audit_fault()`);
    const clear = async () => c.db.query("DROP TRIGGER qa_own_audit_fault ON audit_log;DROP FUNCTION qa_own_audit_fault()");
    await inject("president_own_document_reserved"); assert.deepEqual(await c.O.createPresidentOwnDocument(c.input(), c.actor), { ok: false, error: "unavailable" }); await clear();
    assert.deepEqual(await c.counts(), { intents: 0, results: 0, artifacts: 0 });
    const lost = c.input(); await inject("president_own_document_created"); assert.deepEqual(await c.O.createPresidentOwnDocument(lost, c.actor), { ok: false, error: "unavailable" }); await clear();
    assert.deepEqual(await c.counts(), { intents: 1, results: 0, artifacts: 0 });
    const recovered = await c.O.readPresidentOwnDocumentRequest(lost.requestId, c.actor); assert.ok(recovered.ok); assert.equal(recovered.document.state, "pending");
    const complete = await c.O.createPresidentOwnDocument(c.input(), c.actor); assert.ok(complete.ok); assert.ok(complete.document.artifactId);
    await inject("president_own_document_downloaded"); assert.deepEqual(await c.O.readPresidentOwnDocumentPdf(complete.document.artifactId, c.actor), { ok: false, error: "unavailable" }); await clear();
    assert.ok((await c.O.readPresidentOwnDocumentPdf(complete.document.artifactId, c.actor)).ok); assert.deepEqual(await c.source(), source); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});

test("journals reject update/delete/truncate and schema replay preserves exact historical rows", async () => {
  const c = await fixture("t_own_db_immutable");
  try {
    const done = await c.O.createPresidentOwnDocument(c.input(), c.actor); assert.ok(done.ok);
    const tables = ["president_own_document_intents", "president_own_document_artifacts", "president_own_document_results"];
    const rows = async () => Promise.all(tables.map(name => c.db.query(`SELECT row_to_json(t)::text data FROM ${name} t ORDER BY 1`).then(r => r.rows)));
    const before = await rows();
    for (const name of tables) {
      const column = name.endsWith("results") ? "intent_id" : "id";
      await assert.rejects(c.db.query(`UPDATE ${name} SET ${column}=${column}`), /immutable/);
      await assert.rejects(c.db.query(`DELETE FROM ${name}`), /immutable/);
      await assert.rejects(c.db.query(`TRUNCATE ${name} CASCADE`), /immutable/);
    }
    await c.db.query(await ddl()); assert.deepEqual(await rows(), before); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});

test("historical download and nonce recovery remain readable after profile changes without authorizing a new mutation", async () => {
  const c = await fixture("t_own_db_historical");
  try {
    const input = c.input(), done = await c.O.createPresidentOwnDocument(input, c.actor); assert.ok(done.ok); assert.ok(done.document.artifactId);
    const before = await c.O.readPresidentOwnDocumentPdf(done.document.artifactId, c.actor); assert.ok(before.ok);
    await c.S.configurePresidentProfile(c.actor, { responsibleId: 2, enabled: true, expectedRevision: 1 });
    const after = await c.O.readPresidentOwnDocumentPdf(done.document.artifactId, c.actor); assert.ok(after.ok); assert.deepEqual(after.bytes, before.bytes);
    const old = await c.O.readPresidentOwnDocumentRequest(input.requestId, c.actor); assert.ok(old.ok); assert.equal(old.document.state, "completed");
    assert.equal((await c.O.createPresidentOwnDocument(c.input(), c.actor)).ok, false);
    assert.equal((await c.counts()).artifacts, 1); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});

test("corrupted stored artifact cannot be downloaded or silently reused by a fresh intent", async () => {
  const c = await fixture("t_own_db_corrupt_history");
  try {
    const done = await c.O.createPresidentOwnDocument(c.input(), c.actor); assert.ok(done.ok); assert.ok(done.document.artifactId);
    const id = done.document.artifactId;
    const original = (await c.db.query("SELECT * FROM president_own_document_artifacts WHERE id=$1", [id])).rows[0];
    // Deliberate fault injection in this synthetic schema only. Normal SQL immutability is separately tested.
    const inject = async (bytes: Buffer, sourceSha: string, canonical: string, evidence: string) => {
      await c.db.query("ALTER TABLE president_own_document_artifacts DISABLE TRIGGER president_own_immutable");
      try { await c.db.query("UPDATE president_own_document_artifacts SET bytes=$2,source_sha256=$3,evidence_canonical=$4,evidence_digest=$5 WHERE id=$1", [id, bytes, sourceSha, canonical, evidence]); }
      finally { await c.db.query("ALTER TABLE president_own_document_artifacts ENABLE TRIGGER president_own_immutable"); }
    };
    for (const fault of ["bytes", "column", "canonical"] as const) {
      const altered = fault === "canonical" ? JSON.stringify({ ...JSON.parse(original.evidence_canonical), signerName: "X\nY" }) : original.evidence_canonical;
      const evidence = fault === "canonical" ? digest("president-own-confirmation:v1:" + altered) : original.evidence_digest;
      await inject(fault === "bytes" ? Buffer.concat([original.bytes, Buffer.from("modified")]) : original.bytes, fault === "column" ? "f".repeat(64) : original.source_sha256, altered, evidence);
      assert.deepEqual(await c.O.readPresidentOwnDocumentPdf(id, c.actor), { ok: false, error: "unavailable" });
      if (fault !== "canonical") { assert.deepEqual(await c.O.createPresidentOwnDocument(c.input(), c.actor), { ok: false, error: "unavailable" }); assert.equal((await c.counts()).artifacts, 1); }
      await inject(original.bytes, original.source_sha256, original.evidence_canonical, original.evidence_digest);
    }
    assert.ok((await c.O.readPresidentOwnDocumentPdf(id, c.actor)).ok); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});


test("current Total and stepup are mandatory for creation, recovery and historical PDF", async () => {
  const c = await fixture("t_own_db_current_auth");
  try {
    const input = c.input(), done = await c.O.createPresidentOwnDocument(input, c.actor); assert.ok(done.ok); assert.ok(done.document.artifactId);
    for (const mode of ["missing", "stepup", "role"] as const) {
      if (mode === "stepup") await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1");
      if (mode === "role") { await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1"); await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=1"); }
      const actor = mode === "missing" ? null : c.actor;
      assert.deepEqual(await c.O.createPresidentOwnDocument(c.input(), actor), { ok: false, error: "forbidden" });
      assert.deepEqual(await c.O.readPresidentOwnDocumentRequest(input.requestId, actor), { ok: false, error: "forbidden" });
      assert.deepEqual(await c.O.readPresidentOwnDocumentPdf(done.document.artifactId, actor), { ok: false, error: "forbidden" });
    }
    assert.deepEqual(await c.counts(), { intents: 1, results: 1, artifacts: 1 }); await c.noExternal();
  } finally { await c.db._closeDbForTests(); }
});
