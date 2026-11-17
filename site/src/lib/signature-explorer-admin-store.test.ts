import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
const stamp = "2026-11-10T12:00:00.000Z";
async function setup(schema: string) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.ok(["54375", "54381"].includes(url.port));
  assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
  const db = await import("@/lib/db"); await db._openForTests(schema);
  const U = await import("@/lib/admin-users"), S = await import("@/lib/signature-explorer-admin-store"), C = await import("@/lib/signature-explorer-admin-contract");
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-explorer-read@example.test','QA Reader','leitura','QA-NOT-LOGIN'),(2,'qa-explorer-edit@example.test','QA Editor','edicao','QA-NOT-LOGIN')");
  const reader = await U.abrirSessao(1, "127.0.0.1"), editor = await U.abrirSessao(2, "127.0.0.1");
  const readActor = (await U.sessaoPorToken(reader.token))!, editActor = (await U.sessaoPorToken(editor.token))!;
  const options = (qs = "") => { const parsed = C.signatureExplorerSearch(new URLSearchParams(qs)); assert.ok(parsed.ok); return parsed.options; };
  return { db, U, S, C, reader, editor, readActor, editActor, options };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function seed(c: Fixture, n: number) {
  await c.db.query("INSERT INTO signatures(name,email,email_hash,category,institution,ifes_acronym,campus,campus_ibge,text_version,consent_at,created_at,status,confirmed_at) SELECT 'QA Person '||i,'qa'||i||'@example.test','QA-EXP-'||i,'servidor','QA Institution '||(i%350),'UNIR','QA Campus '||(i%350),1100205,'QA',$2,$2,CASE WHEN i%2=0 THEN 'pending' ELSE 'confirmed' END,CASE WHEN i%2=0 THEN NULL ELSE $2 END FROM generate_series(1,$1::int)i", [n, stamp]);
}
const sourceState = async (c: Fixture) => (await c.db.query("SELECT row_to_json(s)::text value FROM signatures s ORDER BY id")).rows;
test("explorer current Leitura/Edição accounts, session ownership, revocation and expiry; contacts only Edição", async () => {
  const c = await setup("t_explorer_auth"); try {
    await seed(c, 1); const { cifrar } = await import("@/lib/crypto-dados");
    await c.db.query("UPDATE signatures SET wa_cipher=$1,wa_confirmed_at=$2,cpf_name_check='match' WHERE id=1", [cifrar("+5569999990000", "wa:1"), stamp]);
    const before = await sourceState(c);
    const r = await c.S.readSignatureExplorer(c.readActor, c.options()); assert.ok(r.ok); assert.equal(r.capabilities.contacts, false); assert.equal(r.linhas[0].whatsapp, ""); assert.equal(r.linhas[0].waConfirmado, true); assert.equal(r.linhas[0].cpf, true);
    const e = await c.S.readSignatureExplorer(c.editActor, c.options()); assert.ok(e.ok); assert.equal(e.capabilities.contacts, true); assert.match(e.linhas[0].whatsapp, /99999/);
    for (const row of [r.linhas[0], e.linhas[0]]) for (const secret of ["email", "wa_cipher", "cpf_cipher", "email_hash", "token"]) assert.equal(secret in row, false);
    const byEmail = await c.S.readSignatureExplorer(c.readActor, c.options("q=qa1%40example.test")); assert.ok(byEmail.ok); assert.equal(byEmail.total, 0, "q only matches names, never email");
    for (const actor of [{ ...c.readActor, email: "wrong@example.test" }, { ...c.readActor, sessaoId: null }, { ...c.readActor, sessaoId: c.editActor.sessaoId }]) assert.deepEqual(await c.S.readSignatureExplorer(actor, c.options()), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=2"); const down = await c.S.readSignatureExplorer(c.editActor, c.options()); assert.ok(down.ok); assert.equal(down.capabilities.contacts, false); assert.equal(down.linhas[0].whatsapp, "");
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=1"); assert.deepEqual(await c.S.readSignatureExport(c.readActor, c.options("formato=csv")), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=1"); await c.db.query("UPDATE admin_sessions SET expira_em=clock_timestamp()-interval '1 second' WHERE id=$1", [c.readActor.sessaoId]); assert.deepEqual(await c.S.readSignatureExplorer(c.readActor, c.options()), { ok: false, error: "forbidden" });
    await c.U.encerrarSessao(c.editor.token); assert.deepEqual(await c.S.readSignatureExplorer(c.editActor, c.options()), { ok: false, error: "forbidden" }); assert.deepEqual(await sourceState(c), before);
  } finally { await c.db._closeDbForTests(); }
});
test("Leitura SQL never selects wa_cipher; a view without the cipher column remains readable", async () => {
  const c = await setup("t_explorer_no_cipher"); try {
    await seed(c, 1); await c.db.query("ALTER TABLE signatures RENAME TO signatures_base");
    const columns = (await c.db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='signatures_base' ORDER BY ordinal_position")).rows.map(r => String(r.column_name));
    assert.ok(columns.includes("wa_cipher")); const projection = columns.filter(k => k !== "wa_cipher").map(k => '"' + k.replaceAll('"', '""') + '"').join(",");
    await c.db.query(`CREATE VIEW signatures AS SELECT ${projection} FROM signatures_base`);
    const read = await c.S.readSignatureExplorer(c.readActor, c.options()); assert.ok(read.ok); assert.equal(read.linhas[0].whatsapp, "");
    assert.deepEqual(await c.S.readSignatureExplorer(c.editActor, c.options()), { ok: false, error: "unavailable" });
    const csv = await c.S.readSignatureExport(c.editActor, c.options("formato=csv")); assert.ok(csv.ok); assert.equal(csv.rows[0].whatsapp, "", "CSV never selects contact even for Edição");
  } finally { await c.db._closeDbForTests(); }
});
test("all facets beyond300 and pages reconcile; export includes50001 without touching signatures or sending mail", async () => {
  const c = await setup("t_explorer_complete"); try {
    await seed(c, 50001);
    await c.db.query("UPDATE signatures SET institution=$1,campus=$2 WHERE id=1", ["Instituto QA, Campus Norte", "[Unidade QA]"]);
    const before = await sourceState(c);
    const first = await c.S.readSignatureExplorer(c.readActor, c.options("limite=200")); assert.ok(first.ok); assert.equal(first.total, 50001); assert.equal(first.linhas.length, 200); assert.equal(first.facetas.instituicao.length, 351); assert.equal(first.facetas.campus.length, 351); assert.equal(first.totais.confirmadas + first.totais.pendentes, 50001); assert.equal(first.pontos.reduce((n, p) => n + p.conf + p.pend, first.semLocal), 50001); assert.deepEqual(first.coverage, { matched: 50001, totalRowsReturned: 200, facetsComplete: true, mapComplete: true, complete: true });
    const last = await c.S.readSignatureExplorer(c.readActor, c.options("pagina=251&limite=200")); assert.ok(last.ok); assert.equal(last.linhas.length, 1); assert.equal(last.linhas[0].id, 1);
    const selected = await c.S.readSignatureExplorer(c.readActor, c.options("instituicao=QA+Institution+349")); assert.ok(selected.ok); assert.equal(selected.total, 142); assert.ok(selected.linhas.every(r => r.instituicao === "QA Institution 349")); assert.equal(selected.facetas.instituicao.length, 351, "facet ignores its own selection without cap");
    const F = await import("@/lib/assinaturas-filtros"), literalQuery = F.filtrosParaQuery({ ...F.filtrosVazios(), instituicao: ["Instituto QA, Campus Norte"], campus: ["[Unidade QA]"] });
    const literal = await c.S.readSignatureExplorer(c.readActor, c.options(literalQuery)); assert.ok(literal.ok); assert.equal(literal.total, 1); assert.equal(literal.linhas[0].id, 1); assert.equal(literal.linhas[0].instituicao, "Instituto QA, Campus Norte");
    const literalCsv = await c.S.readSignatureExport(c.editActor, c.options(literalQuery + "&formato=csv")); assert.ok(literalCsv.ok); assert.equal(literalCsv.total, 1); assert.equal(literalCsv.rows.length, 1); assert.equal(literalCsv.rows[0].id, 1);
    const source = await c.S.readSignatureExport(c.editActor, c.options("formato=csv")); assert.ok(source.ok); assert.equal(source.total, 50001); assert.equal(source.rows.length, 50001); assert.equal(source.rows[0].id, 50001); assert.equal(source.rows.at(-1)!.id, 1); assert.equal(new Set(source.rows.map(r => r.id)).size, 50001); assert.ok(source.rows.every(r => r.whatsapp === ""));
    assert.deepEqual(await sourceState(c), before); assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});
test("count, rows, map and full facets share RR while a second connection commits a new signature", async () => {
  const c = await setup("t_explorer_rr"); try {
    await seed(c, 1); await c.db.query("ALTER TABLE signatures RENAME TO signatures_base");
    await c.db.query("CREATE FUNCTION qa_explorer_pause()RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$BEGIN PERFORM pg_sleep(0.15);RETURN true;END$$;CREATE VIEW signatures AS SELECT * FROM signatures_base WHERE qa_explorer_pause()");
    const pending = c.S.readSignatureExplorer(c.readActor, c.options()); let active = false;
    for (let i = 0; i < 150; i++) { active = !!(await c.db.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query LIKE '%512+octet_length(json_build_array(s.name%' ")).rowCount; if (active) break; await new Promise(r => setTimeout(r, 10)); }
    assert.ok(active, "observe preflight after the RR snapshot has started");
    await c.db.query("INSERT INTO signatures_base(name,email,email_hash,category,institution,text_version,consent_at,created_at,status)VALUES('QA Concurrent','concurrent@example.test','QA-CONCURRENT','servidor','QA New','QA',$1,$1,'pending')", [stamp]);
    const r = await pending; assert.ok(r.ok); assert.equal(r.total, 1); assert.equal(r.linhas.length, 1); assert.equal(r.totais.confirmadas, 1); assert.equal(r.totais.pendentes, 0); assert.equal(r.facetas.instituicao.length, 1); assert.equal(r.facetas.instituicao[0].v, "QA Institution 1"); assert.equal(r.pontos.reduce((n, p) => n + p.conf + p.pend, r.semLocal), 1);
    const fresh = await c.S.readSignatureExplorer(c.readActor, c.options()); assert.ok(fresh.ok); assert.equal(fresh.total, 2); assert.equal(fresh.facetas.instituicao.length, 2);
  } finally { await c.db._closeDbForTests(); }
});
test("expiry during read/export is rejected, and final export audit reauthorizes and rolls back on failure", async () => {
  const c = await setup("t_explorer_expiry"); try {
    await seed(c, 1); await c.db.query("ALTER TABLE signatures RENAME TO signatures_base"); await c.db.query("CREATE TABLE qa_explorer_probe(id SERIAL PRIMARY KEY,still_valid boolean NOT NULL)"); const sid = c.readActor.sessaoId!;
    await c.db.query(`CREATE FUNCTION qa_explorer_pause()RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$BEGIN INSERT INTO qa_explorer_probe(still_valid) SELECT expira_em>clock_timestamp() FROM admin_sessions WHERE id=${sid};PERFORM pg_sleep(0.25);INSERT INTO qa_explorer_probe(still_valid) SELECT expira_em>clock_timestamp() FROM admin_sessions WHERE id=${sid};RETURN true;END$$;CREATE VIEW signatures AS SELECT * FROM signatures_base WHERE qa_explorer_pause()`);
    for (const mode of ["json", "csv"]) { await c.db.query("TRUNCATE qa_explorer_probe"); await c.db.query("UPDATE admin_sessions SET expira_em=clock_timestamp()+interval '500 milliseconds' WHERE id=$1", [sid]); const r = mode === "json" ? await c.S.readSignatureExplorer(c.readActor, c.options()) : await c.S.readSignatureExport(c.readActor, c.options("formato=csv")); assert.deepEqual(r, { ok: false, error: "forbidden" }); const probes = (await c.db.query("SELECT still_valid FROM qa_explorer_probe ORDER BY id")).rows; assert.equal(probes[0].still_valid, true); assert.ok(probes.some(r => !r.still_valid)); }
    await c.db.query("UPDATE admin_sessions SET expira_em=clock_timestamp()+interval '1 hour' WHERE id=$1", [sid]);
    const metadata = { rows: 1, bytes: 123, sha256: "a".repeat(64), asOf: stamp }; assert.equal(await c.S.auditSignatureExport(c.readActor, metadata), true);
    const auditRow = (await c.db.query("SELECT data FROM audit_log WHERE event='export_internal_base' ORDER BY id DESC LIMIT 1")).rows[0]; assert.equal((typeof auditRow.data === "string" ? JSON.parse(auditRow.data) : auditRow.data).scope, "signatures_complete_filtered");
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=1"); assert.equal(await c.S.auditSignatureExport(c.readActor, metadata), false); await c.db.query("UPDATE admin_users SET ativo=true WHERE id=1");
    const before = (await c.db.query("SELECT count(*)::int n FROM audit_log")).rows[0].n;
    await c.db.query("CREATE FUNCTION qa_explorer_fail_audit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'QA deliberate audit failure';END$$;CREATE TRIGGER qa_explorer_fail_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_explorer_fail_audit()"); assert.equal(await c.S.auditSignatureExport(c.readActor, metadata), false); assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log")).rows[0].n, before);
  } finally { await c.db._closeDbForTests(); }
});

test("invalid store option shapes fail before any connection, without silently serializing away unknown fields", async () => {
  const C = await import("@/lib/signature-explorer-admin-contract"), S = await import("@/lib/signature-explorer-admin-store");
  const parsed = C.signatureExplorerSearch(new URLSearchParams()); assert.ok(parsed.ok);
  const actor = { userId: 1, email: "qa-invalid@example.test", sessaoId: 1 };
  const invalid: unknown[] = [null, [], { ...parsed.options, extra: true }, { ...parsed.options, limit: 1.5 }, { ...parsed.options, page: Infinity }, { ...parsed.options, filters: { ...parsed.options.filters, extra: ["secret"] } }, { ...parsed.options, filters: { ...parsed.options.filters, q: 12 } }, { ...parsed.options, filters: { ...parsed.options.filters, cargo: [" docente "] } }];
  for (const options of invalid) { assert.equal(S.validSignatureExplorerOptions(options), false); assert.deepEqual(await S.readSignatureExplorer(actor, options as typeof parsed.options), { ok: false, error: "invalid" }); }
  assert.equal(S.validSignatureExplorerOptions(parsed.options), true);
});
