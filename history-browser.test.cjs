const test = require("node:test");
const assert = require("node:assert/strict");
const { validateConfig, classifyRequest, verifyDownloadRequests } = require("./history-browser.cjs");
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

test("new browser fixture accepts only its paired R6 root and unit, never a mixed context", () => {
  const cfg = good(); cfg.run = run.replace("r0004-local-history-http", "r0006-local-history-browser"); cfg.cgroup = group.replace("r0004-local-history-http", "r0006-local-history-browser");
  assert.equal(validateConfig(cfg, cfg.run + "/browser-config.json", cfg.cgroup), cfg.run);
  assert.throws(() => validateConfig({ ...cfg, cgroup: group }, cfg.run + "/browser-config.json", group));
  assert.throws(() => validateConfig({ ...good(), cgroup: cfg.cgroup }, run + "/browser-config.json", cfg.cgroup));
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

test("download receipt rejects automatic, repeated, missing and out-of-order PDF requests", () => {
  const f = good().fixtures;
  const a = { method: "GET", path: `/api/admin/lotes/1/versoes/${f[1].id}` };
  const b = { method: "GET", path: `/api/admin/lotes/1/versoes/${f[0].id}` };
  verifyDownloadRequests([{ method: "GET", path: "/api/admin/lotes/1/versoes" }, a, b], f);
  for (const requests of [[b, a], [a], [a, b, a], [{ ...a, method: "HEAD" }, b]]) assert.throws(() => verifyDownloadRequests(requests, f));
});

const { socketBudget, privateParent, createShortTmp, removeShortTmp, diagnostic } = require('./history-browser.cjs');
test('Unix socket108byte budget includes terminating NUL and refuses long child temp', () => {
  assert.equal(socketBudget('x'.repeat(42)), 107);
  assert.throws(() => socketBudget('x'.repeat(43)));
  assert.throws(() => socketBudget('x'.repeat(79)));
  assert.throws(() => socketBudget('é'.repeat(22)));
});
function fakeTmp() {
  const parent = `/run/user/${process.getuid()}`, nonce = '012345abcdef'; let removed = false;
  const info = inode => ({ uid: process.getuid(), dev: 1, ino: inode, mode: 0o700, isDirectory: () => true, isSymbolicLink: () => false });
  const state = { parent: info(1), child: info(2), removals: [] };
  const api = { lstatSync: p => p === parent ? state.parent : state.child, realpathSync: p => p, mkdtempSync: prefix => prefix + 'AbC123', chmodSync: () => {}, rmSync: (p, opts) => { state.removals.push({p,opts}); removed = true; }, existsSync: () => !removed };
  return { parent, nonce, api, state };
}
test('short temp is own canonical0700 unique nonce directory and removed only after close', () => {
  const f = fakeTmp(), identity = createShortTmp(f.nonce, f.api);
  assert.ok(identity.directory.length < 43);
  assert.throws(() => removeShortTmp(identity, false, f.api)); assert.equal(f.state.removals.length, 0);
  assert.equal(removeShortTmp(identity, true, f.api), true);
  assert.equal(f.state.removals[0].p, identity.directory); assert.deepEqual(f.state.removals[0].opts, {recursive:true,force:false});
});
test('parent ownership and child inode/UID/mode drift block deletion', () => {
  for (const change of ['parentUid','childUid','inode','mode','symlink','canonical']) {
    const f=fakeTmp(), identity=createShortTmp(f.nonce,f.api);
    if(change==='parentUid') f.state.parent.uid++;
    if(change==='childUid') f.state.child.uid++;
    if(change==='inode') f.state.child.ino++;
    if(change==='mode') f.state.child.mode=0o777;
    if(change==='symlink') f.state.child.isSymbolicLink=()=>true;
    if(change==='canonical') f.api.realpathSync=()=>'/foreign';
    assert.throws(()=>removeShortTmp(identity,true,f.api)); assert.equal(f.state.removals.length,0);
  }
});
test('diagnostics retain head and tail after cookie/token redaction', () => {
  const cookie='adm=ONLY_SYNTHETIC_TOKEN_12345', token=cookie.slice(4);
  const output=diagnostic('HEAD '+cookie+' '+('x'.repeat(9000))+' TAIL '+token,cookie);
  assert.ok(output.startsWith('HEAD [REDACTED]')); assert.ok(output.includes('TAIL [REDACTED]')); assert.ok(output.includes('middle omitted'));
  assert.equal(output.includes(cookie),false); assert.equal(output.includes(token),false);
});
