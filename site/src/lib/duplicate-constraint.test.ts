import test from "node:test";
import assert from "node:assert/strict";
import { _setMxResolverForTests } from "./email-check";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("unexpected unique constraints propagate instead of reporting a successful signature", async () => {
  const db = await import("./db");
  await db._openForTests("t_duplicate_constraint");
  _setMxResolverForTests(async () => "ok");
  try {
    const { hmac } = await import("./security");
    const { submit, validate } = await import("./signatures");
    await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status) VALUES('Pessoa Fictícia','first@fixture.example',$1,$2,'apoiador','test','2026-11-01T00:00:00Z','confirmed')", [hmac("first@fixture.example"),hmac("11144477735")]);
    await db.query("CREATE UNIQUE INDEX unexpected_name_constraint ON signatures(name)");
    const validated = validate({ name: "Pessoa Fictícia", email: "other@fixture.example", cpf: "52998224725", category: "apoiador", city: "Porto Velho", uf: "RO", consent: true });
    assert.equal(validated.ok,true);
    if (!validated.ok) throw new Error("fixture invalid");
    await assert.rejects(submit(validated.value,{}), (error: any) => error.code === "23505" && error.constraint === "unexpected_name_constraint");
    assert.equal((await db.query("SELECT count(*)::int n FROM signatures")).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='signature_created'")).rows[0].n,0);
  } finally { _setMxResolverForTests(null);await db._closeDbForTests(); }
});
