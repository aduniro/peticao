import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadPresidentPdf, presidentAccessView, readPresidentAccess } from "./president-confirmation-access";
const token = "A".repeat(43), password = "FICTICIO0000", receiptId = "00000000-0000-4000-8000-000000000001";
const bytes = new TextEncoder().encode("%PDF-FICTITIOUS TEST ONLY");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const document = { batchId: 1, seq: 2, kind: "final", documentVersion: "a".repeat(64), sha256: hash(bytes), byteLength: bytes.length };
const body = { ok: true, state: "issued", canConfirm: true, expiresAt: "2026-11-09T12:10:00.000Z", document, receipt: null };
const receipt = { receiptId, confirmedAt: "2026-11-09T12:01:00.000Z", assurance: "own-confirmation", icpBrasil: false, govBr: false };
const pdf = (headers: Record<string, string> = {}, payload = bytes) => new Response(payload, { headers: { "content-type": "application/pdf", "x-document-version": document.documentVersion, "x-document-sha256": document.sha256, ...headers } });

test("real access contract is picked and rejects contradictory receipt/state without profile values", () => {
  const view = presidentAccessView({ ...body, unknown: "NEVER_DISPLAY", document: { ...document, cpf: "NEVER_DISPLAY" } }); assert.ok(view); assert.ok(!JSON.stringify(view).includes("NEVER_DISPLAY"));
  assert.ok(presidentAccessView({ ...body, state: "consumed", canConfirm: false, receipt }));
  assert.ok(presidentAccessView({ ...body, state: "verifying", canConfirm: true }), "Only server can admit lease-expired manual retry");
  assert.equal(presidentAccessView({ ...body, state: "consumed", canConfirm: true, receipt }), null);
  assert.equal(presidentAccessView({ ...body, state: { toString: null } }), null);
  for (const value of [{ ...body, receipt }, { ...body, state: "consumed", canConfirm: false }, { ...body, state: "consumed", canConfirm: false, receipt: { ...receipt, icpBrasil: true } }, { ...body, document: { ...document, byteLength: 0 } }, { ...body, expiresAt: "invalid" }]) assert.equal(presidentAccessView(value), null);
});
test("PDF loads only after exact version, bytes and hash match, with no identity or confirmation call", async () => {
  const requests: string[] = [];
  const transport = (async (url, options) => { requests.push(String(url)); assert.deepEqual(JSON.parse(String(options?.body)), { token, password }); return String(url).endsWith("estado") ? Response.json(body) : pdf(); }) as typeof fetch;
  const view = await loadPresidentPdf({ token, password }, transport, async value => hash(value)); assert.equal(view.kind, "available");
  assert.deepEqual(requests, ["/api/presidente/estado", "/api/presidente/documento"]);
  if (view.kind === "available") { assert.equal(view.pdf.size, bytes.length); assert.equal(view.serverState, "issued"); }
});
test("consumed challenge restores only the own-confirmation receipt, without PDF fetch or identity lookup", async () => {
  let calls = 0;
  const view = await loadPresidentPdf({ token, password }, (async () => { calls++; return Response.json({ ...body, state: "consumed", canConfirm: false, receipt }); }) as typeof fetch);
  assert.deepEqual(view, { kind: "confirmed", documentVersion: document.documentVersion, receiptId }); assert.equal(calls, 1);
});
test("wrong headers, corrupt/oversized/truncated PDF and wrong digest are never exposed", async () => {
  const variants = [() => pdf({ "x-document-version": "b".repeat(64) }), () => pdf({ "x-document-sha256": "b".repeat(64) }), () => pdf({ "content-type": "text/html" }), () => pdf({}, new Uint8Array([...bytes, 1])), () => pdf({}, bytes.slice(0, 6)), () => pdf({ "content-length": "1" })];
  for (const variant of variants) assert.deepEqual(await loadPresidentPdf({ token, password }, (async url => String(url).endsWith("estado") ? Response.json(body) : variant()) as typeof fetch, async value => hash(value)), { kind: "uncertain" });
  assert.deepEqual(await loadPresidentPdf({ token, password }, (async url => String(url).endsWith("estado") ? Response.json(body) : pdf()) as typeof fetch, async () => "b".repeat(64)), { kind: "uncertain" });
});
test("read failure is generic, JSON is bounded and no mutation retry occurs", async () => {
  for (const response of [new Response("bad"), new Response("x".repeat(20000), { headers: { "content-type": "application/json" } }), Response.json({ ...body, state: "unknown" })]) assert.deepEqual(await readPresidentAccess({ token, password }, (async () => response) as typeof fetch), { kind: "uncertain" });
  assert.deepEqual(await readPresidentAccess({ token, password }, (async () => new Response(null, { status: 409 })) as typeof fetch), { kind: "rejected" });
  let calls = 0; assert.deepEqual(await readPresidentAccess({ token, password }, (async () => { calls++; throw new Error("FICTITIOUS LOSS"); }) as typeof fetch), { kind: "uncertain" }); assert.equal(calls, 1);
});


test("verifying state follows server canConfirm exactly and never becomes success by client time", async () => {
  for (const canConfirm of [false, true]) {
    const view = await loadPresidentPdf({ token, password }, (async url => String(url).endsWith("estado") ? Response.json({ ...body, state: "verifying", canConfirm }) : pdf()) as typeof fetch, async value => hash(value));
    assert.equal(view.kind, "available"); if (view.kind === "available") { assert.equal(view.canConfirm, canConfirm); assert.equal(view.serverState, "verifying"); }
  }
  const { canConfirm: _omitted, ...without } = body; assert.equal(presidentAccessView(without), null);
});


test("encoded transfer length does not override decoded PDF bytes/hash verification", async () => {
  const view = await loadPresidentPdf({ token, password }, (async url => String(url).endsWith("estado") ? Response.json(body) : pdf({ "content-encoding": "gzip", "content-length": "1" })) as typeof fetch, async value => hash(value));
  assert.equal(view.kind, "available");
});
