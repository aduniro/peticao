import test from "node:test";
import assert from "node:assert/strict";
import { MATERIAL_TEMPLATES, MATERIAL_ASSETS, materialContent, materialMutation, materialDigest } from "./materials-contract";
import { MaterialsClient, MATERIAL_CLIENT_TEMPLATES, MATERIAL_CLIENT_ASSETS, parseMaterialsContent, parseMaterialsIntent, parseMaterialsVersion, parseMaterialsLibrary, parseMaterialsHistory, parseMaterialsReceipt } from "./materials-client";
import type { MaterialContent, MaterialVersion } from "./materials-contract";
import type { MaterialsContext, MaterialsTransport, MaterialsPending } from "./materials-client";
const id = (n: number) => "00000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
const content = (title = "Texto fictício"): MaterialContent => ({ template: "poster-a4-v1", assetKey: "adunir", title, body: "Educação 🟢\nem duas linhas", callToAction: "Ação fictícia", footer: "" });
function version(revision = 1, body = content(), materialId = id(100), extra: Partial<MaterialVersion> = {}): MaterialVersion {
  return { id: id(1000 + revision), materialId, revision, content: body, sha256: materialDigest(body), archived: false, authorId: 1, createdAt: "2026-11-11T00:00:00.000Z", ...extra };
}
const ctx = (materialId: string | null = id(100)): MaterialsContext => ({ actorId: 1, actorScope: "1:10", materialId });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const history = (current: MaterialVersion, versions = [current]) => ({ ok: true, current, versions, nextBefore: null });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const revise = (requestId = id(500), value = content("Rascunho local"), expectedRevision = 1) => ({ operation: "revise", requestId, materialId: id(100), expectedRevision, content: value });

