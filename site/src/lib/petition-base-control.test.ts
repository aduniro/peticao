import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { PeticaoBaseGovBrControl } from "../components/admin/PeticaoBaseGovBr";
test("actual gov.br control renders approved copy and no preselected document or native POST", () => {
  const markup = renderToStaticMarkup(React.createElement(PeticaoBaseGovBrControl, { batchId: 7, actorId: 1, petitionTextVersion: "a".repeat(64) }));
  for (const text of ["Petição-base gov.br", "Carregar PDF assinado", "Preparar pacote para revisão", "Os PDFs do lote e da petição-base serão mantidos como arquivos separados."]) assert.ok(markup.includes(text));
  assert.ok(markup.includes('class="adm-modal"')); assert.ok(markup.includes('type="file"')); assert.equal(markup.includes("<form"), false); assert.equal(markup.includes('href="/api/admin/documentos/base/'), false);
  assert.ok(markup.includes('disabled=""')); assert.equal(markup.includes("%PDF"), false); assert.equal(markup.includes("signerCpf"), false);
});
test("both protected pages connect the flow without a bypass around package review", () => {
  const president = readFileSync(new URL("../app/admin/presidente/page.tsx", import.meta.url), "utf8"), batches = readFileSync(new URL("../app/admin/lotes/page.tsx", import.meta.url), "utf8");
  assert.ok(president.includes("<PeticaoBaseGovBr")); assert.ok(president.includes("reviewed.approvalReady")); assert.ok(president.includes('process.env.GOVBR_BASE_ENABLED === "1"'));
  assert.ok(batches.includes('process.env.BATCH_PACKAGE_ENABLED === "1" ? <a')); assert.ok(batches.includes("/admin/presidente?lote="));
});
