import test from "node:test";
import assert from "node:assert/strict";
import { a1UiIntent, a1UiJobMatchesMode, a1UiModeValid, rememberA1UiIntent, restoreA1UiIntent, type A1UiContext } from "./a1-ui-context";
const own = "11111111-2222-4333-8444-555555555555", other = "22222222-3333-4444-8555-666666666666";
const context: A1UiContext = { batchId: 1, actorScope: "1:2", ownArtifactId: own, documentRevision: "a".repeat(64) };
const intent = { batchId: 1, requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", expectedDocumentVersion: "b".repeat(64), expectedPolicyRevision: 2, expectedOwnArtifactId: own };
const original = { batchId: 1, requestId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", expectedDocumentVersion: "b".repeat(64), expectedPolicyRevision: 2 };
function storage() { const map = new Map<string, string>(); return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; }

test("A1 UI context: own and original modes are explicit and never interchangeable", () => {
  assert.deepEqual(a1UiIntent(intent, context), intent);
  assert.equal(a1UiIntent(original, context), null);
  assert.equal(a1UiIntent(intent, { ...context, ownArtifactId: null }), null);
  assert.deepEqual(a1UiIntent(original, { ...context, ownArtifactId: null }), original);
  assert.equal(a1UiIntent({ ...original, expectedOwnArtifactId: null }, { ...context, ownArtifactId: null }), null);
  assert.equal(a1UiIntent({ ...original, expectedOwnArtifactId: undefined }, { ...context, ownArtifactId: null }), null);
});
test("A1 UI context: invalid own artifact cannot fall back to original", () => {
  for (const ownArtifactId of ["", "bad", "/path", `${own}?secret=value`]) { assert.equal(a1UiModeValid({ ...context, ownArtifactId }), false); assert.equal(a1UiIntent(intent, { ...context, ownArtifactId }), null); }
  assert.equal(a1UiModeValid({ ...context, documentRevision: "bad" }), false);
});
test("A1 UI context: persistence includes actor, mode UUID, parent revision, A1 document and policy", () => {
  const s = storage(); assert.equal(rememberA1UiIntent(s, context, intent), true);
  const keys = [...s.map.keys()]; assert.equal(keys.length, 2);
  assert.ok(keys.every(key => key.includes("1:2") && key.includes(own) && key.includes(context.documentRevision!)));
  assert.ok(keys.some(key => key.includes(`:doc:${intent.expectedDocumentVersion}:policy:2`)));
  assert.deepEqual(restoreA1UiIntent(s, context), intent);
  for (const patch of [{ actorScope: "1:3" }, { batchId: 2 }, { ownArtifactId: other }, { documentRevision: "c".repeat(64) }, { ownArtifactId: null }]) assert.equal(restoreA1UiIntent(s, { ...context, ...patch }), null);
});
test("A1 UI context: legacy callers without account/session scope never persist", () => {
  const s = storage(); assert.equal(rememberA1UiIntent(s, { batchId: 1 }, original), false); assert.equal(s.map.size, 0); assert.equal(restoreA1UiIntent(s, { batchId: 1 }), null);
});
test("A1 UI context: original and own saved intents coexist without cross-mode lookup", () => {
  const s = storage(), c = { ...context, ownArtifactId: null };
  assert.equal(rememberA1UiIntent(s, context, intent), true); assert.equal(rememberA1UiIntent(s, c, original), true);
  assert.deepEqual(restoreA1UiIntent(s, context), intent); assert.deepEqual(restoreA1UiIntent(s, c), original);
});
test("A1 UI context: modified pointers, binding or extra secrets are refused", () => {
  for (const mutation of ["pointer", "body", "secret"]) {
    const s = storage(); rememberA1UiIntent(s, context, intent); const index = [...s.map.keys()].find(key => key.endsWith(":selected"))!, key = s.getItem(index)!;
    if (mutation === "pointer") s.setItem(index, key.replace(own, other));
    else s.setItem(key, JSON.stringify(mutation === "body" ? { ...intent, expectedOwnArtifactId: other } : { ...intent, token: "must-not-be-here" }));
    assert.equal(restoreA1UiIntent(s, context), null);
  }
});
test("A1 UI context: symbols, getters, undefined fields and storage failures are inert", () => {
  const value = { ...intent }; Object.defineProperty(value, "dangerous", { get() { throw new Error("getter must not run"); }, enumerable: true });
  assert.equal(a1UiIntent(value, context), null);
  const symbols = { ...intent, [Symbol("secret")]: "bad" }; assert.equal(a1UiIntent(symbols, context), null);
  const broken = { getItem() { throw new Error("blocked storage"); }, setItem() { throw new Error("blocked storage"); }, removeItem() { throw new Error("blocked storage"); } };
  assert.equal(rememberA1UiIntent(broken, context, intent), false); assert.equal(restoreA1UiIntent(broken, context), null);
});
test("A1 UI context: latest job from other source cannot represent this mode", () => {
  assert.equal(a1UiJobMatchesMode({ ownArtifactId: own }, context), true);
  assert.equal(a1UiJobMatchesMode({ ownArtifactId: other }, context), false);
  assert.equal(a1UiJobMatchesMode({ ownArtifactId: null }, context), false);
  assert.equal(a1UiJobMatchesMode({}, { ...context, ownArtifactId: null }), true);
  assert.equal(a1UiJobMatchesMode({ ownArtifactId: own }, { ...context, ownArtifactId: null }), false);
});