test("browser content and intent canonicalization agree with server contract without runtime Node APIs", () => {
  assert.deepEqual(MATERIAL_CLIENT_TEMPLATES, MATERIAL_TEMPLATES); assert.deepEqual(MATERIAL_CLIENT_ASSETS, MATERIAL_ASSETS);
  for (const body of [content(), content("á".repeat(120)), { ...content(), title: "á".repeat(121) }, { ...content(), title: "<script>" }, { ...content(), body: "x\ud800" }, { ...content(), html: "unexpected" }]) assert.deepEqual(parseMaterialsContent(body), materialContent(body));
  for (const value of [{ operation: "create", requestId: id(500), content: content() }, revise(), { operation: "archive", requestId: id(501), materialId: id(100), expectedRevision: 1 }, { ...revise(), expectedRevision: "1" }]) assert.deepEqual(parseMaterialsIntent(value), materialMutation(value));
});
test("closed objects and arrays reject getters, symbols, hidden keys and prototypes without invoking getters", () => {
  let calls = 0; const getter = { ...content() }; Object.defineProperty(getter, "title", { enumerable: true, get() { calls++; return "unsafe"; } });
  assert.equal(parseMaterialsContent(getter), null); assert.equal(calls, 0);
  const hidden = { ...content() }; Object.defineProperty(hidden, "hidden", { value: true }); assert.equal(parseMaterialsContent(hidden), null);
  assert.equal(parseMaterialsContent({ ...content(), [Symbol("extra")]: 1 }), null); assert.equal(parseMaterialsContent(Object.assign(Object.create({}), content())), null);
  const rows = [version()]; Object.defineProperty(rows, "0", { get() { calls++; return version(); } }); assert.equal(parseMaterialsLibrary({ ok: true, versions: rows, nextBefore: null }, false, null), null); assert.equal(calls, 0);
});
test("version projection is exact and refuses forged metadata", () => {
  assert.deepEqual(parseMaterialsVersion(version()), version());
  for (const patch of [{ extra: true }, { revision: 0 }, { authorId: 0 }, { sha256: "wrong" }, { archived: "false" }, { createdAt: "2026-11-11T00:00:00.000000Z" }, { materialId: "../outside" }]) assert.equal(parseMaterialsVersion({ ...version(), ...patch }), null);
});
test("library validates filter, descending UUID cursor, cardinality and duplicates", () => {
  const rows = Array.from({ length: 50 }, (_, n) => version(1, content(), id(100 - n), { id: id(2000 + n) }));
  assert.equal(parseMaterialsLibrary({ ok: true, versions: rows, nextBefore: rows[49].materialId }, false, null)?.versions.length, 50);
  for (const wire of [{ ok: true, versions: [...rows].reverse(), nextBefore: null }, { ok: true, versions: [rows[0], rows[0]], nextBefore: null }, { ok: true, versions: [rows[0]], nextBefore: rows[0].materialId }, { ok: true, versions: [version(1, content(), id(100), { archived: true })], nextBefore: null }]) assert.equal(parseMaterialsLibrary(wire, false, null), null);
  assert.equal(parseMaterialsLibrary({ ok: true, versions: [version()], nextBefore: null }, false, id(100)), null);
});
test("history binds current head, ordinal cursor, material and immutable version identities", () => {
  const current = version(3); assert.equal(parseMaterialsHistory(history(current, [current, version(2), version(1)]), id(100), null)?.current.revision, 3);
  assert.ok(parseMaterialsHistory(history(current, [version(2), version(1)]), id(100), 3));
  for (const wire of [history(current, [version(2)]), history(current, [current, current]), history(current, [version(4)]), history(current, [version(3, content("forged"))]), history(current, [current, version(2, content(), id(101))])]) assert.equal(parseMaterialsHistory(wire, id(100), null), null);
});
test("receipt binding checks operation, author, content, expected revision and archive source hash", () => {
  const pending: MaterialsPending = { intent: { operation: "revise", requestId: id(500), materialId: id(100), expectedRevision: 1, content: content("saved") }, base: version() };
  assert.ok(parseMaterialsReceipt({ ok: true, replayed: false, version: version(2, content("saved")) }, pending, 1, true));
  for (const row of [version(3, content("saved")), version(2, content("wrong")), version(2, content("saved"), id(101)), version(2, content("saved"), id(100), { authorId: 2 })]) assert.equal(parseMaterialsReceipt({ ok: true, version: row }, pending, 1, false), null);
  const archived: MaterialsPending = { intent: { operation: "archive", requestId: id(500), materialId: id(100), expectedRevision: 1 }, base: version() };
  assert.ok(parseMaterialsReceipt({ ok: true, version: version(2, content(), id(100), { archived: true }) }, archived, 1, false));
  assert.equal(parseMaterialsReceipt({ ok: true, version: version(2, content("changed"), id(100), { archived: true }) }, archived, 1, false), null);
});
test("create submits exact structured body once and keeps receipt separate from head", async () => {
  const calls: { url: string; init: RequestInit }[] = []; const c = new MaterialsClient(ctx(null), async (url, init) => { calls.push({ url, init }); return json({ ok: true, replayed: false, version: version() }); });
  c.setDraft(content()); const result = await c.save({ operation: "create", requestId: id(500), content: content() }); assert.ok(result.ok);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/admin/materiais"); assert.equal(calls[0].init.method, "POST"); assert.equal(calls[0].init.credentials, "same-origin"); assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { operation: "create", requestId: id(500), content: content() });
  const state = c.getState(); assert.equal(state.head, null); assert.equal(state.receipt?.version.revision, 1); assert.equal(state.pending, null); assert.deepEqual(state.draft, content());
});
test("double submit cannot race a second POST", async () => {
  const wait = deferred<Response>(); let count = 0; const c = new MaterialsClient(ctx(null), async () => { count++; return wait.promise; }); c.setDraft(content());
  const first = c.save({ operation: "create", requestId: id(500), content: content() }); assert.deepEqual(await c.save({ operation: "create", requestId: id(501), content: content() }), { ok: false, error: "busy" });
  wait.resolve(json({ ok: true, replayed: false, version: version() })); assert.ok((await first).ok); assert.equal(count, 1);
});
test("lost response conserves same UUID and only an explicit GET recovers it", async () => {
  const calls: { url: string; method: string }[] = []; const c = new MaterialsClient(ctx(null), async (url, init) => { calls.push({ url, method: init.method! }); if (init.method === "POST") throw Error("lost after admission"); return json({ ok: true, version: version() }); });
  c.setDraft(content()); assert.deepEqual(await c.save({ operation: "create", requestId: id(500), content: content() }), { ok: false, error: "transport" });
  c.setDraft(content("edited while uncertain")); assert.equal(c.getState().pending?.intent.requestId, id(500)); assert.deepEqual(await c.save({ operation: "create", requestId: id(501), content: content("edited while uncertain") }), { ok: false, error: "recovery_required" });
  const found = await c.recoverPending(); assert.ok(found.ok); assert.equal(found.value.replayed, null); assert.deepEqual(calls, [{ url: "/api/admin/materiais", method: "POST" }, { url: "/api/admin/materiais/pedidos/" + id(500), method: "GET" }]);
  assert.equal(c.getState().draft?.title, "edited while uncertain");
});
test("503, malformed acknowledgement and recovery404 never free an uncertain intent", async () => {
  for (const first of [() => json({ ok: false, error: "unavailable" }, 503), () => new Response("{", { headers: { "content-type": "application/json" } })]) {
    const methods: string[] = []; const c = new MaterialsClient(ctx(null), async (_, init) => { methods.push(init.method!); return init.method === "POST" ? first() : json({ ok: false, error: "not_found" }, 404); }); c.setDraft(content());
    assert.equal((await c.save({ operation: "create", requestId: id(500), content: content() })).ok, false); assert.deepEqual(await c.recoverPending(), { ok: false, error: "not_found" }); assert.equal(c.getState().phase, "uncertain"); assert.equal(c.getState().pending?.intent.requestId, id(500)); assert.equal(c.reviewHead(), false); assert.deepEqual(methods, ["POST", "GET"]);
  }
});
test("timeout is bounded even when transport ignores AbortSignal", async () => {
  const c = new MaterialsClient(ctx(null), () => new Promise<Response>(() => {}), 5); c.setDraft(content());
  assert.deepEqual(await c.save({ operation: "create", requestId: id(500), content: content() }), { ok: false, error: "timeout" }); assert.equal(c.getState().pending?.intent.requestId, id(500)); assert.equal(c.getState().phase, "uncertain"); c.dispose();
});
test("a stalled JSON body is cancelled and cannot leave the operation busy forever", async () => {
  let cancelled = 0; const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const c = new MaterialsClient(ctx(null), async () => new Response(stream, { headers: { "content-type": "application/json" } }), 5); c.setDraft(content());
  assert.deepEqual(await c.save({ operation: "create", requestId: id(500), content: content() }), { ok: false, error: "timeout" }); assert.equal(cancelled, 1); assert.equal(c.getState().phase, "uncertain");
});
test("conflict preserves draft and requires a fresh head read plus explicit review", async () => {
  const methods: string[] = []; let posts = 0;
  const c = new MaterialsClient(ctx(), async (_, init) => { methods.push(init.method!); if (init.method === "GET") return json(history(version(2, content("other actor")))); posts++; return posts === 1 ? json({ ok: false, error: "conflict" }, 409) : json({ ok: true, replayed: false, version: version(3, content("Rascunho local")) }); });
  c.seedHead(version()); c.setDraft(content("Rascunho local")); assert.deepEqual(await c.save(revise()), { ok: false, error: "conflict" }); assert.equal(c.reviewHead(), false); assert.equal(c.getState().draft?.title, "Rascunho local");
  assert.ok((await c.loadHistory()).ok); assert.equal(c.getState().needsReview, true); assert.equal(c.reviewHead(), true); assert.equal(c.getState().draft?.title, "Rascunho local");
  assert.deepEqual(await c.save(revise(id(500), content("Rascunho local"), 2)), { ok: false, error: "request_conflict" });
  assert.ok((await c.save(revise(id(501), content("Rascunho local"), 2))).ok); assert.deepEqual(methods, ["POST", "GET", "POST"]);
});
test("replayed receipt cannot overwrite a newer head read while POST was pending", async () => {
  const wait = deferred<Response>(); const c = new MaterialsClient(ctx(), async (_, init) => init.method === "POST" ? wait.promise : json(history(version(3, content("newer head")))));
  c.seedHead(version()); c.setDraft(content("Rascunho local")); const saving = c.save(revise()); assert.ok((await c.loadHistory()).ok);
  wait.resolve(json({ ok: true, replayed: true, version: version(2, content("Rascunho local")) })); assert.ok((await saving).ok);
  const state = c.getState(); assert.equal(state.head?.revision, 3); assert.equal(state.head?.content.title, "newer head"); assert.equal(state.receipt?.version.revision, 2); assert.equal(state.receipt?.replayed, true);
});
test("actor change discards late mutation response without exposing previous draft", async () => {
  const wait = deferred<Response>(); const c = new MaterialsClient(ctx(null), () => wait.promise); c.setDraft(content()); const saving = c.save({ operation: "create", requestId: id(500), content: content() });
  c.setContext({ actorId: 2, actorScope: "2:20", materialId: null }); c.setDraft(content("new actor draft")); assert.deepEqual(await saving, { ok: false, error: "obsolete" });
  wait.resolve(json({ ok: true, replayed: false, version: version() })); await Promise.resolve(); assert.equal(c.getState().receipt, null); assert.equal(c.getState().pending, null); assert.equal(c.getState().draft?.title, "new actor draft");
});
test("material change discards late history and retains new selected head", async () => {
  const wait = deferred<Response>(); const c = new MaterialsClient(ctx(), () => wait.promise); const reading = c.loadHistory();
  c.setContext(ctx(id(101))); c.seedHead(version(1, content("new material"), id(101))); assert.deepEqual(await reading, { ok: false, error: "obsolete" });
  wait.resolve(json(history(version()))); await Promise.resolve(); assert.equal(c.getState().head?.materialId, id(101)); assert.equal(c.getState().draft?.title, "new material");
});
test("replacing a library filter discards the previous late page", async () => {
  const wait = deferred<Response>(); let count = 0; const c = new MaterialsClient(ctx(), () => ++count === 1 ? wait.promise : Promise.resolve(json({ ok: true, versions: [version(1, content(), id(100), { archived: true })], nextBefore: null })));
  const old = c.loadLibrary(false); assert.ok((await c.loadLibrary(true)).ok); assert.deepEqual(await old, { ok: false, error: "obsolete" }); wait.resolve(json({ ok: true, versions: [version()], nextBefore: null })); await Promise.resolve(); assert.equal(c.getState().library?.archived, true);
});
test("closed contexts, expectedRevision and local draft mismatch fail before any request", async () => {
  let calls = 0; const transport: MaterialsTransport = async () => { calls++; throw Error("must not call"); }; const c = new MaterialsClient(ctx(), transport);
  assert.equal(c.seedHead(version(1, content(), id(101))), false); c.seedHead(version()); c.setDraft(content("Rascunho local"));
  assert.deepEqual(await c.save(revise(id(500), content("other"))), { ok: false, error: "parameters" }); assert.deepEqual(await c.save(revise(id(500), content("Rascunho local"), 2)), { ok: false, error: "review_required" });
  assert.deepEqual(await c.save({ ...revise(), actorId: 2 }), { ok: false, error: "parameters" }); assert.equal(calls, 0);
  assert.throws(() => new MaterialsClient({ ...ctx(), actorId: 0 }, transport)); assert.equal(c.setContext({ ...ctx(), actorScope: "bad/scope" }), false);
});
test("snapshots and raw intent mutations cannot alter internal pending payload", async () => {
  const wait = deferred<Response>(); const c = new MaterialsClient(ctx(null), () => wait.promise); c.setDraft(content()); const raw = { operation: "create", requestId: id(500), content: content() }; const saving = c.save(raw);
  raw.content.title = "mutated externally"; const snapshot = c.getState(); snapshot.pending!.intent.requestId = id(999); snapshot.draft!.title = "changed snapshot";
  assert.equal(c.getState().pending?.intent.requestId, id(500)); assert.equal(c.getState().draft?.title, "Texto fictício");
  wait.resolve(json({ ok: true, replayed: false, version: version() })); assert.ok((await saving).ok);
});
test("shared guard errors and Materials errors are normalized without automatic mutation retry", async () => {
  for (const [status, wire, expected] of [[401, { ok: false, erro: "Não autorizado." }, "auth"], [403, { ok: false, erro: "Sem nível." }, "forbidden"], [429, { ok: false, erro: "Aguarde." }, "rate_limited"], [413, { ok: false, error: "parameters" }, "body_too_large"], [409, { ok: false, error: "disabled" }, "disabled"]] as const) {
    let count = 0; const c = new MaterialsClient(ctx(null), async () => { count++; return json(wire, status); }); c.setDraft(content()); assert.deepEqual(await c.save({ operation: "create", requestId: id(500), content: content() }), { ok: false, error: expected }); assert.equal(count, 1); assert.equal(c.getState().phase, "rejected"); assert.ok(c.getState().pending);
  }
});
test("invalid JSON MIME, UTF8 and oversized bodies preserve the last valid library", async () => {
  for (const response of [new Response("{}", { headers: { "content-type": "text/html" } }), new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }), new Response("x".repeat(1048577), { headers: { "content-type": "application/json" } })]) {
    let n = 0; const c = new MaterialsClient(ctx(), async () => ++n === 1 ? json({ ok: true, versions: [version()], nextBefore: null }) : response); assert.ok((await c.loadLibrary()).ok); assert.deepEqual(await c.loadLibrary(), { ok: false, error: "protocol" }); assert.equal(c.getState().library?.versions.length, 1);
  }
});
test("archive uses the known revision and immutable source content", async () => {
  let body: unknown; const c = new MaterialsClient(ctx(), async (_, init) => { body = JSON.parse(String(init.body)); return json({ ok: true, replayed: false, version: version(2, content(), id(100), { archived: true }) }); }); c.seedHead(version());
  assert.ok((await c.save({ operation: "archive", requestId: id(500), materialId: id(100), expectedRevision: 1 })).ok); assert.deepEqual(body, { operation: "archive", requestId: id(500), materialId: id(100), expectedRevision: 1 }); assert.equal(c.getState().head?.archived, false); assert.equal(c.getState().receipt?.version.archived, true);
});
test("dispose aborts pending reads and refuses future work", async () => {
  let count = 0; const c = new MaterialsClient(ctx(), async () => { count++; return new Promise<Response>(() => {}); }); const reading = c.loadHistory(); c.dispose(); assert.deepEqual(await reading, { ok: false, error: "obsolete" }); assert.deepEqual(await c.loadLibrary(), { ok: false, error: "obsolete" }); assert.equal(c.setContext(ctx()), false); assert.equal(count, 1);
});

