import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("servidor: CPF obrigatório — o nome precisa conferir com o cadastro do CPF (sem nome da mãe nem nascimento)", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_cpf_servidor");
  const { handleSign } = await import("./sign-flow");
  const { _setMxResolverForTests } = await import("./email-check");
  const { ProviderUnavailable } = await import("./cpf-check");
  _setMxResolverForTests(async () => "ok");
  const ctx = { ip: "10.2.2.2", ua: "teste", locale: "pt" } as never;
  const provider = { name: "teste", lookup: async (cpf: string) => {
    const nome = ({ "52998224725": "MARIA DA SILVA SANTOS", "11144477735": "JOAO PEREIRA LIMA" } as Record<string, string>)[cpf];
    return nome ? { nome, mae: null, nasc: null } : null;
  } };
  const sv = (name: string, email: string, cpf: string) => ({ name, email, cpf, category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true });
  const count = async () => ((await dbmod.query("SELECT count(*)::int n FROM signatures")).rows[0] as any).n;
  try {
    // confere (tolerante a acento, "da" e nome do meio): cria a assinatura com a marca de CPF conferido
    const ok = await handleSign(sv("Maria Silva Santos", "maria@unir.br", "529.982.247-25"), ctx, provider);
    assert.equal(ok.status, 200); assert.equal((ok.json as any).identityRequired, undefined, "servidor não recebe a janela de nome da mãe/nascimento");
    assert.equal((await dbmod.query<any>("SELECT cpf_name_check FROM signatures WHERE email='maria@unir.br'")).rows[0].cpf_name_check, "match");
    // CPF válido, mas de outra pessoa: recusado, nada gravado
    const n0 = await count();
    const bad = await handleSign(sv("Carlos Eduardo Tavares", "carlos@unir.br", "111.444.777-35"), ctx, provider);
    assert.deepEqual([bad.status, (bad.json as any).errors?.name], [422, "name_cpf_mismatch"]);
    assert.equal(await count(), n0);
    // CPF que não existe na base
    const nf = await handleSign(sv("Pedro Souza Costa", "pedro@unir.br", "390.533.447-05"), ctx, { ...provider, name: "synthetic-registry" });
    assert.equal((nf.json as any).errors?.cpf, "cpf_not_found");
    // serviço fora do ar: 503, sem assinatura
    const down = { name: "cpf-brasil", lookup: async () => { throw new ProviderUnavailable("QUOTA"); } } as never;
    const un = await handleSign(sv("Ana Lima Souza", "ana@unir.br", "123.456.789-09"), ctx, down);
    assert.deepEqual([un.status, (un.json as any).errorCode], [503, "cpf_check_unavailable"]);
    assert.equal(await count(), n0);
    // 5 recusas travam o CPF por 24 h
    for (const nome of ["Fulano Beltrano Ciclano", "Zeca Pagodinho Neto", "Rita Cadillac Moura", "Tiao Carreiro Pardinho"]) await handleSign(sv(nome, `${nome.split(" ")[0].toLowerCase()}@unir.br`, "111.444.777-35"), ctx, provider);
    const lk = await handleSign(sv("Zumbi Dos Palmares Filho", "lk@unir.br", "111.444.777-35"), ctx, provider);
    assert.equal(lk.status, 429); assert.equal((lk.json as any).errors?.cpf, "cpf_locked");
    // sem provedor (modo desligado, ex.: desenvolvimento): segue como antes
    const off = await handleSign(sv("Qualquer Nome Aqui", "off@unir.br", "529.982.247-25"), ctx, null);
    assert.equal(off.status, 200);
  } finally { _setMxResolverForTests(null); }
});
