import test from "node:test";
import assert from "node:assert/strict";
import { issuePresidentChallenge, confirmPresidentChallenge, presidentDocumentRevision, type IssuedPresidentChallenge, type PresidentChallengeStore } from "./president-portal-contract";

const document = { batchId: 7, seq: 1, kind: "final" as const, listHash: "a".repeat(64), originalPdf: Buffer.from("%PDF-QA-ORIGINAL"), signedPdf: null, signatureKind: "none" };
const key = "QA-ONLY-PRESIDENT-CHALLENGE-SECRET-0123456789";
const input = { document, responsibleId: 10, issuedBy: 1 };
const identity = { cpf: "00000000000", birthDate: "2000-01-01" }; // Never sent to a real provider.

function fakeStore() {
  let now = 1000, currentVersion = presidentDocumentRevision(document), active = true;
  const rows = new Map<string, IssuedPresidentChallenge & { attempts: number; state: string; leaseId?: string; leaseUntil?: number }>();
  const store: PresidentChallengeStore = {
    async issue(row) { if (!active || row.documentVersion !== currentVersion) return false; rows.set(row.tokenHash, { ...row, attempts: 0, state: "issued" }); return true; },
    async claim(request) {
      const row = rows.get(request.tokenHash);
      if (row?.state === "verifying" && row.leaseUntil! <= request.now) row.state = "issued";
      if (!row || !active || row.expiresAt <= request.now || row.documentVersion !== currentVersion || row.state !== "issued" || row.attempts >= row.maximumAttempts) return null;
      row.attempts++;
      if (request.passwordHash !== row.passwordHash) return null;
      row.state = "verifying"; row.leaseId = request.leaseId; row.leaseUntil = request.leaseUntil;
      return { id: row.id, responsibleId: row.responsibleId, documentVersion: row.documentVersion };
    },
    async finish(request) {
      const row = [...rows.values()].find(r => r.id === request.id);
      if (!row || !active || row.state !== "verifying" || row.leaseId !== request.leaseId || row.leaseUntil! <= request.now || row.expiresAt <= request.now || row.documentVersion !== currentVersion || row.documentVersion !== request.documentVersion) return null;
      row.state = request.verified ? "consumed" : "issued";
      return request.verified ? { receiptId: "QA-RECEIPT" } : null;
    },
  };
  return { rows, store, runtime: { store, key, clock: () => now, verifyIdentity: async () => true }, time: (v: number) => { now = v; }, changed: () => { currentVersion = "b".repeat(64); }, revoke: () => { active = false; } };
}

test("sem adapter durável/chave/verificador não emite nem confirma desafio", async () => {
  assert.deepEqual(await issuePresidentChallenge(input, { store: null, key }), { ok: false, error: "unavailable" });
  const c = fakeStore(); assert.equal((await issuePresidentChallenge(input, { store: c.store, key: "short" })).ok, false); assert.equal(c.rows.size, 0);
  const issued = await issuePresidentChallenge(input, c.runtime); assert.ok(issued.ok);
  assert.equal((await confirmPresidentChallenge({ ...issued, ...identity }, { ...c.runtime, verifyIdentity: null })).ok, false);
});

test("versão vincula lista/bytes originais/assinados sem alterar documentos", () => {
  const original = Buffer.from(document.originalPdf), version = presidentDocumentRevision(document);
  assert.equal(presidentDocumentRevision({ ...document }), version);
  for (const changed of [{ ...document, originalPdf: Buffer.from("%PDF-QA-CHANGED") }, { ...document, signedPdf: Buffer.from("%PDF-QA-SIGNED") }, { ...document, listHash: "b".repeat(64) }, { ...document, signatureKind: "externa-nao-validada" }]) assert.notEqual(presidentDocumentRevision(changed), version);
  assert.deepEqual(document.originalPdf, original);
});

