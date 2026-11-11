const test = require("node:test");
const assert = require("node:assert/strict");
const { validateConfig, classifyRequest } = require("./history-browser.cjs");
const run = "/mnt/dev/.peticao-r0004-local-history-http-qa-20261111/runs/012345abcdef";
const group = "/user.slice/user-1000.slice/user@1000.service/app.slice/peticao-r0004-local-history-http-qa-20261111.service";
const good = () => ({ run, origin: "http://127.0.0.1:31385", sourceCommit: "f55595cd348c23ffe559dba2de9150259db9f1e7", cgroup: group, cookie: "adm=" + "a".repeat(48), syntheticSession: true, stepupSeeded: true, batchId: 1, fixtures: [1, 2].map(n => ({ ordinal: n, id: `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`, sha256: "b".repeat(64), filename: `version-${n}.pdf`, bytes: 640 })) });

test("accepts only exact local fixture run/source/cgroup and declared synthetic session", () => {
  assert.equal(validateConfig(good(), run + "/browser-config.json", group), run);
  for (const patch of [{ sourceCommit: "0".repeat(40) }, { origin: "https://sancionaintegral.org" }, { syntheticSession: false }, { stepupSeeded: false }, { batchId: 2 }, { cookie: "adm=abc; stolen=1" }, { cgroup: "/foreign.service" }, { run: "/tmp/foreign" }]) {
    assert.throws(() => validateConfig({ ...good(), ...patch }, run + "/browser-config.json", group));
  }
  assert.throws(() => validateConfig(good(), "/tmp/browser-config.json", group));
  assert.throws(() => validateConfig(good(), run + "/browser-config.json", "/another.service"));
});

test("rejects swapped PDFs, traversal names and unbounded fixture downloads", () => {
  for (const patch of [{ ordinal: 2 }, { id: "../other" }, { filename: "../../secret.pdf" }, { sha256: "wrong" }, { bytes: -1 }, { bytes: 1024 * 1024 + 1 }]) {
    const c = good(); Object.assign(c.fixtures[0], patch);
    assert.throws(() => validateConfig(c, run + "/browser-config.json", group));
  }
});

test("browser policy rejects non-loopback origins, credentials and every mutation", () => {
  assert.equal(classifyRequest("http://127.0.0.1:31385/api/admin/lotes/1/versoes", "GET"), "allowed");
  assert.equal(classifyRequest("http://127.0.0.1:31385/_next/static/app.js", "HEAD"), "allowed");
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.equal(classifyRequest("http://127.0.0.1:31385/api/admin/lotes/1/aprovar", method), "mutation");
  for (const url of ["https://sancionaintegral.org/", "http://127.0.0.1:31386/", "http://127.0.0.1:31385@outside.invalid/", "http://user:pass@127.0.0.1:31385/", "https://127.0.0.1:31385/", "http://localhost:31385/"]) assert.equal(classifyRequest(url, "GET"), "external");
});
