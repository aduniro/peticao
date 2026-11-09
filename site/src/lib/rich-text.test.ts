import test from "node:test";
import assert from "node:assert/strict";
import { renderRichText } from "./rich-text";
import { richTextPreviewDocument } from "./rich-text-preview";

test("texto legado permanece literal e Markdown tem formatação/alternativa sem interpretar como comando", () => {
  const plain = "QA **literal** <b>sem HTML</b>\n\nJosé";
  assert.equal(renderRichText(plain, "texto").text, plain); assert.ok(renderRichText(plain, "texto").html.includes("&lt;b&gt;"));
  const rich = renderRichText("## Título\n\n**Negrito**, *itálico* e [referência](https://example.test/fonte).\n\n- Um\n- Dois", "markdown");
  assert.match(rich.html, /<h2>Título<\/h2>/); assert.match(rich.html, /<strong>Negrito<\/strong>/); assert.match(rich.html, /href="https:\/\/example.test\/fonte"/);
  assert.ok(rich.text.includes("referência (https://example.test/fonte)")); assert.ok(rich.text.includes("- Dois")); assert.ok(!rich.previewHtml.includes("href="));
});

test("HTML rico remove scripts/estilos/recursos/atributos ativos e protocolos perigosos", () => {
  const source = '<p style="display:none" onclick="alert(1)">QA seguro <strong>José</strong></p><script>PRIVATE_SCRIPT</script><style>PRIVATE_STYLE</style><img src="https://tracker.test/pixel"><iframe src="https://tracker.test/frame"></iframe><form action="https://tracker.test/"><input value="PRIVATE"></form><svg onload="alert(1)"><text>PRIVATE_SVG</text></svg><math><mtext>PRIVATE_MATH</mtext></math><a href="java&#x0a;script:alert(1)">Perigo</a><a href="data:text/html,PRIVATE">Dados</a><a href="https://example.test/?a=1&amp;b=2" ping="https://tracker.test/ping" target="_blank">Fonte</a>';
  const out = renderRichText(source, "html"); assert.match(out.html, /<strong>José<\/strong>/);
  for (const text of ["PRIVATE", "tracker.test", "onclick", "javascript", "data:text", "style=", "target=", "ping="]) assert.ok(!JSON.stringify(out).includes(text), text);
  assert.match(out.html, /href="https:\/\/example.test\/\?a=1&amp;b=2"/); assert.ok(!out.previewHtml.includes("href=")); assert.ok(out.text.includes("Fonte (https://example.test/?a=1&b=2)"));
  const doc = richTextPreviewDocument(out.previewHtml, '<QA>'); assert.ok(doc.includes("default-src 'none'")); assert.ok(doc.includes("&lt;QA&gt;")); assert.ok(!doc.includes("href="));
});

test("limites e HTML malformado não deixam markup original atravessar a prévia", () => {
  for (const source of ["x".repeat(20_001), "QA\0BAD"]) assert.throws(() => renderRichText(source, "html"), /rich_text_parameters/);
  assert.throws(() => renderRichText("<div>".repeat(70) + "QA" + "</div>".repeat(70), "html"), /rich_text_limit/);
  const malformed = renderRichText('<table><tr><td>QA<strong>seguro</table><a href="file:///tmp/secret">local', "html");
  assert.ok(!malformed.html.includes("file:")); assert.ok(malformed.text.includes("seguro")); assert.ok(!malformed.previewHtml.includes("href="));
});