test("consumo único com identidade efêmera não se apresenta como ICP ou gov.br", async () => {
  const c = fakeStore(), issued = await issuePresidentChallenge(input, c.runtime); assert.ok(issued.ok);
  const persisted = JSON.stringify([...c.rows.values()]); assert.ok(!persisted.includes(issued.token)); assert.ok(!persisted.includes(issued.password));
  const result = await confirmPresidentChallenge({ ...issued, ...identity }, c.runtime);
  assert.deepEqual(result, { ok: true, receiptId: "QA-RECEIPT", assurance: "own-confirmation", icpBrasil: false, govBr: false });
  assert.equal((await confirmPresidentChallenge({ ...issued, ...identity }, c.runtime)).ok, false);
  assert.ok(!JSON.stringify([...c.rows.values()]).includes(identity.cpf)); assert.ok(!JSON.stringify([...c.rows.values()]).includes(identity.birthDate));
});

test("expiração, revisão trocada e responsável revogado recusam sem inferir aprovação", async () => {
  for (const state of ["expired", "changed", "revoked"]) {
    const c = fakeStore(), issued = await issuePresidentChallenge(input, c.runtime); assert.ok(issued.ok);
    if (state === "expired") c.time(issued.expiresAt); else if (state === "changed") c.changed(); else c.revoke();
    assert.equal((await confirmPresidentChallenge({ ...issued, ...identity }, c.runtime)).ok, false);
    assert.ok([...c.rows.values()].every(r => r.state !== "consumed"));
  }
});

test("tentativas incorretas são contadas pelo adapter e não persistem senha/identidade", async () => {
  const c = fakeStore(), issued = await issuePresidentChallenge(input, c.runtime); assert.ok(issued.ok);
  const wrong = issued.password === "AAAAAAAAAAAA" ? "BBBBBBBBBBBB" : "AAAAAAAAAAAA";
  for (let n = 0; n < 5; n++) assert.equal((await confirmPresidentChallenge({ ...issued, password: wrong, ...identity }, c.runtime)).ok, false);
  assert.equal((await confirmPresidentChallenge({ ...issued, ...identity }, c.runtime)).ok, false);
  assert.equal([...c.rows.values()][0].attempts, 5);
});

test("concorrência e mudança durante verificação não consomem revisão obsoleta", async () => {
  for (const change of [false, true]) {
    const c = fakeStore(), issued = await issuePresidentChallenge(input, c.runtime); assert.ok(issued.ok);
    let release!: (v: boolean) => void; const gate = new Promise<boolean>(resolve => { release = resolve; });
    const first = confirmPresidentChallenge({ ...issued, ...identity }, { ...c.runtime, verifyIdentity: async () => gate });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await confirmPresidentChallenge({ ...issued, ...identity }, c.runtime)).ok, false);
    if (change) c.changed(); release(true); assert.equal((await first).ok, !change);
  }
});

test("resposta não booleana/erro/lease expirada durante identidade não viram confirmação", async () => {
  for (const mode of ["truthy", "error", "lease"]) {
    const c = fakeStore(), issued = await issuePresidentChallenge(input, c.runtime); assert.ok(issued.ok);
    const verifyIdentity = async () => { if (mode === "error") throw new Error("QA unavailable"); if (mode === "lease") c.time(32_000); return mode === "truthy" ? "yes" as unknown as boolean : true; };
    assert.equal((await confirmPresidentChallenge({ ...issued, ...identity }, { ...c.runtime, verifyIdentity })).ok, false);
    assert.ok([...c.rows.values()].every(r => r.state !== "consumed"));
  }
});

test("retomada após expiração da lease não deixa o verificador antigo consumir de novo", async () => {
  const c = fakeStore(), issued = await issuePresidentChallenge(input, c.runtime); assert.ok(issued.ok);
  let release!: (v: boolean) => void; const gate = new Promise<boolean>(resolve => { release = resolve; });
  const first = confirmPresidentChallenge({ ...issued, ...identity }, { ...c.runtime, verifyIdentity: async () => gate });
  await new Promise(resolve => setImmediate(resolve)); c.time(32_000);
  assert.equal((await confirmPresidentChallenge({ ...issued, ...identity }, c.runtime)).ok, true);
  release(true); assert.equal((await first).ok, false);
  assert.equal([...c.rows.values()][0].attempts, 2); assert.equal([...c.rows.values()][0].state, "consumed");
});
