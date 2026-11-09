import test from "node:test";
import assert from "node:assert/strict";
import { runQueuedA1Job } from "./batch-a1-executor";

// Orchestration tests only: signature cryptography and SQL publication have separate real tests.
const original = Buffer.from("%PDF-1.4\noriginal\n");
const tail = "/Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 1 2 ";
let length = original.length + tail.length + 8;
let signed = Buffer.alloc(0);
for (let i = 0; i < 4; i++) { signed = Buffer.concat([original, Buffer.from(tail + (length - 2) + "]\n")]); length = signed.length; }
function fixture(t: any) {
  const previous = process.env.BATCH_A1_ENABLED;
  process.env.BATCH_A1_ENABLED = "1";
  t.after(() => { if (previous === undefined) delete process.env.BATCH_A1_ENABLED; else process.env.BATCH_A1_ENABLED = previous; });
  const calls: string[] = [];
  const claim = { ok: true, binding: {}, bytes: original, leaseToken: "lease", job: { revision: 2 } };
  const deps: any = {
    validationReady: () => true,
    query: async () => { calls.push("query"); return { rows: [{ id: "job", revision: 1 }] }; },
    claim: async () => { calls.push("claim"); return claim; },
    worker: async () => { calls.push("worker"); return { ok: true, bytes: signed, report: { environment: "production" } }; },
    verify: async () => { calls.push("verify"); return { ok: true, proof: { testOnly: true } }; },
    finish: async () => { calls.push("finish"); return { ok: true }; },
    fail: async (_id: string, _lease: string, _revision: number, code: string) => { calls.push("fail:" + code); return { ok: true }; },
  };
  return { deps, calls };
}

test("A1 executor: gates fechados não consultam fila nem usam certificado", async t => {
  const f = fixture(t); delete process.env.BATCH_A1_ENABLED;
  assert.deepEqual(await runQueuedA1Job(f.deps), { ran: false, state: "disabled" });
  process.env.BATCH_A1_ENABLED = "1"; f.deps.validationReady = () => false;
  assert.deepEqual(await runQueuedA1Job(f.deps), { ran: false, state: "disabled" });
  assert.deepEqual(f.calls, []);
});
test("A1 executor: fila vazia ou claim recusado não assinam", async t => {
  const f = fixture(t); f.deps.query = async () => ({ rows: [] });
  assert.equal((await runQueuedA1Job(f.deps)).state, "empty");
  f.deps.query = async () => ({ rows: [{ id: "job", revision: 1 }] }); f.deps.claim = async () => ({ ok: false });
  assert.equal((await runQueuedA1Job(f.deps)).state, "not_claimed"); assert.deepEqual(f.calls, []);
});
test("A1 executor: indisponibilidade não repete assinatura nem publica", async t => {
  const f = fixture(t); f.deps.worker = async () => { f.calls.push("worker"); return { ok: false }; };
  assert.equal((await runQueuedA1Job(f.deps)).state, "worker_unavailable");
  assert.deepEqual(f.calls, ["query", "claim", "worker", "fail:worker_unavailable"]);
});
test("A1 executor: saída diferente do original ou validação negativa não publica", async t => {
  const f = fixture(t); f.deps.worker = async () => ({ ok: true, bytes: Buffer.from("%PDF-alterado"), report: { environment: "production" } });
  assert.equal((await runQueuedA1Job(f.deps)).state, "input_mismatch");
  assert.ok(!f.calls.includes("verify") && !f.calls.includes("finish"));
  const g = fixture(t); g.deps.verify = async () => { g.calls.push("verify"); return { ok: false }; };
  assert.equal((await runQueuedA1Job(g.deps)).state, "validation_failed"); assert.ok(!g.calls.includes("finish"));
});
test("A1 executor: confirmação de assinatura não chama aprovação ou envio", async t => {
  const f = fixture(t);
  assert.deepEqual(await runQueuedA1Job(f.deps), { ran: true, state: "succeeded" });
  assert.deepEqual(f.calls, ["query", "claim", "worker", "verify", "finish"]);
});
test("A1 executor: resposta final perdida conserva incerteza e não reexecuta", async t => {
  const f = fixture(t); f.deps.finish = async () => { f.calls.push("finish"); throw new Error("fake lost response"); };
  assert.equal((await runQueuedA1Job(f.deps)).state, "result_uncertain");
  assert.equal(f.calls.filter(x => x === "worker").length, 1); assert.equal(f.calls.at(-1), "fail:result_uncertain");
});
