import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

async function main() {
  const [source, directory, baselineFile, mode] = process.argv.slice(2);
  if (!source || !directory || !baselineFile) throw new Error("Expected source, private output, and baseline");
  process.chdir(source);
  const { buildBatchPdf } = await import(pathToFileURL(join(source, "src/lib/pdf.ts")).href);
  const current = JSON.parse(readFileSync(join(directory, "snapshot-atual.json"), "utf8"));
  const report = JSON.parse(readFileSync(join(directory, "relatorio.json"), "utf8"));
  const map = new Map<number, any>(report.map((r: any) => [r.id, r]));
  const baseline = new Map<number, any>(JSON.parse(readFileSync(baselineFile, "utf8")).signatures.map((r: any) => [r.id, r]));
  const base = JSON.parse(readFileSync(join(directory, "elegiveis.json"), "utf8"));
  const expected = new Map<number, any>(base.map((r: any) => [r.expected.id, r.expected]));
  const strict: any[] = [], previous: any[] = [];
  for (const row of current.signatures) {
    const original = map.get(row.id);
    if (!original || original.status !== "confirmed" || row.status !== "confirmed" || row.cpf_name_check !== "match" || row.name !== original.name) continue;
    if (baseline.get(row.id)?.cpf_hash !== row.cpf_hash || baseline.get(row.id)?.category !== row.category) throw new Error("Registration changed since reconciliation");
    if (["correspondencia_completa", "correspondencia_reassociada", "particulas_aprovadas"].includes(original.grupo)) {
      if (expected.get(row.id)?.cpf_hash !== row.cpf_hash) throw new Error("CPF hash changed since reconciliation");
      strict.push(row);
    } else if (original.grupo === "match_app_sem_retorno_auditavel") {
      previous.push(row);
    }
  }
  const output = join(directory, "pdfs-revisao");
  mkdirSync(output, { mode: 0o700 });
  const manifest: any[] = [];
  const seq = Math.max(...current.batches.map((b: any) => b.seq)) + 1;
  for (const [label, rows] of [["correspondencia-completa", strict], ["com-validacoes-anteriores", [...strict, ...previous]]] as const) {
    if (mode === "combined-only" && label !== "com-validacoes-anteriores") continue;
    rows.sort((a, b) => Date.parse(a.confirmed_at) - Date.parse(b.confirmed_at) || a.id - b.id);
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("Duplicate signature in release");
    const listHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const bytes = await buildBatchPdf(rows, {
      seq, kind: "partial", generatedAt: new Date().toISOString(), listHash,
      nServidor: rows.filter(r => r.category === "servidor").length,
      nApoiador: rows.filter(r => r.category === "apoiador").length,
      nEstrangeiro: rows.filter(r => r.category === "estrangeiro").length,
      signedNote: "NAO ASSINADO (teste)", origin: "https://sancionaintegral.org",
      nInstitucional: rows.filter(r => r.email_domain_kind && r.email_domain_kind !== "discente").length,
      nDiscente: rows.filter(r => r.email_domain_kind === "discente").length,
      nNomeConferido: rows.length,
      preview: `REVISAO CPF: ${rows.length} assinaturas selecionadas. Documento para conferencia; NAO ENVIAR.`,
    });
    const filename = `peticao-revisao-cpf-${label}.pdf`;
    writeFileSync(join(output, filename), bytes, { flag: "wx", mode: 0o600 });
    writeFileSync(join(output, `selecao-${label}.json`), JSON.stringify(rows, null, 2), { flag: "wx", mode: 0o600 });
    manifest.push({ file: filename, rows: rows.length, strict: strict.length,
      previousAppChecks: label === "correspondencia-completa" ? 0 : previous.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), listHash });
    console.log(JSON.stringify(manifest[manifest.length - 1]));
  }
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
}
main().catch(() => { console.error("PDF audit generation failed; private details omitted"); process.exitCode = 1; });
