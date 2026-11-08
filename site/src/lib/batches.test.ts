import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { assertSendable } from "./signer";

const actor = { userId: 1, email: "qa-batch-session@example.test" };

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-bat-${process.pid}`);
process.env.BATCH_SIZE = "3";
process.env.APPROVER_EMAIL = "aprovador@exemplo.org";
process.env.RECIPIENTS = "autoridade1@exemplo.org,autoridade2@exemplo.org";
process.env.SIGNER = "none";

const mails = (dir: string) => readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

async function seed(dbmod: typeof import("./db"), n: number, startAt = 0) {
  const { hmac } = await import("./security");
  for (let i = startAt; i < startAt + n; i++) {
    await dbmod.query(
      `INSERT INTO signatures(name,email,email_hash,cpf_hash,category,institution,role,city,uf,text_version,consent_at,status,confirmed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'v','2026-10-29T00:00:00Z','confirmed',$10)`,
      [`Pessoa Número ${i} Ç`, `p${i}@x.org`, hmac(`e${i}`), hmac(`c${i}`), i % 2 ? "servidor" : "apoiador",
       i % 2 ? "UNIR" : null, i % 2 ? "docente" : null, i % 2 ? null : "Manaus", i % 2 ? null : "AM", new Date(2026, 9, 29, 12, 0, i).toISOString()]
    );
  }
}

test("guarda de assinatura: produção só envia PDF ICP-Brasil", () => {
  assert.throws(() => assertSendable("none", "production"));
  assert.throws(() => assertSendable(null, "production"));
  assert.doesNotThrow(() => assertSendable("icp-brasil", "production"));
  assert.doesNotThrow(() => assertSendable("none", "development"));
  process.env.PREVIEW_MODE = "1";
  try { assert.doesNotThrow(() => assertSendable("none", "production")); } finally { delete process.env.PREVIEW_MODE; }
});

test("lotes: meta, PDF, aprovação em duas etapas, envio, pausa e lote final acumulado", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_lotes");
  await dbmod.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Session','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
  const OUTBOX_DIR = (await import("./mail")).outboxDir();
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
  const b = await import("./batches");

  await seed(dbmod, 2);
  assert.deepEqual((await b.tick()).created, []); // abaixo da meta

  await seed(dbmod, 1, 2);
  const t = await b.tick();
  assert.equal(t.created.length, 1);
  const batch = (await b.getBatch(t.created[0]))!;
  assert.equal(batch.status, "prepared");
  assert.equal(batch.n_servidor + batch.n_apoiador, 3);
  assert.equal(batch.signature_kind, "none");
  const pdf = (await dbmod.query<{ pdf: Buffer }>("SELECT pdf FROM batches WHERE id=$1", [batch.id])).rows[0].pdf;
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures WHERE batch_id IS NULL")).rows[0].n, 0);
  assert.equal(mails(OUTBOX_DIR).filter((m) => m.to === "aprovador@exemplo.org" && /pronto para aprovação/.test(m.subject)).length, 1);

  // sem código: recusa
  assert.equal((await b.approveAndSend(batch.id, "000000", "x", actor)).ok, false);
  await b.requestApprovalCode(batch.id, actor);
  const code = /Código de aprovação do lote \d+: (\d{6})/.exec(mails(OUTBOX_DIR).at(-1)!.text)![1];
  const wrong = code === "123456" ? "654321" : "123456";
  assert.deepEqual(await b.approveAndSend(batch.id, wrong, "x", actor), { ok: false, reason: "Código incorreto." });

  // pausa global bloqueia
  await b.setSetting("sending_enabled", "false");
  assert.equal((await b.approveAndSend(batch.id, code, "x", actor)).ok, false);
  await b.setSetting("sending_enabled", "true");

  const sentBefore = mails(OUTBOX_DIR).filter((m) => m.attachments?.length).length;
  const r = await b.approveAndSend(batch.id, code, "aprovador@exemplo.org", actor);
  assert.deepEqual(r, { ok: true, sent: 2, failed: 0 });
  const withPdf = mails(OUTBOX_DIR).filter((m) => m.attachments?.length);
  assert.equal(withPdf.length, sentBefore + 2);
  const stored = (await b.getBatch(batch.id))!.pdf_sha256;
  assert.equal(withPdf.at(-1).attachments[0].sha256, stored); // o anexo enviado tem o mesmo hash registrado
  assert.equal(createHash("sha256").update(pdf).digest("hex"), stored);
  assert.equal((await b.getBatch(batch.id))!.status, "sent");
  // reuso do código / reenvio: recusado
  assert.equal((await b.approveAndSend(batch.id, code, "x", actor)).ok, false);

  // lote final é acumulado (inclui os já enviados) e só existe um
  await seed(dbmod, 1, 3);
  const f = (await b.createBatch("final"))!;
  assert.equal(f.kind, "final");
  assert.equal(f.n_servidor + f.n_apoiador, 4);
  assert.equal(await b.createBatch("final"), null);

  assert.equal((await dbmod.verifyAuditChain()).ok, true);
  await dbmod._closeDbForTests();
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
});

test("lotes: destinatário .gov.br é bloqueado fora de produção", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_lotes_gov");
  await dbmod.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Session','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
  const OUTBOX_DIR = (await import("./mail")).outboxDir();
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
  process.env.RECIPIENTS = "gabinete@presidencia.gov.br";
  const b = await import("./batches");
  await seed(dbmod, 3);
  const id = (await b.tick()).created[0];
  await b.requestApprovalCode(id, actor);
  const code = /: (\d{6})/.exec(mails(OUTBOX_DIR).at(-1)!.subject)![1];
  const r = await b.approveAndSend(id, code, "x", actor);
  assert.deepEqual(r, { ok: true, sent: 0, failed: 1 });
  assert.equal((await b.getBatch(id))!.status, "failed");
  assert.equal(mails(OUTBOX_DIR).filter((m) => m.to.endsWith(".gov.br")).length, 0);
  process.env.RECIPIENTS = "autoridade1@exemplo.org,autoridade2@exemplo.org";
  await dbmod._closeDbForTests();
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
});

/** Monta um PDF "assinado" de mentira (atualização incremental com dicionário de assinatura e /ByteRange coerente). */
function fakeSigned(original: Buffer, opts: { subfilter?: string; breakRange?: boolean } = {}): Buffer {
  const body = (len: number) => `\n9999 0 obj\n<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/${opts.subfilter ?? "adbe.pkcs7.detached"}/ByteRange[0 0000000100 0000000200 ${String(opts.breakRange ? len - 7 : len - 200).padStart(10, "0")}]/Contents<00>>>\nendobj\n%%EOF\n`;
  const total = original.length + Buffer.byteLength(body(original.length + 500));
  return Buffer.concat([original, Buffer.from(body(total))]);
}

test("PDF assinado: verificação estrutural, validador plugável e bloqueio em produção", async () => {
  const { checkSignedPdf, verifyIcpBrasil } = await import("./signed-pdf");
  const dbmod = await import("./db");
  await dbmod._openForTests("t_signed");
  await dbmod.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,$1,'QA Session','total','QA-NOT-A-LOGIN-HASH')", [actor.email]);
  const { OUTBOX_DIR: _o } = { OUTBOX_DIR: (await import("./mail")).outboxDir() };
  const b = await import("./batches");
  rmSync(_o, { recursive: true, force: true });
  await seed(dbmod, 3);
  const id = (await b.tick()).created[0];
  const orig = (await dbmod.query<{ pdf: Buffer }>("SELECT pdf FROM batches WHERE id=$1", [id])).rows[0].pdf;

  // estrutura: aceita o incremental coerente; recusa arquivo diferente, sem assinatura, subfilter estranho, alterado depois
  assert.equal(checkSignedPdf(orig, fakeSigned(orig)).ok, true);
  assert.equal(checkSignedPdf(orig, orig).ok, false); // sem assinatura
  assert.equal(checkSignedPdf(orig, Buffer.concat([Buffer.from("%PDF-1.7 outro"), fakeSigned(orig)])).ok, false); // não contém o original
  assert.equal(checkSignedPdf(orig, fakeSigned(orig, { subfilter: "foo.bar" })).ok, false);
  assert.equal(checkSignedPdf(orig, fakeSigned(orig, { breakRange: true })).ok, false); // ByteRange não cobre o arquivo todo
  assert.equal(checkSignedPdf(orig, Buffer.from("não sou pdf")).ok, false);

  // sem validador configurado: anexa, mas NÃO vira icp-brasil
  delete process.env.ICP_VALIDATOR_URL;
  const bad = await b.attachSignedPdf(id, orig, "x", actor);
  assert.equal(bad.ok, false);
  const r1 = await b.attachSignedPdf(id, fakeSigned(orig), "x", actor);
  assert.deepEqual([r1.ok, r1.kind], [true, "externa-nao-validada"]);
  assert.match(r1.notes.join(" "), /não configurado/);

  // validador plugável (simulado): válido + CNPJ da ADUNIR → icp-brasil; CNPJ de outro → recusa
  const mk = (j: unknown, status = 200) => (async () => new Response(JSON.stringify(j), { status })) as typeof fetch;
  process.env.ICP_VALIDATOR_URL = "http://validador.local/verificar";
  assert.deepEqual(await verifyIcpBrasil(orig, mk({ valid: true, signer: "ADUNIR", cnpj: "15.883.671/0001-15" })), { valid: true, signer: "ADUNIR", reason: undefined });
  assert.equal((await verifyIcpBrasil(orig, mk({ valid: true, cnpj: "00.000.000/0001-91" }))).valid, false);
  assert.equal((await verifyIcpBrasil(orig, mk({ valid: false }))).valid, false);
  assert.equal((await verifyIcpBrasil(orig, mk({}, 500))).valid, false);
  assert.equal((await verifyIcpBrasil(orig, (async () => { throw new Error("x"); }) as unknown as typeof fetch)).valid, false);
  delete process.env.ICP_VALIDATOR_URL;

  // envio: usa o PDF assinado; em produção só "icp-brasil" passa
  const row = () => dbmod.query<{ signature_kind: string; signed_pdf_sha256: string }>("SELECT signature_kind,signed_pdf_sha256 FROM batches WHERE id=$1", [id]).then((r) => r.rows[0]);
  assert.equal((await row()).signature_kind, "externa-nao-validada");
  await b.requestApprovalCode(id, actor);
  const code = /: (\d{6})/.exec(JSON.parse(readFileSync(join(_o, readdirSync(_o).sort().at(-1)!), "utf8")).subject)![1];
  const sent = await b.approveAndSend(id, code, "x", actor);
  assert.deepEqual(sent, { ok: true, sent: 2, failed: 0 });
  const withPdf = readdirSync(_o).sort().map((f) => JSON.parse(readFileSync(join(_o, f), "utf8"))).filter((m) => m.attachments?.length);
  assert.equal(withPdf.at(-1).attachments[0].sha256, (await row()).signed_pdf_sha256); // o anexo é o PDF assinado
  assert.match(withPdf.at(-1).attachments[0].filename, /-assinado\.pdf$/);
  assert.match(withPdf.at(-1).text, /TESTE, sem assinatura digital válida/); // não afirma ICP-Brasil sem validar
  assert.throws(() => assertSendable("externa-nao-validada", "production"));
  assert.doesNotThrow(() => assertSendable("icp-brasil", "production"));

  await dbmod._closeDbForTests();
  rmSync(_o, { recursive: true, force: true });
});
