import test from "node:test";
import assert from "node:assert/strict";
import { verifyIcpBrasil } from "./signed-pdf";

test("validador ICP exige aprovação booleana explícita", async () => {
  const previous = process.env.ICP_VALIDATOR_URL;
  process.env.ICP_VALIDATOR_URL = "https://validator.example.test/verify";
  const response = (valid: unknown) => (async () => Response.json({ valid, signer: "QA signer" })) as typeof fetch;
  try {
    for (const value of ["false", "true", 1, 0, [], {}, null, undefined, false]) {
      const result = await verifyIcpBrasil(Buffer.from("%PDF-QA"), response(value));
      assert.equal(result.valid, false, `Não aceitar valid=${JSON.stringify(value)}`);
      assert.equal(result.reason, "Assinatura inválida segundo o validador.");
    }
    assert.deepEqual(await verifyIcpBrasil(Buffer.from("%PDF-QA"), response(true)), {
      valid: true, signer: "QA signer", reason: undefined,
    });
  } finally {
    if (previous === undefined) delete process.env.ICP_VALIDATOR_URL;
    else process.env.ICP_VALIDATOR_URL = previous;
  }
});

test("aprovação estrita preserva a conferência do CNPJ informado", async () => {
  const previousUrl = process.env.ICP_VALIDATOR_URL;
  const previousCnpj = process.env.ICP_EXPECTED_CNPJ;
  process.env.ICP_VALIDATOR_URL = "https://validator.example.test/verify";
  process.env.ICP_EXPECTED_CNPJ = "00000000000001";
  const response = (cnpj: string) => (async () => Response.json({ valid: true, cnpj })) as typeof fetch;
  try {
    assert.equal((await verifyIcpBrasil(Buffer.from("%PDF-QA"), response("00.000.000/0000-01"))).valid, true);
    assert.deepEqual(await verifyIcpBrasil(Buffer.from("%PDF-QA"), response("00.000.000/0000-02")), {
      valid: false, reason: "A assinatura é válida, mas não é do e-CNPJ da ADUNIR.",
    });
  } finally {
    if (previousUrl === undefined) delete process.env.ICP_VALIDATOR_URL;
    else process.env.ICP_VALIDATOR_URL = previousUrl;
    if (previousCnpj === undefined) delete process.env.ICP_EXPECTED_CNPJ;
    else process.env.ICP_EXPECTED_CNPJ = previousCnpj;
  }
});
