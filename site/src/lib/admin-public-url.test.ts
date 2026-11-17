import test from "node:test";
import assert from "node:assert/strict";
import { config } from "./config";

test("o endereço do painel não muda links públicos e mantém fallback para instalações existentes", () => {
  const previous = { app: process.env.APP_URL, admin: process.env.ADMIN_URL };
  try {
    process.env.APP_URL = "https://sancionaintegral.org";
    delete process.env.ADMIN_URL;
    assert.equal(config.adminUrl(), "https://sancionaintegral.org");
    process.env.ADMIN_URL = "https://admin.sancionaintegral.org/";
    assert.equal(`${config.adminUrl()}/admin/lotes`, "https://admin.sancionaintegral.org/admin/lotes");
    assert.equal(`${config.appUrl()}/confirmar`, "https://sancionaintegral.org/confirmar");
  } finally {
    if (previous.app === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous.app;
    if (previous.admin === undefined) delete process.env.ADMIN_URL; else process.env.ADMIN_URL = previous.admin;
  }
});
