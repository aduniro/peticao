import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseDocumentHistoryPage as parse, appendDocumentHistory as append, documentHistorySignatureLabel as signatureLabel, loadDocumentHistoryPage as load } from "./document-history-view";
import HistoricoDocumento from "../components/admin/HistoricoDocumento";

const row = (ordinal = 3, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`, batch_id: 7, ordinal, variant: "signed", sha256: "a".repeat(64), list_hash: "b".repeat(64), signature_kind: "icp-brasil", source: "upload", author_id: 1, recorded_by: 2, captured_at: "2026-11-09T12:34:56.789Z", byte_length: 123, ...extra });
const response = (versions = [row()], nextBefore: number | null = null) => ({ ok: true, versions, nextBefore });

test("metadata projection retains exact links/hash/known numeric authors but never copies note/binary or invents legacy identity", () => {
  const page = parse(response([row(3, { note: "QA NEVER SHOW PRIVATE NOTE", unknown: "QA NEVER SHOW EXTRA" }), row(2, { source: "legacy-observed", author_id: null, signature_kind: null })]), 7); assert.ok(page);
  assert.equal(page.versions[0].authorId, 1); assert.equal(page.versions[0].recordedBy, 2); assert.equal(page.versions[1].authorId, null); assert.equal(page.versions[1].signatureKind, null);
  assert.ok(!JSON.stringify(page).includes("QA NEVER SHOW"));
  assert.equal(parse(response([row(1, { source: "legacy-observed", author_id: 9 })]), 7), null);
  assert.equal(parse(response([row(1, { bytes: "QA NEVER DOWNLOAD" })]), 7), null);
});

test("parser rejects mixed batches, malformed IDs/hashes/dates/cursors, duplicate or unsorted versions and excessive pages", () => {
  for (const extra of [{ batch_id: 8 }, { id: "../other" }, { sha256: "wrong" }, { captured_at: "bad" }, { captured_at: "2026-11-09" }, { author_id: 0 }, { recorded_by: "QA" }, { byte_length: -1 }, { variant: "other" }]) assert.equal(parse(response([row(3, extra)]), 7), null, JSON.stringify(extra));
  assert.equal(parse(response([row(2), row(3)]), 7), null); assert.equal(parse(response([row(3), row(3)]), 7), null);
  assert.equal(parse(response([row()], 2), 7), null); assert.equal(parse(response([], 1), 7), null);
  assert.equal(parse(response(Array.from({ length: 51 }, (_, i) => row(100 - i))), 7), null);
  const unknown = parse(response([row(3, { signature_kind: "QA-UNKNOWN-KIND", list_hash: "QA NEVER SHOW PRIVATE LIST VALUE" })]), 7); assert.ok(unknown); assert.equal(unknown.versions[0].signatureKind, null); assert.equal(unknown.versions[0].listHash, null);
});

test("pagination appends older records without accepting contradictions or mutating the retained page", () => {
  const first = parse(response([row(3), row(2)], 2), 7)!, last = parse(response([row(1)]), 7)!;
  const snapshot = structuredClone(first), merged = append(first, last); assert.ok(merged); assert.deepEqual(merged.versions.map(r => r.ordinal), [3, 2, 1]); assert.equal(merged.nextBefore, null); assert.deepEqual(first, snapshot);
  assert.equal(append(first, parse(response([row(2)]), 7)!), null); assert.equal(append(first, parse(response([row(4)]), 7)!), null);
});

test("metadata client uses only bounded same-origin GET and preserves auth/stepup/error distinctions", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const fake = (async (url: string | URL | Request, options?: RequestInit) => { calls.push({ url: String(url), options }); return Response.json(response([row(1)])); }) as typeof fetch;
  assert.ok((await load(fake, 7, 2)).ok); assert.equal(calls[0].url, "/api/admin/lotes/7/versoes?antes=2"); assert.equal(calls[0].options?.method, "GET"); assert.equal(calls[0].options?.credentials, "same-origin"); assert.equal(calls[0].options?.cache, "no-store");
  for (const [status, body, error] of [[401, {}, "auth"], [403, { erro: "stepup" }, "stepup"], [403, {}, "forbidden"], [503, {}, "unavailable"]] as const) assert.deepEqual(await load((async () => Response.json(body, { status })) as typeof fetch, 7), { ok: false, error });
  const count = calls.length; assert.deepEqual(await load(fake, 0), { ok: false, error: "parameters" }); assert.equal(calls.length, count);
  assert.deepEqual(await load((async () => Response.json(response([row(3)]))) as typeof fetch, 7, 2), { ok: false, error: "unavailable" });
});

test("a failed older page leaves caller metadata and cursor intact so the same request can recover", async () => {
  const first = parse(response([row(3), row(2)], 2), 7)!, before = structuredClone(first);
  assert.equal((await load((async () => new Response("unavailable", { status: 503 })) as typeof fetch, 7, first.nextBefore!)).ok, false);
  assert.deepEqual(first, before);
  const result = await load((async () => Response.json(response([row(1)]))) as typeof fetch, 7, first.nextBefore!); assert.ok(result.ok); assert.deepEqual(append(first, result.page)?.versions.map(r => r.ordinal), [3, 2, 1]);
});

test("history renders collapsed with neutral controls and does not fetch metadata or PDF bytes automatically", () => {
  const old = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = (async () => { calls++; throw new Error("No automatic requests"); }) as typeof fetch;
    const html = renderToStaticMarkup(React.createElement(HistoricoDocumento, { batchId: 7 }));
    assert.match(html, /Histórico/); assert.match(html, /<dialog/); assert.ok(!html.includes("<iframe")); assert.ok(!html.includes("/api/admin/lotes/7/versoes/")); assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});


test("mixed own/A1/prepared/upload/legacy history stays readable without upgrading the own confirmation", async () => {
  const raw = response([
    row(5, { source: "a1-worker", signature_kind: "icp-brasil" }),
    row(4, { source: "president-own", signature_kind: "own-confirmation" }),
    row(3, { source: "upload", signature_kind: "externa-nao-validada" }),
    row(2, { source: "legacy-observed", author_id: null, signature_kind: null }),
    row(1, { source: "prepared", variant: "original", signature_kind: "none" }),
  ]);
  const page = parse(raw, 7); assert.ok(page); assert.equal(page.versions.length, 5);
  assert.deepEqual(page.versions.map(r => r.source), ["a1-worker", "president-own", "upload", "legacy-observed", "prepared"]);
  assert.equal(signatureLabel(page.versions[0].signatureKind), "ICP-Brasil");
  assert.equal(signatureLabel(page.versions[1].signatureKind), "Confirmação própria");
  assert.notEqual(signatureLabel(page.versions[1].signatureKind), "ICP-Brasil");
  const loaded = await load((async () => Response.json(raw)) as typeof fetch, 7); assert.ok(loaded.ok); assert.deepEqual(loaded.page, page);
});

test("history refuses unknown sources and contradictory own/A1 methods; unknown legacy methods stay neutral", () => {
  for (const extra of [
    { source: "unknown-source" },
    { source: "president-own", signature_kind: "icp-brasil" },
    { source: "president-own", signature_kind: "own-confirmation", variant: "original" },
    { source: "president-own", signature_kind: "unknown-kind" },
    { source: "a1-worker", signature_kind: "own-confirmation" },
    { source: "a1-worker", signature_kind: "icp-brasil", variant: "original" },
  ]) assert.equal(parse(response([row(1, extra)]), 7), null);
  const unknown = parse(response([row(1, { signature_kind: "unknown-method" })]), 7); assert.ok(unknown);
  assert.equal(unknown.versions[0].signatureKind, null); assert.equal(signatureLabel(unknown.versions[0].signatureKind), "—");
});
