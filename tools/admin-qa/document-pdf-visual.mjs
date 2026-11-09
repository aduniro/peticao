// Pure committed PDF renderer: fictitious rows only, no database or application bootstrap.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildBatchPdf } from "../../site/src/lib/pdf.ts";
assert.equal(process.cwd(), "/mnt/dev/peticao/.cache/admin-integration/candidate-stage02-domains/site");
const output = resolve("../.cache/qa-document-pdf-20261109");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const files = ["src/lib/pdf.ts", "src/lib/card.ts", "src/lib/signature-text.ts", "src/lib/verify-code.ts", "src/content/peticao.ts", "public/data/municipios.json", "public/data/regiao.json", "public/data/ifes.json", "assets/adunir.png", "assets/andes.png", "assets/fonts/NotoSans-Regular.ttf", "assets/fonts/NotoSans-SemiBold.ttf", "assets/fonts/NotoSans-ExtraBold.ttf"];
const fingerprints = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, hash(await readFile(name))])));
const before = await fingerprints();
const base = { confirmed_at: "2026-11-08T12:34:56.123456Z", region_validated: false, email_domain_kind: null, cpf_name_check: null };
const rows = [
  { ...base, id: 1, seq: 1, name: "Pessoa Fictícia Docente QA", category: "servidor", role: "docente", institution: "UNIR", city: null, uf: null, campus: "Porto Velho", campus_ibge: 1100205, verify_code: "0123456789" },
  { ...base, id: 2, seq: 2, name: "Pessoa Fictícia Apoiadora QA", category: "apoiador", role: null, institution: null, city: "Manaus", uf: "AM", verify_code: "ABCDEFGHJK" },
  { ...base, id: 3, seq: 3, name: "Pessoa Fictícia Exterior QA", category: "estrangeiro", role: null, institution: null, city: null, uf: null, country: "PT", university: "Universidade Fictícia QA", verify_code: "MNPQRSTVWX" },
];
const listHash = hash(JSON.stringify(rows));
const bytes = await buildBatchPdf(rows, { seq: 1, kind: "final", generatedAt: "2026-11-08T12:34:56.123456Z", listHash, nServidor: 1, nApoiador: 1, nEstrangeiro: 1, nInstitucional: 0, nDiscente: 0, nNomeConferido: 0, signedNote: "NAO ASSINADO (teste)", origin: "http://127.0.0.1", preview: "QA LOCAL - DADOS FICTICIOS - NAO ENVIAR" });
assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-");
assert.deepEqual(await fingerprints(), before, "renderer and assets must not change during inspection");
await mkdir(output, { recursive: true });
await writeFile(`${output}/documento-final-ficticio.pdf`, bytes);
const report = { ok: true, rendererUnchanged: true, fictitiousRows: 3, originalApplicationRenderer: true, noDatabaseBootstrap: true, noMailOrProvider: true, signed: false, listHash, pdfSha256: hash(bytes), sources: before };
await writeFile(`${output}/render.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, output: `${output}/documento-final-ficticio.pdf`, rows: 3, signed: false, pdfSha256: report.pdfSha256 }));
