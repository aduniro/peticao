import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Inbox from "../components/admin/Inbox";
import { appendInboxPage, inboxAccount, inboxGet, InboxRequestError, parseInboxMessages, parseInboxPreview, parseInboxThreads } from "./inbox-view";
import { gruposVisiveis, grupoDe, tituloDe } from "../components/admin/shell/menu";
const id = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002", at = "2026-11-09T12:00:00.123456Z";
const thread = { thread_root: id, messages: 2, available: 1, last_at: at };
const message = { id, received_at: at, created_at: at, expires_at: at, state: "available", correlation: "new" };
const ready = { state: "ready", subject: "QA assunto", transformed: true, html: "<!doctype html><html><body>QA transformado</body></html>", attachments: [{ filename: "anexo.txt", bytes: 4 }], attachmentsTruncated: false };

test("inbox lists project metadata only and preserve full timestamp precision", () => {
  const threads = parseInboxThreads({ ok: true, threads: [{ ...thread, subject: "NEVER LIST", body: "NEVER LIST" }], nextCursor: null });
  assert.deepEqual(threads, { rows: [thread], nextCursor: null }); assert.ok(!JSON.stringify(threads).includes("NEVER LIST"));
  assert.deepEqual(parseInboxMessages({ ok: true, messages: [{ ...message, html: "NEVER LIST" }], nextCursor: null }), { rows: [message], nextCursor: null });
  for (const bad of [{ ...thread, available: 3 }, { ...thread, messages: 0 }, { ...thread, last_at: "invalid" }, { ...thread, thread_root: "bad" }]) assert.equal(parseInboxThreads({ ok: true, threads: [bad], nextCursor: null }), null);
  assert.equal(parseInboxMessages({ ok: true, messages: [{ ...message, state: "stored" }], nextCursor: null }), null);
});

test("inbox page validation and append reject mixed or overlapping pages without mutation", () => {
  for (const bad of [{ ok: true, threads: [thread, thread], nextCursor: null }, { ok: true, threads: [], nextCursor: "cursor" }, { ok: true, threads: [thread], nextCursor: "?bad" }, { ok: true, threads: Array(21).fill(thread), nextCursor: null }]) assert.equal(parseInboxThreads(bad), null);
  const first = { rows: [thread], nextCursor: "first" }, next = { rows: [{ ...thread, thread_root: other }], nextCursor: null };
  const before = structuredClone(first); assert.equal(appendInboxPage(first, first, r => r.thread_root), null);
  assert.deepEqual(appendInboxPage(first, next, r => r.thread_root), { rows: [...first.rows, ...next.rows], nextCursor: null }); assert.deepEqual(first, before);
});

test("only explicitly transformed preview API envelope is accepted; attachment fields are bounded", () => {
  const raw = { ok: true, state: "preview", preview: ready };
  assert.deepEqual(parseInboxPreview(raw), { state: "ready", subject: ready.subject, html: ready.html, attachments: ready.attachments });
  for (const bad of [ready, { ...raw, state: "stored" }, { ...raw, preview: { ...ready, transformed: false } }, { ...raw, preview: { ...ready, attachments: Array(5).fill(ready.attachments[0]) } }, { ...raw, preview: { ...ready, attachments: [{ filename: "bad", bytes: -1 }] } }, { ...raw, preview: { ...ready, html: "x".repeat(1_000_001) } }]) assert.equal(parseInboxPreview(bad), null);
  assert.deepEqual(parseInboxPreview({ ok: true, state: "preview", preview: { state: "limited" } }), { state: "limited" });
});

test("inbox transport is one same-origin GET with no cache and caller cancellation", async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await inboxGet((async (url, options) => { calls++; assert.equal(url, "/api/admin/inbox/conversas?account=qa"); assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.cache, "no-store"); assert.equal(options?.signal, controller.signal); assert.equal(options?.body, undefined); return Response.json({ ok: true }); }) as typeof fetch, "/api/admin/inbox/conversas?account=qa", controller.signal);
  assert.deepEqual(result, { ok: true }); assert.equal(calls, 1);
  await assert.rejects(inboxGet((async () => new Response(null, { status: 410 })) as typeof fetch, "/api/admin/inbox/mensagens/x/previa", controller.signal), error => error instanceof InboxRequestError && error.status === 410);
});

test("inbox initial UI has no content frame, automatic account selection or byte downloads", () => {
  const html = renderToStaticMarkup(React.createElement(Inbox));
  assert.ok(html.includes("Conta")); assert.ok(!html.includes("<iframe")); assert.ok(!html.includes("/anexos/")); assert.ok(!html.includes("srcdoc="));
  assert.ok(inboxAccount("qa_mail-1")); for (const v of ["", "../qa", "qa@example.test", "a".repeat(81)]) assert.equal(inboxAccount(v), false);
});

test("inbox navigation belongs to communication and is hidden from read-only role", () => {
  assert.equal(grupoDe("/admin/inbox"), "comunicacao"); assert.equal(tituloDe("/admin/inbox"), "Caixa de entrada");
  assert.ok(!gruposVisiveis("leitura").flatMap(g => g.itens).some(i => i.href === "/admin/inbox"));
  assert.ok(gruposVisiveis("edicao").flatMap(g => g.itens).some(i => i.href === "/admin/inbox"));
});
