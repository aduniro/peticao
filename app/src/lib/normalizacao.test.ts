import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "./signatures";
import { handleSign } from "./sign-flow";
import { isValidCpf } from "./cpf";

(process.env as Record<string, string>).NODE_ENV = "test";

const base = { name: "mAria DA sILVA souza", email: "MARIA.Silva@GMAIL.com", cpf: "529.982.247-25", category: "apoiador", city: "Porto Velho", uf: "RO", consent: true };

test("servidor grava nome normalizado e e-mail em minúsculas, mesmo que o navegador envie diferente", () => {
  const v = validate(base);
  assert.ok(v.ok);
  if (v.ok) { assert.equal(v.value.name, "Maria da Silva Souza"); assert.equal(v.value.email, "maria.silva@gmail.com"); }
  const v2 = validate({ ...base, name: "  JOÃO   DOS   SANTOS  ", email: "  JOAO@UNIR.BR " });
  assert.ok(v2.ok); if (v2.ok) { assert.equal(v2.value.name, "João dos Santos"); assert.equal(v2.value.email, "joao@unir.br"); }
  const v3 = validate({ ...base, name: "Luigi D'ANGELO" }); assert.ok(v3.ok); if (v3.ok) assert.equal(v3.value.name, "Luigi D'Angelo");
});

test("CPF matematicamente inválido: recusado antes de qualquer consulta à CPF Brasil", async () => {
  let calls = 0;
  const provider = { name: "espião", async lookup() { calls++; return { kind: "not_found" } as never; } } as never;
  for (const cpf of ["529.982.247-26", "111.111.111-11", "123", ""]) {
    const r = await handleSign({ ...base, cpf }, { ip: "1.2.3.4" }, provider);
    assert.equal(r.status, 422, cpf);
    assert.deepEqual((r.json as { errors: Record<string, string> }).errors.cpf, "cpf_invalid", cpf);
  }
  assert.equal(calls, 0); // nenhum crédito gasto
  assert.ok(isValidCpf("529.982.247-25") && !isValidCpf("529.982.247-26"));
});
