import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("validação do e-mail por categoria (servidor x apoiador), sem efeitos colaterais", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_email_validate");
  const { validateEmailField } = await import("./email-validate");
  const { _setMxResolverForTests } = await import("./email-check");
  const semMx = new Set(["ufpel.edu.gov", "gmial.com", "ufpa.edu.br", "ifro.edu.be"]);
  _setMxResolverForTests(async (d) => (semMx.has(d) ? "none" : "ok"));
  const before = ((await dbmod.query("SELECT count(*)::int n FROM institutional_domains")).rows[0] as any).n;
  try {
    // servidor
    assert.deepEqual(await validateEmailField("maria@unir.br", "servidor"), { ok: true });
    assert.deepEqual(await validateEmailField("maria@gmail.com", "servidor"), { ok: false, code: "server_email_not_institutional" });
    assert.deepEqual(await validateEmailField("maria@ufpel.edu.gov", "servidor"), { ok: false, code: "email_institutional_invalid", suggest: "maria@ufpel.edu.br" });
    assert.deepEqual(await validateEmailField("catia@ufpa.edu.br", "servidor"), { ok: false, code: "email_institutional_invalid", suggest: "catia@ufpa.br" }); // domínio da lista, mas sem servidor de e-mail
    assert.equal(((await validateEmailField("x@semcara-de-instituicao.org", "servidor")) as any).code, "server_email_not_institutional");
    assert.equal(((await validateEmailField("com acento@unir.br", "servidor")) as any).code, "email_invalid");
    // apoiador
    assert.deepEqual(await validateEmailField("joao@gmial.com", "apoiador"), { ok: false, code: "email_provider_invalid", suggest: "joao@gmail.com" });
    assert.deepEqual(await validateEmailField("joao@unir.br", "apoiador"), { ok: false, code: "apoiador_institutional_email" });
    assert.deepEqual(await validateEmailField("joao@gmail.com", "apoiador"), { ok: true });
    assert.deepEqual(await validateEmailField("joao@empresa-xyz.com.br", "apoiador"), { ok: true });
    // nenhuma gravação (fila de revisão de domínios intacta)
    assert.equal(((await dbmod.query("SELECT count(*)::int n FROM institutional_domains")).rows[0] as any).n, before);
  } finally { _setMxResolverForTests(null); }
});
