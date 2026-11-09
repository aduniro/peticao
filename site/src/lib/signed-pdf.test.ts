import test from "node:test";
import assert from "node:assert/strict";
import { verifyIcpBrasil } from "./signed-pdf";

test("validador ICP exige aprovação booleana explícita", async () => {
  const previous = process.env.ICP_VALIDATOR_URL;
  process.env.ICP_VALIDATOR_URL = "https://validator.example.test/verify";
  const response = (valid: unknown) => (async () => Response.json({ valid, signer: "QA signer", cnpj: "15883671000115" })) as typeof fetch;
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

test("e-CNPJ ADUNIR exige identidade correspondente mesmo se o adapter declara valid=true", async () => {
  const oldUrl = process.env.ICP_VALIDATOR_URL, oldCnpj = process.env.ICP_EXPECTED_CNPJ;
  process.env.ICP_VALIDATOR_URL = "https://validator.example.test/verify";
  process.env.ICP_EXPECTED_CNPJ = "15.883.671/0001-15";
  const response = (body: unknown) => (async () => Response.json(body)) as typeof fetch;
  try {
    assert.deepEqual(await verifyIcpBrasil(Buffer.from("%PDF-QA"), response({ valid: true })), { valid: false, reason: "Assinatura inválida segundo o validador.", code: "validator_identity_missing" });
    for (const cnpj of ["15883671000115", "15.883.671/0001-15"]) assert.equal((await verifyIcpBrasil(Buffer.from("%PDF-QA"), response({ valid: true, cnpj }))).valid, true);
    for (const cnpj of ["", null, 15883671000115, true, [], {}, "1588367100011", "158836710001155", "ADUNIR 15883671000115", "15 883 671 0001 15", "15.883.671/0001-15\nextra"]) assert.equal((await verifyIcpBrasil(Buffer.from("%PDF-QA"), response({ valid: true, cnpj }))).valid, false, JSON.stringify(cnpj));
    assert.equal((await verifyIcpBrasil(Buffer.from("%PDF-QA"), response({ valid: true, cnpj: "15883671000116" }))).valid, false);
    process.env.ICP_EXPECTED_CNPJ = "bad-config";
    assert.equal((await verifyIcpBrasil(Buffer.from("%PDF-QA"), response({ valid: true, cnpj: "15883671000115" }))).code, "validator_expected_identity_invalid");
  } finally {
    if (oldUrl === undefined) delete process.env.ICP_VALIDATOR_URL; else process.env.ICP_VALIDATOR_URL = oldUrl;
    if (oldCnpj === undefined) delete process.env.ICP_EXPECTED_CNPJ; else process.env.ICP_EXPECTED_CNPJ = oldCnpj;
  }
});

test("JSON do adapter tem objeto/booleano e campos opcionais tipados, limitados e sem controles", async () => {
  const oldUrl = process.env.ICP_VALIDATOR_URL, oldCnpj = process.env.ICP_EXPECTED_CNPJ;
  process.env.ICP_VALIDATOR_URL = "https://validator.example.test/verify";
  process.env.ICP_EXPECTED_CNPJ = "15883671000115";
  const response = (body: unknown) => (async () => Response.json(body)) as typeof fetch;
  try {
    for (const body of [null, [], true, "valid", 1, {}, { valid: "true", cnpj: "15883671000115" }, { valid: 1, cnpj: "15883671000115" }]) assert.equal((await verifyIcpBrasil(Buffer.from("%PDF-QA"), response(body))).valid, false);
    for (const signer of [null, 123, false, [], {}, "x".repeat(501), "QA\nInjected", "QA\0Injected"]) assert.equal((await verifyIcpBrasil(Buffer.from("%PDF-QA"), response({ valid: true, cnpj: "15883671000115", signer }))).valid, false);
    assert.deepEqual(await verifyIcpBrasil(Buffer.from("%PDF-QA"), response({ valid: true, cnpj: "15883671000115", signer: "ADUNIR – instituição" })), { valid: true, signer: "ADUNIR – instituição", reason: undefined });
  } finally {
    if (oldUrl === undefined) delete process.env.ICP_VALIDATOR_URL; else process.env.ICP_VALIDATOR_URL = oldUrl;
    if (oldCnpj === undefined) delete process.env.ICP_EXPECTED_CNPJ; else process.env.ICP_EXPECTED_CNPJ = oldCnpj;
  }
});

test("resposta de validador excedente, JSON inválido ou UTF-8 inválido falha fechada antes de aceitar identidade", async () => {
  const old = process.env.ICP_VALIDATOR_URL;
  process.env.ICP_VALIDATOR_URL = "https://validator.example.test/verify";
  try {
    const oversized = (async () => Response.json({ valid: true, cnpj: "15883671000115", ignored: "x".repeat(65536) })) as typeof fetch;
    const malformed = (async () => new Response('{"valid":true')) as typeof fetch;
    const badUtf8 = (async () => new Response(new Uint8Array([0xff, 0xff]))) as typeof fetch;
    for (const fake of [oversized, malformed, badUtf8]) { const result = await verifyIcpBrasil(Buffer.from("%PDF-QA"), fake); assert.equal(result.valid, false); assert.equal(result.code, "validator_response_invalid"); }
  } finally { if (old === undefined) delete process.env.ICP_VALIDATOR_URL; else process.env.ICP_VALIDATOR_URL = old; }
});
