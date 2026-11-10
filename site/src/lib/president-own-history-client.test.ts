import test from "node:test";
import assert from "node:assert/strict";
import { appendOwnHistory, ownHistoryRequest, parseOwnHistory } from "./president-own-history-client";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const receipt = (n: number) => ({ challengeId: uuid(n), receiptId: uuid(n + 100), batchId: 1, responsibleId: 2, issuedBy: 1, documentVersion: "a".repeat(64), createdAt: "2026-11-10T00:00:00.123456Z", confirmedAt: "2026-11-10T00:00:01.123456Z", isCurrent: true, assurance: "own-confirmation", icpBrasil: false, govBr: false, dispatchAllowed: false });
const page = (rows: ReturnType<typeof receipt>[] | Record<string, unknown>[] = [receipt(20)], more = false) => ({ ok: true, kind: "receipts", batchId: 1, receipts: rows, hasMore: more, nextCursor: more ? rows.at(-1)!.challengeId : null });
test("inventory rejects secrets, false assurance, cross-batch and malformed cursors", () => {
  assert.ok(parseOwnHistory(page(), "receipts", 1));
  for (const change of [{ token: "secret" }, { cpf: "fake" }, { isCurrent: true, documentVersion: null }, { icpBrasil: true }, { batchId: 2 }, { confirmedAt: "2026-11-09T00:00:00.123456Z" }]) assert.equal(parseOwnHistory(page([{ ...receipt(20), ...change }]), "receipts", 1), null);
  assert.equal(parseOwnHistory({ ...page(), nextCursor: uuid(20) }, "receipts", 1), null);
  assert.equal(parseOwnHistory(page(), "receipts", 1, uuid(20)), null);
});
test("strict twenty-row pages retain six microseconds and append only matching cursor", () => {
  const first = parseOwnHistory(page(Array.from({ length: 20 }, (_, i) => receipt(40-i)), true), "receipts", 1)!;
  assert.equal(first.rows[0].createdAt, "2026-11-10T00:00:00.123456Z");
  const second = parseOwnHistory(page([receipt(20)]), "receipts", 1, first.nextCursor!)!;
  assert.equal(appendOwnHistory(first, second, first.nextCursor!)!.rows.length, 21);
  assert.equal(appendOwnHistory(first, second, uuid(99)), null);
  assert.equal(parseOwnHistory(page([receipt(2), receipt(3)]), "receipts", 1), null);
  assert.equal(parseOwnHistory(page([receipt(3), receipt(3)]), "receipts", 1), null);
  assert.equal(parseOwnHistory(page(Array.from({ length: 21 }, (_, i) => receipt(40-i))), "receipts", 1), null);
});
test("historical receipt without legacy digest remains readable but cannot be current", () => {
  const r = { ...receipt(3), documentVersion: null, isCurrent: false };
  assert.ok(parseOwnHistory(page([r as unknown as ReturnType<typeof receipt>]), "receipts", 1));
});
test("artifact whitelist permits only protected metadata and never bytes/canonical", () => {
  const artifact = { artifactId: uuid(1), receiptId: uuid(2), batchId: 1, documentVersion: "a".repeat(64), sha256: "b".repeat(64), sourceSha256: "c".repeat(64), byteLength: 2048, createdBy: 1, createdAt: "2026-11-10T00:00:00.123456Z", source: "president-own", assurance: "own-confirmation", icpBrasil: false, govBr: false, dispatchAllowed: false };
  const value = { ok: true, kind: "artifacts", batchId: 1, documents: [artifact], hasMore: false, nextCursor: null };
  assert.ok(parseOwnHistory(value, "artifacts", 1));
  assert.equal(parseOwnHistory({ ...value, documents: [{ ...artifact, bytes: "pdf" }] }, "artifacts", 1), null);
  assert.equal(parseOwnHistory({ ...value, documents: [{ ...artifact, source: "a1-worker" }] }, "artifacts", 1), null);
});
test("one-shot GET is private, bounded, does not retry on 503 or timeout", async () => {
  let calls = 0;
  const transport = (async (url: unknown, options: RequestInit) => {
    calls++;assert.equal(String(url), "/api/admin/lotes/1/presidente/historico?kind=receipts");assert.equal(options.method, "GET");assert.equal(options.redirect, "error");assert.equal(options.cache, "no-store");assert.equal(options.credentials, "same-origin");assert.equal(options.body, undefined);
    return new Response(JSON.stringify(page()), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  assert.ok(await ownHistoryRequest(1, "receipts", undefined, transport));assert.equal(calls, 1);
  assert.equal(await ownHistoryRequest(1, "receipts", "bad", transport), null);assert.equal(calls, 1);
  const failed = (async () => { calls++;return new Response("", { status: 503 }); }) as typeof fetch;
  assert.equal(await ownHistoryRequest(1, "receipts", undefined, failed), null);assert.equal(calls, 2);
  const hang = (() => { calls++;return new Promise(() => {}); }) as typeof fetch;
  assert.equal(await ownHistoryRequest(1, "receipts", undefined, hang, 5), null);assert.equal(calls, 3);
  assert.equal(await ownHistoryRequest(1, "receipts", undefined, (async () => new Response("x".repeat(65537), { headers: { "content-type": "application/json" } })) as typeof fetch), null);
});
