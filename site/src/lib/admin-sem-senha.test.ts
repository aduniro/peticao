import test from "node:test";
import assert from "node:assert/strict";
import { adminSemSenha } from "./admin";

// O admin sem senha é só para a pré-visualização: na VPS real (sem PREVIEW_MODE) NUNCA vale, mesmo com a variável copiada por engano.
test("admin sem senha só vale em pré-visualização", () => {
  const a = { n: process.env.ADMIN_NO_PASSWORD, p: process.env.PREVIEW_MODE };
  try {
    delete process.env.ADMIN_NO_PASSWORD; delete process.env.PREVIEW_MODE;
    assert.equal(adminSemSenha(), false);
    process.env.ADMIN_NO_PASSWORD = "1"; // produção: sem PREVIEW_MODE
    assert.equal(adminSemSenha(), false);
    process.env.PREVIEW_MODE = "1";
    assert.equal(adminSemSenha(), true);
    process.env.ADMIN_NO_PASSWORD = "0";
    assert.equal(adminSemSenha(), false);
    process.env.ADMIN_NO_PASSWORD = "true"; // só "1" liga
    assert.equal(adminSemSenha(), false);
  } finally {
    if (a.n === undefined) delete process.env.ADMIN_NO_PASSWORD; else process.env.ADMIN_NO_PASSWORD = a.n;
    if (a.p === undefined) delete process.env.PREVIEW_MODE; else process.env.PREVIEW_MODE = a.p;
  }
});
