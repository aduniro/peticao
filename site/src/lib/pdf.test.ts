import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("PDF: gera páginas com bloco por assinatura (servidor da região, apoiador, estrangeiro) e nomes de vários alfabetos", async () => {
  const { buildBatchPdf } = await import("./pdf");
  const { PDFDocument } = await import("pdf-lib");
  const mk = (i: number, o: any = {}) => ({ id: i, seq: i, verify_code: `ABCDE${String(10000 + i).slice(0, 5)}`, confirmed_at: "2026-11-03T17:32:10.000Z", name: `Pessoa ${i}`, role: null, institution: null, city: null, uf: null, ...o });
  const rows = [
    mk(1, { category: "servidor", role: "docente", institution: "Universidade Federal de Rondônia", campus: "Ji-Paraná", campus_ibge: 1100122, region_validated: true, cpf_name_check: "match" }),
    mk(2, { category: "servidor", institution: "UFPR" }),
    mk(3, { category: "apoiador", city: "Porto Velho", uf: "RO" }),
    mk(4, { category: "estrangeiro", country: "RU", university: "Московский университет", name: "Анна Петрова" }),
    mk(5, { category: "estrangeiro", country: "PL", university: "Uniwersytet Warszawski", name: "Anna Kowalczyk-Żółć" }),
    mk(6, { category: "estrangeiro", country: "CN", university: "北京大学", name: "李明" }),
  ];
  const bytes = await buildBatchPdf(rows as any, { seq: 1, kind: "partial", generatedAt: new Date().toISOString(), listHash: "a".repeat(64), nServidor: 2, nApoiador: 1, nEstrangeiro: 3, signedNote: "NAO ASSINADO (teste)", origin: "https://sancionaintegral.org" });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 4, `páginas: ${doc.getPageCount()}`);
  assert.equal(doc.getTitle(), "Petição PLV 12/2026 - lote 1");
});

test("PDF: 300 assinaturas geram em poucos segundos e cabem ~8 blocos por página", async () => {
  const { buildBatchPdf } = await import("./pdf");
  const { PDFDocument } = await import("pdf-lib");
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, seq: i + 1, verify_code: "ABCDEFGHJK", confirmed_at: "2026-11-03T17:32:10.000Z", name: `Pessoa Fictícia ${i + 1}`, category: "apoiador", role: null, institution: null, city: "Porto Velho", uf: "RO" }));
  const t0 = Date.now();
  const bytes = await buildBatchPdf(rows as any, { seq: 1, kind: "partial", generatedAt: new Date().toISOString(), listHash: "b".repeat(64), nServidor: 0, nApoiador: 300, signedNote: "teste" });
  const ms = Date.now() - t0;
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  assert.ok(ms < 20_000, `demorou ${ms} ms`);
  assert.ok(pages >= 35 && pages <= 50, `páginas: ${pages}`);
});
