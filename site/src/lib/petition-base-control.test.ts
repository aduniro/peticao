import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PeticaoBaseGovBrControl } from "../components/admin/PeticaoBaseGovBr";
test("actual gov.br control renders approved copy and no preselected document or native POST", () => {
  const markup = renderToStaticMarkup(React.createElement(PeticaoBaseGovBrControl, { batchId: 7, actorId: 1, petitionTextVersion: "a".repeat(64) }));
  for (const text of ["Petição-base gov.br", "Carregar PDF assinado", "Preparar pacote para revisão", "Os PDFs do lote e da petição-base serão mantidos como arquivos separados."]) assert.ok(markup.includes(text));
  assert.ok(markup.includes('class="adm-modal"')); assert.ok(markup.includes('type="file"')); assert.equal(markup.includes("<form"), false); assert.equal(markup.includes('href="/api/admin/documentos/base/'), false);
  assert.ok(markup.includes('disabled=""')); assert.equal(markup.includes("%PDF"), false); assert.equal(markup.includes("signerCpf"), false);
});
test("multiple actual controls produce independent dialog labels without native submission", () => {
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(PeticaoBaseGovBrControl, { batchId: 7, actorId: 1, petitionTextVersion: "a".repeat(64) }),
    React.createElement(PeticaoBaseGovBrControl, { batchId: 8, actorId: 1, petitionTextVersion: "a".repeat(64) })));
  const labels = [...markup.matchAll(/<dialog[^>]*aria-labelledby="([^"]+)"/g)].map(m => m[1]);
  assert.equal(labels.length, 2); assert.equal(new Set(labels).size, 2);
  for (const label of labels) assert.ok(markup.includes('id="' + label + '"'));
  assert.equal(markup.includes("<form"), false);
});
