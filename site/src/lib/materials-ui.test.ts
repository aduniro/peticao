import test from "node:test";
import assert from "node:assert/strict";
import type { MaterialVersion } from "./materials-contract";
import { createMaterialUiSession, emptyMaterialUiDraft, materialPreviewUrl, materialUiCanSwitch, materialUiDirty, materialUiIntent } from "./materials-ui";
import { MaterialsClient, type MaterialsState, type MaterialsTransport } from "./materials-client";
const actor = { actorId: 1, actorScope: "ui-fixture", materialId: null };
const MID = "11111111-1111-4111-8111-111111111111", VID = "22222222-2222-4222-8222-222222222222", RID = "33333333-3333-4333-8333-333333333333";
const content = { ...emptyMaterialUiDraft(), title: "Material fictício", body: "Texto fictício", callToAction: "Ação fictícia" };
const v1: MaterialVersion = { id: VID, materialId: MID, revision: 1, content, sha256: "a".repeat(64), archived: false, authorId: 1, createdAt: "2026-11-11T00:00:00.000Z" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const history = () => json({ ok: true, current: v1, versions: [v1], nextBefore: null });
function selected() { const c = new MaterialsClient({ ...actor, materialId: MID }); assert.equal(c.seedHead(v1), true); return c; }

test("UI draft keeps partial input without overwriting client's complete valid content", () => {
  const c = selected(), raw = { ...content, title: "", body: "Texto ainda em digitação" };
  assert.equal(c.setDraft(raw), false); assert.deepEqual(c.getState().draft, content);
  assert.equal(raw.title, ""); assert.equal(materialUiDirty(raw, c.getState()), true);
  assert.equal(materialUiIntent("revise", RID, c.getState(), raw), null);
});
test("UI CAS intent uses reviewed head revision and preserves content", () => {
  const c = selected(), draft = { ...content, body: "Versão local nova" }; assert.equal(c.setDraft(draft), true);
  assert.deepEqual(materialUiIntent("revise", RID, c.getState(), draft), { operation: "revise", requestId: RID, materialId: MID, expectedRevision: 1, content: draft });
  const v2 = { ...v1, id: RID, revision: 2 }; c.seedHead(v2);
  assert.equal(materialUiIntent("revise", RID, c.getState(), draft), null);
});
test("UI exact preview binds saved UUID, material UUID and ordinal; rejects injected URLs", () => {
  assert.equal(materialPreviewUrl(v1), `/api/admin/materiais/${MID}/previa?versionId=${VID}&revision=1`);
  assert.equal(materialPreviewUrl({ ...v1, id: "https://example.invalid" }), null);
  assert.equal(materialPreviewUrl({ ...v1, revision: "1&revision=2" }), null);
});
test("UI confirmed receipt permits explicit navigation only if no new local edits exist", () => {
  const c = new MaterialsClient(actor), state = c.getState();
  const confirmed: MaterialsState = { ...state, phase: "confirmed", receipt: { requestId: RID, version: v1, replayed: false }, needsReview: true };
  assert.equal(materialUiCanSwitch(content, confirmed), true);
  assert.equal(materialUiCanSwitch({ ...content, footer: "Texto posterior ao save" }, confirmed), false);
  assert.equal(materialUiCanSwitch(content, { ...confirmed, phase: "uncertain", pending: { intent: { operation: "create", requestId: RID, content }, base: null } }), false);
});
test("UI lifecycle cleanup and remount use a new live client and ignore old completion", async () => {
  let finish!: (value: Response) => void; const published: MaterialsState[] = [];
  const old = createMaterialUiSession({ ...actor, materialId: MID }, s => published.push(s), () => new Promise(resolve => { finish = resolve; }));
  const task = old.run(c => c.loadHistory()); old.dispose();
  const next: MaterialsState[] = [], fresh = createMaterialUiSession({ ...actor, materialId: MID }, s => next.push(s), async () => history());
  assert.notEqual(old.client, fresh.client); const freshResult = await fresh.run(c => c.loadHistory());
  const count = published.length; finish(history()); assert.equal(await task, null); assert.equal(published.length, count);
  assert.equal(freshResult?.ok, true); assert.equal(next.at(-1)?.head?.id, VID); fresh.dispose();
});
test("UI change of context suppresses late result even if material is later selected again", async () => {
  let finish!: (value: Response) => void; const session = createMaterialUiSession({ ...actor, materialId: MID }, () => {}, () => new Promise(resolve => { finish = resolve; }));
  const pending = session.run(c => c.loadHistory());
  session.setContext(actor); session.setContext({ ...actor, materialId: MID }); finish(history());
  assert.equal(await pending, null); assert.equal(session.client.getState().head, null); session.dispose();
});
test("UI pending recovery performs GET only and retains original request after 404", async () => {
  const calls: { method?: string; url: string }[] = []; const transport: MaterialsTransport = async (url, init) => {
    calls.push({ method: init.method, url }); if (init.method === "POST") throw new Error("FICTITIOUS_TRANSPORT_LOSS"); return json({ ok: false, error: "not_found" }, 404);
  };
  const session = createMaterialUiSession(actor, () => {}, transport); session.client.setDraft(content);
  await session.run(c => c.save({ operation: "create", requestId: RID, content }));
  assert.equal(session.client.getState().phase, "uncertain");
  assert.equal(materialUiIntent("create", MID, session.client.getState(), content), null);
  await session.run(c => c.recoverPending());
  assert.deepEqual(calls, [{ method: "POST", url: "/api/admin/materiais" }, { method: "GET", url: "/api/admin/materiais/pedidos/" + RID }]);
  assert.equal(session.client.getState().pending?.intent.requestId, RID); session.dispose();
});

test("UI confirmed create then explicit New resets receipt/review and admits a new intent", async () => {
  let posts = 0; const session = createMaterialUiSession(actor, () => {}, async () => { posts++; return json({ ok: true, replayed: false, version: v1 }); });
  session.client.setDraft(content); await session.run(c => c.save({ operation: "create", requestId: RID, content }));
  assert.equal(session.client.getState().needsReview, true); assert.equal(materialUiCanSwitch(content, session.client.getState()), true);
  const old = session.client; assert.equal(session.newDraft(), true); assert.notEqual(session.client, old);
  const blank = session.client.getState(); assert.equal(blank.context.materialId, null); assert.equal(blank.receipt, null); assert.equal(blank.needsReview, false); assert.equal(materialUiDirty(emptyMaterialUiDraft(), blank), false);
  const next = { ...content, title: "Outro material" }; session.client.setDraft(next);
  assert.deepEqual(materialUiIntent("create", MID, session.client.getState(), next), { operation: "create", requestId: MID, content: next });
  assert.equal(posts, 1); session.dispose();
});
test("UI new draft never discards an uncertain pending request", async () => {
  const session = createMaterialUiSession(actor, () => {}, async () => { throw new Error("FICTITIOUS_LOSS"); }); session.client.setDraft(content);
  await session.run(c => c.save({ operation: "create", requestId: RID, content })); const owned = session.client;
  assert.equal(session.newDraft(), false); assert.equal(session.client, owned); assert.equal(session.client.getState().pending?.intent.requestId, RID); session.dispose();
});