test("closed browser catalogs cannot be mutated by a consumer", () => {
  assert.equal(Object.isFrozen(MATERIAL_CLIENT_TEMPLATES), true); assert.equal(Object.isFrozen(MATERIAL_CLIENT_ASSETS), true);
  assert.throws(() => (MATERIAL_CLIENT_TEMPLATES as unknown as string[]).push("arbitrary-html"));
});
test("recovered old receipt cannot overwrite a newer head", async () => {
  const c = new MaterialsClient(ctx(), async (url, init) => { if (init.method === "POST") throw Error("response lost"); return url.includes("pedidos/") ? json({ ok: true, version: version(2, content("Rascunho local")) }) : json(history(version(3, content("new head")))); });
  c.seedHead(version()); c.setDraft(content("Rascunho local")); await c.save(revise()); assert.ok((await c.loadHistory()).ok); assert.ok((await c.recoverPending()).ok);
  assert.equal(c.getState().head?.revision, 3); assert.equal(c.getState().receipt?.version.revision, 2); assert.equal(c.getState().receipt?.replayed, null);
});
test("same context is stable, but another session invalidates a pending result", async () => {
  const wait = deferred<Response>(); const c = new MaterialsClient(ctx(null), () => wait.promise); c.setDraft(content()); const saving = c.save({ operation: "create", requestId: id(500), content: content() });
  assert.equal(c.setContext({ ...ctx(null) }), true); assert.equal(c.getState().phase, "saving");
  assert.equal(c.setContext({ ...ctx(null), actorScope: "1:11" }), true); assert.deepEqual(await saving, { ok: false, error: "obsolete" }); wait.resolve(json({ ok: true, replayed: false, version: version() })); await Promise.resolve(); assert.equal(c.getState().receipt, null); assert.equal(c.getState().draft, null);
});
test("disposing a pending mutation reports uncertainty rather than a permanently busy state", async () => {
  const c = new MaterialsClient(ctx(null), () => new Promise<Response>(() => {})); c.setDraft(content()); const saving = c.save({ operation: "create", requestId: id(500), content: content() }); c.dispose();
  assert.deepEqual(await saving, { ok: false, error: "obsolete" }); assert.equal(c.getState().phase, "uncertain"); assert.equal(c.getState().pending?.intent.requestId, id(500)); assert.equal(c.getState().loadingHistory, false); assert.equal(c.getState().loadingLibrary, false);
});
