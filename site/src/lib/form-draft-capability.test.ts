import test from "node:test";
import assert from "node:assert/strict";
import { DRAFT_CAPABILITY_STORAGE_KEY, loadDraftCapability, persistDraftCapability, removeDraftCapability, type DraftCapabilityStorage } from "./form-draft-capability";
const token = "a".repeat(43), now = Date.now();
const capability = () => ({ token, sequence: 4, expiresAt: now + 86400_000 });
const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};

test("capability: persiste somente token opaco, sequência e validade; reload não inclui formulário", () => {
  const storage = memory();
  const input = { ...capability(), name: "DO_NOT_PERSIST", cpf: "DO_NOT_PERSIST", email: "DO_NOT_PERSIST" };
  assert.equal(persistDraftCapability(storage, input), true);
  const raw = storage.getItem(DRAFT_CAPABILITY_STORAGE_KEY)!;
  assert.ok(!raw.includes("DO_NOT_PERSIST"));
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["expiresAt", "sequence", "token"]);
  assert.deepEqual(loadDraftCapability(storage, now).capability, capability());
  assert.equal(removeDraftCapability(storage, "b".repeat(43)), true);
  assert.ok(storage.getItem(DRAFT_CAPABILITY_STORAGE_KEY));
  removeDraftCapability(storage, token);
  assert.equal(loadDraftCapability(storage, now).capability, null);
});

test("capability: vencimento/malformação limpam somente armazenamento local", () => {
  const storage = memory();
  persistDraftCapability(storage, { ...capability(), expiresAt: now - 1 });
  assert.equal(loadDraftCapability(storage, now).capability, null);
  assert.equal(storage.getItem(DRAFT_CAPABILITY_STORAGE_KEY), null);
  storage.setItem(DRAFT_CAPABILITY_STORAGE_KEY, "{invalid");
  assert.equal(loadDraftCapability(storage, now).capability, null);
  assert.equal(storage.getItem(DRAFT_CAPABILITY_STORAGE_KEY), null);
});

test("capability: armazenamento bloqueado não interrompe formulário", () => {
  const storage: DraftCapabilityStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  assert.deepEqual(loadDraftCapability(storage), { capability: null, available: false });
  assert.equal(persistDraftCapability(storage, capability()), false);
  assert.equal(removeDraftCapability(storage, token), false);
  assert.equal(persistDraftCapability(null, capability()), false);
});
