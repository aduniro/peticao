import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markdownParaHtml, formatarCorpoEmail } from "../ponte/formatar-email.mjs";

test("Markdown becomes rich HTML with semantic tables, emphasis and lists", () => {
  const html = markdownParaHtml("# Relatório\n\n**Conferência** e `status`.\n\n| Caso | Quantidade |\n|---|---:|\n| Pendente | 24 |\n\n- Primeiro\n- Segundo");
  assert.match(html, /<h1[^>]*>Relatório<\/h1>/);
  assert.match(html, /<strong>Conferência<\/strong>/); assert.match(html, /<code[^>]*>status<\/code>/);
  assert.match(html, /<table role="table"/); assert.match(html, /<thead>/); assert.match(html, /scope="col"/);
  assert.match(html, /text-align:right/); assert.match(html, /<li>Primeiro<\/li>/);
  assert.ok(!html.includes("|---|"));
});
test("Markdown cannot insert active HTML, unsafe links or tracking images", () => {
  const html = markdownParaHtml('<script>alert(1)</script>\n\n<img src="https://example.test/pixel" onerror="alert(1)">\n\n[bad](javascript:alert%281%29) ![alternative](https://example.test/pixel) [good](https://example.test/report)');
  assert.ok(!/<script\b|<img\b/i.test(html)); assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /&lt;script&gt;/); assert.match(html, /href="https:\/\/example.test\/report"/);
});
test("existing HTML is preserved and text-only callers now receive both alternatives", () => {
  const html = "<p>Mensagem existente</p>";
  assert.deepEqual(formatarCorpoEmail({html,texto:"Alternativa"}), {html,texto:"Alternativa"});
  const body = formatarCorpoEmail({texto:"## Resposta\n\nTexto."}); assert.match(body.html, /<h2/); assert.equal(body.texto,"## Resposta\n\nTexto.");
  assert.throws(()=>formatarCorpoEmail({texto:" "}),/email_body_required/);
});
test("full audit report retains all Markdown tables and their rows in HTML", () => {
  const source = readFileSync(new URL("../../docs/AUDITORIA-EXPERIENCIA-ASSINATURAS-20261107.md",import.meta.url),"utf8");
  const html = markdownParaHtml(source);
  const separators = source.split("\n").filter(line=>/^\|[-: |]+\|$/.test(line)).length;
  assert.equal((html.match(/<table role="table"/g)??[]).length,separators);
  const dataRows = source.split("\n").filter(line=>/^\|/.test(line)&&!/^\|[-: |]+\|$/.test(line)).length;
  assert.equal((html.match(/<tr>/g)??[]).length-1,dataRows);
  assert.match(html,/56/); assert.match(html,/138/); assert.match(html,/request_log.email_hash/);
});
