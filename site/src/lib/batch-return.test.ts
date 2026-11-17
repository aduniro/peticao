import test from "node:test";
import assert from "node:assert/strict";
import { batchReturnUrl } from "./batch-return";

const request = (query = "") => ({ url: `http://localhost:3191/api/admin/lotes/7/cancelar?${query}`, headers: new Headers({ host: "localhost:3191" }) });

test("a completed batch form returns to the same selected id on the fixed list page", () => {
  const url = batchReturnUrl(request(), 7);
  assert.equal(url.origin, "http://localhost:3191");
  assert.equal(url.pathname, "/admin/lotes");
  assert.equal(url.searchParams.get("lote"), "7");
  url.searchParams.set("msg", "Não foi possível concluir. Corrija e tente novamente.");
  assert.equal(new URL(url).searchParams.get("lote"), "7");
  assert.equal(new URL(url).searchParams.get("msg"), "Não foi possível concluir. Corrija e tente novamente.");
});

test("president portal keeps its fixed path and validated selection", () => {
  const url = batchReturnUrl(request("portal=presidente"), 7);
  assert.equal(url.pathname, "/admin/presidente");
  assert.equal(url.searchParams.get("lote"), "7");
});

test("query-supplied targets and ids cannot replace the route-derived return target", () => {
  for (const query of ["returnTo=https://evil.example.invalid", "portal=https://evil.example.invalid", "lote=999", "portal=outro&lote=999"]) {
    const url = batchReturnUrl(request(query), 7);
    assert.equal(url.origin, "http://localhost:3191");
    assert.equal(url.pathname, "/admin/lotes");
    assert.equal(url.searchParams.get("lote"), "7");
  }
});

test("missing or invalid route ids never create an actionable selection", () => {
  for (const value of [undefined, NaN, Infinity, 0, -1, 7.2, 2147483648]) {
    const url = batchReturnUrl(request(), value);
    assert.equal(url.pathname, "/admin/lotes");
    assert.equal(url.searchParams.has("lote"), false);
  }
  assert.equal(batchReturnUrl(request(), 2147483647).searchParams.get("lote"), "2147483647");
});
