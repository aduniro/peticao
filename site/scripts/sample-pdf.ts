// Gera um PDF de exemplo com nomes FICTÍCIOS para conferir o layout: npx tsx scripts/sample-pdf.ts saida.pdf [quantidade]
import { writeFileSync } from "node:fs";
import { buildBatchPdf, type ListRow } from "../src/lib/pdf";
import { newVerifyCode } from "../src/lib/verify-code";
const N = Number(process.argv[3] ?? 60);
const when = (i: number) => new Date(Date.UTC(2026, 10, 3, 14, 30 + (i % 50), i % 60)).toISOString();
const rows: ListRow[] = Array.from({ length: N }, (_, i) => {
  const kind = i % 3; // 0 apoiador, 1 servidor da região (cargo+lotação), 2 servidor sem região
  return {
    id: i + 1, seq: i + 1, verify_code: newVerifyCode(), confirmed_at: when(i), name: `Pessoa Fictícia ${i + 1} da Conceição Araújo`,
    category: kind === 0 ? "apoiador" : "servidor", role: kind === 1 ? (i % 2 ? "docente" : "tae") : null,
    institution: kind === 0 ? null : "Universidade Federal de Rondônia", city: kind === 0 ? "Porto Velho" : null, uf: kind === 0 ? "RO" : null,
    campus: kind === 1 ? "Ji-Paraná" : null, campus_ibge: kind === 1 ? 1100122 : null, region_validated: kind === 1,
    cpf_name_check: i % 4 === 0 ? "match" : null,
  };
});
const foreign: [string, string, string][] = [["Anna Kowalczyk-Żółć", "PL", "Uniwersytet Warszawski"], ["Jürgen Müller", "DE", "Universität Hamburg"], ["María Peña", "MX", "Universidad Nacional Autónoma de México"], ["John Smith", "US", "University of Texas"], ["Анна Петрова", "RU", "Московский государственный университет"], ["李明", "CN", "北京大学"], ["Élodie Martin", "FR", "Université de Lyon"]];
foreign.forEach(([name, country, university], k) => rows.push({ id: N + k + 1, seq: N + k + 1, verify_code: newVerifyCode(), confirmed_at: when(N + k), name, category: "estrangeiro", role: null, institution: null, city: null, uf: null, country, university }));
(async () => {
  const t0 = Date.now();
  const bytes = await buildBatchPdf(rows, { seq: 1, kind: "partial", generatedAt: new Date().toISOString(), listHash: "a".repeat(64), nServidor: Math.round(N * 2 / 3), nApoiador: Math.ceil(N / 3), nEstrangeiro: foreign.length, signedNote: "NAO ASSINADO (teste)", nInstitucional: 12, nDiscente: 3, nNomeConferido: Math.ceil(N / 4), origin: "https://sancionaintegral.org" });
  writeFileSync(process.argv[2] ?? "amostra.pdf", bytes);
  console.log(`PDF: ${(bytes.length / 1024).toFixed(0)} KB em ${Date.now() - t0} ms (${rows.length} assinaturas)`);
})();
