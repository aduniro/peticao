import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("confirmação antiga: corrige apenas o nome, preserva cadastro/CPF e exige identidade para nomes parciais", async () => {
  const db = await import("./db"); await db._openForTests("t_confirmation_check");
  const { checkConfirmation } = await import("./confirmation-check");
  const { confirmFull } = await import("./signatures");
  const { hmac, sha256 } = await import("./security");
  const { cachedCpfProvider } = await import("./cpf-cache");
  const record = { nome: "ANA PAULA DE SOUZA LIMA", mae: "HELENA MARIA SOUZA", nasc: "01/02/1990" };
  let calls = 0;
  const provider = cachedCpfProvider({ name: "fixture", async lookup() { calls++; return record; } });
  const cpf = "52998224725", token = "fixture-legacy-recovery", created = "2026-11-01T10:00:00.000Z";
  try {
    const id = (await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,token_hash,token_expires_at) VALUES('Ana Carla Lima','ana@unir.br',$1,$2,'servidor','fixture',$3,'pending',$3,$4,now()+interval '1 day') RETURNING id", [hmac("fixture-email"), hmac(cpf), created, sha256(token)])).rows[0].id;
    const start = await checkConfirmation(token, "email", undefined, provider);
    assert.equal(start.ok, false);
    if (!start.ok) assert.deepEqual(start.json, { result: "review_required", name: "Ana Carla Lima" });
    const wrongCpf = await checkConfirmation(token, "email", { name: "Ana Paula Souza Lima", cpf: "11144477735" }, provider);
    if (!wrongCpf.ok) assert.equal(wrongCpf.json.result, "cpf_mismatch"); else assert.fail();
    assert.equal(calls, 0, "CPF diferente é rejeitado antes da consulta");
    const wrong = await checkConfirmation(token, "email", { name: "Ana Carla Lima", cpf, identity: { method: "nascimento", value: record.nasc } }, provider);
    if (!wrong.ok) assert.equal(wrong.json.result, "review_required"); else assert.fail();
    const partial = { name: "Paula Souza Lima", cpf };
    const challenge = await checkConfirmation(token, "email", partial, provider);
    if (!challenge.ok) assert.equal(challenge.json.result, "identity_required"); else assert.fail();
    const badDate = await checkConfirmation(token, "email", { ...partial, identity: { method: "nascimento", value: "02/02/1990" } }, provider);
    if (!badDate.ok) assert.equal(badDate.json.code, "mismatch"); else assert.fail();
    assert.equal((await db.query("SELECT name FROM signatures WHERE id=$1", [id])).rows[0].name, "Ana Carla Lima", "tentativas não alteram o cadastro");
    const accepted = await checkConfirmation(token, "email", { ...partial, identity: { method: "mae", value: record.mae } }, provider);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) assert.fail();
    const confirmed = await confirmFull(token, {}, "email", accepted.proof);
    assert.equal(confirmed.result, "ok");
    const row = (await db.query("SELECT name,cpf_hash,created_at,consent_at,confirmed_at,status,identity_method,cpf_name_check FROM signatures WHERE id=$1", [id])).rows[0];
    assert.deepEqual({ name: row.name, hash: row.cpf_hash, created: row.created_at, consent: row.consent_at, status: row.status, method: row.identity_method, check: row.cpf_name_check }, { name: "Paula Souza Lima", hash: hmac(cpf), created, consent: created, status: "confirmed", method: "mae", check: "match" });
    assert.ok(row.confirmed_at);
    const audit = (await db.query("SELECT data FROM audit_log WHERE signature_id=$1 AND event='signature_name_corrected'", [id])).rows[0];
    assert.deepEqual(JSON.parse(audit.data), { before: "Ana Carla Lima", after: "Paula Souza Lima", channel: "email", cpfHashUnchanged: true });
    const repeated = await checkConfirmation(token, "email", partial, provider);
    if (!repeated.ok) assert.equal(repeated.json.result, "invalid"); else assert.fail();
    assert.equal(calls, 1);
  } finally { await db._closeDbForTests(); }
});

test("confirmação antiga: token vencido/inválido e alteração concorrente nunca aplicam correção", async () => {
  const db = await import("./db"); await db._openForTests("t_confirmation_stale");
  const { checkConfirmation } = await import("./confirmation-check");
  const { confirmFull } = await import("./signatures");
  const { sha256, hmac } = await import("./security");
  const { cachedCpfProvider } = await import("./cpf-cache");
  let calls = 0;
  const provider = cachedCpfProvider({ name: "fixture", async lookup() { calls++; return { nome: "ANA PAULA SOUZA LIMA", mae: null, nasc: null }; } });
  const token = "fixture-stale-token", cpf = "52998224725";
  try {
    const id = (await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,token_hash,token_expires_at) VALUES('Ana Paula Souza Lima','ana@unir.br',$1,$2,'servidor','fixture',now(),'pending',$3,now()-interval '1 hour') RETURNING id", [hmac("stale-email"), hmac(cpf), sha256(token)])).rows[0].id;
    for (const [value, expected] of [[token, "expired"], ["invalid-token", "invalid"]]) {
      const r = await checkConfirmation(value, "email", { name: "Ana Paula Souza Lima", cpf }, provider);
      if (!r.ok) assert.equal(r.json.result, expected); else assert.fail();
    }
    assert.equal(calls, 0);
    await db.query("UPDATE signatures SET token_expires_at=(now()+interval '1 day')::text WHERE id=$1", [id]);
    const checked = await checkConfirmation(token, "email", { name: "Ana Paula Souza Lima", cpf }, provider);
    if (!checked.ok) assert.fail();
    await db.query("UPDATE signatures SET name='Nome Alterado' WHERE id=$1", [id]);
    assert.equal((await confirmFull(token, {}, "email", checked.proof)).result, "invalid");
    assert.equal((await db.query("SELECT status FROM signatures WHERE id=$1", [id])).rows[0].status, "pending");
  } finally { await db._closeDbForTests(); }
});

test("histórico de identidade: conserva 8–30 dias, remove mais antigos e mantém limite de 24 horas", async () => {
  const db = await import("./db"); await db._openForTests("t_identity_retention");
  const { purgeIdentityAttempts, verifyCpfName } = await import("./identity");
  const { hmac } = await import("./security");
  const cpf = "52998224725";
  try {
    for (const days of [1, 8, 29, 31]) await db.query("INSERT INTO identity_attempts(cpf_hash,method,ok,ts) VALUES($1,'nome',false,$2)", [hmac(cpf), new Date(Date.now() - days * 86400_000).toISOString()]);
    assert.equal(await purgeIdentityAttempts(), 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM identity_attempts")).rows[0].n, 3);
    const result = await verifyCpfName({ cpf, declaredName: "Ana Lima", provider: { name: "fixture", async lookup() { return { nome: "ANA LIMA", mae: null, nasc: null }; } } });
    assert.equal(result.ok, true, "erros fora de 24h não bloqueiam");
  } finally { await db._closeDbForTests(); }
});
