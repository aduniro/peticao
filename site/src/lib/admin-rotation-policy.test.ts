import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { acaoPermitidaDuranteTrocaSenha, precisaTrocarSenhaAdmin } from "./admin-rotation-policy";

test("rotation uses the server's modern-session flag without extending legacy or preview access", () => {
  assert.equal(precisaTrocarSenhaAdmin({ legado: false, preview: false, trocarSenha: true }), true);
  assert.equal(precisaTrocarSenhaAdmin({ legado: false, preview: false, trocarSenha: false }), false);
  assert.equal(precisaTrocarSenhaAdmin({ legado: true, preview: false, trocarSenha: true }), false);
  assert.equal(precisaTrocarSenhaAdmin({ legado: false, preview: true, trocarSenha: true }), false);
  assert.equal(precisaTrocarSenhaAdmin(null), false);
  assert.equal(precisaTrocarSenhaAdmin(undefined), false);
});

test("only exact recovery routes and methods are exempt; prefixes, aliases and invented operations are denied", () => {
  for (const path of ["conta", "sair", "login", "esqueci", "redefinir"]) {
    assert.equal(acaoPermitidaDuranteTrocaSenha("POST", `/api/admin/${path}`), true);
    assert.equal(acaoPermitidaDuranteTrocaSenha("GET", `/api/admin/${path}`), false);
    assert.equal(acaoPermitidaDuranteTrocaSenha("DELETE", `/api/admin/${path}`), false);
  }
  for (const path of ["/api/admin/usuarios", "/api/admin/conta/nivel", "/api/admin/conta/",
    "/api/admin/conta?permitir=true", "/api/admin/%63onta", "/api/admin/conta/../usuarios",
    "/api/admin/stepup", "/api/admin/lotes", "/api/admin/conta-extra"]) {
    assert.equal(acaoPermitidaDuranteTrocaSenha("POST", path), false, path);
  }
});

test("raw SSR session exceptions remain confined to the account page and shell", () => {
  const root = resolve(process.cwd(), "src/app/admin");
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) files.push(path);
    }
  };
  walk(root);
  const account = files.filter(path => readFileSync(path, "utf8").includes("sessaoAdminDaConta"));
  const shell = files.filter(path => readFileSync(path, "utf8").includes("sessaoAdminDaMoldura"));
  assert.deepEqual(account.map(path => relative(root, path)), [join("conta", "page.tsx")]);
  assert.deepEqual(shell.map(path => relative(root, path)), ["layout.tsx"]);
});
