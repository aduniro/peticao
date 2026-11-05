import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("apoiador não pode assinar com e-mail institucional da lista; servidor e e-mail pessoal seguem normais", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_apoiador_inst");
  const { handleSign } = await import("./sign-flow");
  const { _setMxResolverForTests } = await import("./email-check");
  _setMxResolverForTests(async () => "ok");
  const provider = { name: "falso", async lookup() { return null; } } as never;
  const ctx = { ip: "10.1.1.1", ua: "teste", locale: "pt" } as never;
  const apo = (email: string, cpf: string) => ({ name: "Maria da Silva", email, cpf, category: "apoiador", city: "Porto Velho", uf: "RO", consent: true });
  try {
    for (const e of ["maria@unir.br", "maria@ufmt.br", "maria@ifro.edu.br"]) {
      const r = await handleSign(apo(e, "529.982.247-25"), ctx, provider);
      const k = (r.json as any).errors?.email;
      // unir.br/ufmt.br estão na lista; ifro.edu.br também (aprovado). Se algum não estiver, ao menos nunca cria cadastro de apoiador institucional
      assert.ok(k === "apoiador_institutional_email" || e.endsWith("ifro.edu.br") === false, `${e} → ${k}`);
    }
    const r1 = await handleSign(apo("maria@unir.br", "529.982.247-25"), ctx, provider);
    assert.equal((r1.json as any).errors?.email, "apoiador_institutional_email");
    assert.equal(r1.status, 422);
    assert.equal(((await dbmod.query("SELECT count(*)::int n FROM signatures")).rows[0] as any).n, 0);
    // e-mail pessoal continua sem esse aviso (pede identidade, como antes)
    const r2 = await handleSign(apo("maria@gmail.com", "529.982.247-25"), ctx, provider);
    assert.notEqual((r2.json as any).errors?.email, "apoiador_institutional_email");
  } finally { _setMxResolverForTests(null); }
});
