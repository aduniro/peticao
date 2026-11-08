import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL), database = new URL(process.env.DATABASE_URL);
assert.equal(base.origin, "http://127.0.0.1:3033"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54349");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts"), db = dm.default ?? dm, U = um.default ?? um;
const tokens = [];
try {
  const actor = async nivel => {
    const created = await U.criarUsuario({ email: `qa-document-${nivel}@example.test`, nome: "QA Documento", nivel, senha: "Ficticia-Controle-Lotes-2026" }); assert.ok(created.ok);
    const token = (await U.abrirSessao(created.usuario.id, "127.0.0.1")).token; tokens.push(token); return { id: created.usuario.id, token };
  };
  const total = await actor("total"), reader = await actor("leitura");
  await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf) VALUES(1,'partial','prepared',0,1,'QA-FIXED-LIST',decode('255044462d5141','hex'))");
  const documents = async () => (await db.query("SELECT row_to_json(b)::text raw FROM batches b")).rows;
  const before = await documents();
  const request = (path, user, body, origin = base.origin) => fetch(new URL(path, base), { redirect: "manual", method: body === undefined ? "GET" : "POST", headers: { origin, cookie: user ? `adm=${user.token}` : "", "content-type": "application/x-www-form-urlencoded" }, ...(body === undefined ? {} : { body }) });
  assert.equal((await request("/admin/lotes", null)).status, 307);
  assert.equal((await request("/admin/lotes", reader)).status, 307);
  const confirmation = await request("/admin/lotes", total); assert.equal(confirmation.status, 307); assert.ok(confirmation.headers.get("location").includes("/admin/confirmar?volta=/admin/lotes"));
  for (const path of ["pausa", "criar", "1/codigo", "1/aprovar", "1/assinado", "1/cancelar"]) {
    const denied = await request(`/api/admin/lotes/${path}`, total, ""); assert.equal(denied.status, 403); assert.equal((await denied.json()).erro, "stepup");
  }
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [total.id]);
  const readControl = async () => {
    const page = await request("/admin/lotes", total); assert.equal(page.status, 200); const html = await page.text();
    for (const text of ["Lotes", "Pausar todos os envios", "Fechar lote final agora", "Enviar código ao aprovador"]) assert.ok(html.includes(text));
    const version = /name="version" value="([a-f0-9]{64})"/.exec(html)?.[1]; assert.ok(version); return version;
  };
  const version = await readControl(), body = new URLSearchParams({ enabled: "false", version }).toString();
  assert.equal((await request("/api/admin/lotes/pausa", total, "")).status, 400);
  assert.equal((await request("/api/admin/lotes/pausa", total, "x".repeat(1025))).status, 413);
  assert.equal((await request("/api/admin/lotes/pausa", total, body, "https://other.example.test")).status, 403);
  const concurrent = await Promise.all([request("/api/admin/lotes/pausa", total, body), request("/api/admin/lotes/pausa", total, body)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [303, 409]);
  assert.equal((await db.query("SELECT value FROM settings WHERE key='sending_enabled'")).rows[0].value, "false");
  const event = JSON.parse((await db.query("SELECT data FROM audit_log WHERE event='sending_toggled'")).rows[0].data); assert.equal(event.userId, total.id);
  assert.deepEqual(await documents(), before); assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount, 0);
  assert.ok((await db.verifyAuditChain()).ok);
  const report = { ok: true, compiledHttp: true, roleAndStepup: true, unchangedVisibleControls: true, concurrentExplicitPause: true, staleConflict: true, boundedBodyAndOrigin: true, documentsUnchanged: true, noMailOrSignerWrites: true };
  await writeFile(`${process.env.QA_OUTPUT_DIR}/batch-control.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests(); }
