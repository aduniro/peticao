import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
const original = Buffer.from("%PDF-1.7\nQA fictitious original batch\n%%EOF");
const signed = (bytes: Buffer) => {
  const suffix = "\n/Type /Sig /SubFilter /adbe.pkcs7.detached /ByteRange [0 10 20 0000000000]\n%%EOF";
  const all = Buffer.concat([bytes, Buffer.from(suffix)]);
  return Buffer.from(all.toString().replace("0000000000", String(all.length - 20).padStart(10, "0")));
};

async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const U = await import("./admin-users"), B = await import("./batches");
  const user = await U.criarUsuario({ email: "qa-validator-owner@example.test", nome: "QA Total", nivel: "total", senha: "QA-Tests-2026-Ficticia" }); assert.ok(user.ok);
  const actor = { userId: user.usuario.id, email: user.usuario.email };
  const id = (await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) VALUES(999,'partial','prepared',0,0,$1,$2,$3,'none') RETURNING id", ["a".repeat(64), original, createHash("sha256").update(original).digest("hex")])).rows[0].id;
  return { db, B, actor, id };
}

test("adapter sem holder/malformado/outraentidade nunca promove upload a ICP e guarda de produção continua bloqueando", async () => {
  const c = await setup("t_holder_validation_flow"), oldFetch = globalThis.fetch, oldUrl = process.env.ICP_VALIDATOR_URL, oldCnpj = process.env.ICP_EXPECTED_CNPJ;
  process.env.ICP_VALIDATOR_URL = "https://validator.example.test/verify"; process.env.ICP_EXPECTED_CNPJ = "15883671000115";
  try {
    const upload = signed(original);
    for (const payload of [{ valid: true }, { valid: true, cnpj: "15883671000116" }, { valid: true, cnpj: 15883671000115 }, { valid: true, cnpj: "15883671000115", signer: { invalid: "QA" } }]) {
      globalThis.fetch = (async () => Response.json(payload)) as typeof fetch;
      const result = await c.B.attachSignedPdf(c.id, upload, c.actor.email, c.actor);
      assert.equal(result.kind, "externa-nao-validada"); assert.ok(!result.notes.join(" ").includes("[object Object]"));
      (process.env as Record<string, string>).NODE_ENV = "production";
      const approve = await c.B.approveAndSend(c.id, "000000", c.actor.email, c.actor);
      assert.equal(approve.ok, false); if (!approve.ok) assert.match(approve.reason, /ICP-Brasil/);
      (process.env as Record<string, string>).NODE_ENV = "test";
      assert.equal((await c.db.query("SELECT count(*)::int n FROM batch_sends")).rows[0].n, 0);
    }
    globalThis.fetch = (async () => Response.json({ valid: true, cnpj: "15.883.671/0001-15", signer: "QA ADUNIR" })) as typeof fetch;
    const admitted = await c.B.attachSignedPdf(c.id, upload, c.actor.email, c.actor); assert.equal(admitted.kind, "icp-brasil");
    const stored = (await c.db.query("SELECT pdf,signed_pdf FROM batches WHERE id=$1", [c.id])).rows[0]; assert.deepEqual(stored.pdf, original); assert.deepEqual(stored.signed_pdf, upload);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally {
    (process.env as Record<string, string>).NODE_ENV = "test"; globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.ICP_VALIDATOR_URL; else process.env.ICP_VALIDATOR_URL = oldUrl;
    if (oldCnpj === undefined) delete process.env.ICP_EXPECTED_CNPJ; else process.env.ICP_EXPECTED_CNPJ = oldCnpj;
    await c.db._closeDbForTests();
  }
});

test("PDF regravado com outro prefixo permanece recusado antes da chamada ao adapter, sem alegar que todo PAdES mantém prefixo", async () => {
  const c = await setup("t_holder_original_prefix"), oldFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => { calls++; return Response.json({ valid: true, cnpj: "15883671000115" }); }) as typeof fetch;
    const altered = signed(Buffer.from("%PDF-1.7\nQA different original\n%%EOF"));
    const result = await c.B.attachSignedPdf(c.id, altered, c.actor.email, c.actor); assert.equal(result.ok, false); assert.equal(calls, 0);
    const stored = (await c.db.query("SELECT pdf,signed_pdf,signature_kind FROM batches WHERE id=$1", [c.id])).rows[0]; assert.deepEqual(stored.pdf, original); assert.equal(stored.signed_pdf, null); assert.equal(stored.signature_kind, "none");
  } finally { globalThis.fetch = oldFetch; await c.db._closeDbForTests(); }
});
