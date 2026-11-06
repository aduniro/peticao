import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_PROVIDERS = "dev";
process.env.MAIL_OUTBOX_DIR = mkdtempSync(join(tmpdir(), "cpf-name-wa-"));
process.env.SECRETS_DIR = "/nao-existe-cpf-name-test";
process.env.CPF_FORCE_MOCK = "1";
// WhatsApp must not bypass the challenge when the general form switch is off.
process.env.IDENTITY_CHECK_MODE = "off";

test("WhatsApp: CPF, nome e nascimento ou mãe obrigatórios; sem alterar nome/hash/data original", async () => {
  const db = await import("./db"); await db._openForTests("t_cpf_name_wa");
  const { sha256, hmac } = await import("./security");
  const { _setWaProviderForTests } = await import("./whatsapp/provider");
  const { POST } = await import("../app/api/confirmar/whatsapp/route");
  _setWaProviderForTests({ name: "fixture", async send() { return { id: "fixture" }; } });
  process.env.CPF_MOCK_DATA = JSON.stringify({
    "52998224725": { nome: "ANA PAULA DE SOUZA LIMA", mae: "HELENA MARIA SOUZA", nasc: "01/02/1990" },
    "11144477735": { nome: "JOAO PEDRO PEREIRA LIMA", mae: "MARIA HELENA PEREIRA", nasc: "01/02/1990" },
  });
  const created = "2026-11-01T10:00:00.000Z";
  const insert = async (name: string, cpf: string | null, token: string, category = "apoiador") => {
    return (await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,wa_token_hash,wa_token_expires_at) VALUES($1,$2,$3,$4,$5,'fixture',$6,'pending',$6,$7,now()+interval '1 day') RETURNING id", [name, token + "@fixture.example", hmac(token), cpf ? hmac(cpf) : null, category, created, sha256(token)])).rows[0].id;
  };
  const post = async (token: string, extra: object = {}) => {
    const response = await POST(new NextRequest("http://localhost/api/confirmar/whatsapp", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.24.1.1" }, body: JSON.stringify({ token, ...extra }) }));
    return { status: response.status, json: await response.json() };
  };
  try {
    const cpf = "52998224725", token = "fixture-wa-token-1";
    const id = await insert("Ana Paula Souza Lima", cpf, token);
    assert.equal((await post(token, { cpf })).json.code, "bad_input", "nome completo também exige desafio");
    assert.equal((await post(token, { cpf: "11144477735", method: "nascimento", value: "01/02/1990" })).json.result, "cpf_mismatch");
    assert.equal((await post(token, { cpf, method: "nascimento", value: "02/02/1990" })).json.code, "mismatch");
    await db.query("UPDATE signatures SET name='Ana Carla Lima' WHERE id=$1", [id]);
    assert.equal((await post(token, { cpf, method: "nascimento", value: "01/02/1990" })).json.result, "review_required");
    assert.equal((await db.query("SELECT status FROM signatures WHERE id=$1", [id])).rows[0].status, "pending");
    await db.query("UPDATE signatures SET name='Ana Paula Souza Lima' WHERE id=$1", [id]);

    const mock = process.env.CPF_MOCK_DATA;
    delete process.env.CPF_MOCK_DATA;
    assert.equal((await post(token, { cpf, method: "nascimento", value: "01/02/1990" })).status, 503, "sem provedor não confirma mesmo com modo off");
    process.env.CPF_MOCK_DATA = mock;
    assert.equal((await post(token, { cpf, method: "nascimento", value: "01/02/1990" })).json.result, "ok");
    const saved = (await db.query("SELECT name,cpf_hash,created_at,status,confirmed_at FROM signatures WHERE id=$1", [id])).rows[0];
    assert.equal(saved.status, "confirmed"); assert.ok(saved.confirmed_at);
    assert.equal(saved.name, "Ana Paula Souza Lima"); assert.equal(saved.cpf_hash, hmac(cpf));
    assert.equal(new Date(saved.created_at).toISOString(), created);
    assert.equal((await post(token, { cpf, method: "nascimento", value: "01/02/1990" })).json.result, "invalid");

    const partial = "fixture-wa-token-2";
    await insert("Pedro Lima", "11144477735", partial);
    assert.equal((await post(partial, { cpf: "11144477735", method: "mae", value: "Maria Helena Pereira" })).json.result, "ok");
    const foreign = "fixture-wa-token-3";
    await insert("Foreign Fixture", null, foreign, "estrangeiro");
    assert.equal((await post(foreign)).json.result, "ok", "estrangeiros continuam sem CPF ou desafio");
  } finally {
    _setWaProviderForTests(null); await db._closeDbForTests();
    rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true });
  }
});
