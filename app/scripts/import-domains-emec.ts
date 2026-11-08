// Importa domínios a partir do CSV do e-MEC ("Instituições de Educação Superior"), baixado manualmente do dados.gov.br
// (o portal bloqueia download automatizado). Detecta separador e colunas pelo cabeçalho; confira na simulação.
// Uso: npm run import:emec -- --file=/caminho/ies.csv [--col-site=NOME] [--col-name=NOME] [--col-cat=NOME] [--only-public] [--apply]
import { extractDomains } from "../src/lib/domain-extract";
import { importCandidates, type Candidate } from "../src/lib/domain-import";
import { readLines, splitCsvLine } from "./lib-csv";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function main() {
  const file = arg("file");
  if (!file) { console.error("Informe --file=/caminho/arquivo.csv"); process.exit(1); }
  const apply = process.argv.includes("--apply"), onlyPublic = process.argv.includes("--only-public");
  let enc: BufferEncoding = "utf8";
  const head = [];
  for await (const l of readLines(file, "utf8")) { head.push(l); if (head.length >= 3) break; }
  if (head.some((l) => l.includes("�"))) enc = "latin1";
  const sep = (head[0].match(/;/g)?.length ?? 0) >= (head[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = splitCsvLine(head[0].replace(/^﻿/, ""), sep).map((h) => h.trim());
  const find = (explicit: string | undefined, re: RegExp) => {
    const i = explicit ? header.findIndex((h) => h === explicit) : header.findIndex((h) => re.test(norm(h)));
    return i;
  };
  const iSite = find(arg("col-site"), /(^|[^a-z])(site|url|sitio|pagina|web)/), iName = find(arg("col-name"), /(^|[^a-z])(no_ies|nome|ies$|instituicao)/), iCat = find(arg("col-cat"), /categoria|natureza|administra|publica|privada/);
  console.log(`Arquivo: ${file} | separador "${sep}" | codificação ${enc}`);
  console.log(`Colunas (${header.length}): ${header.join(" | ")}`);
  console.log(`Detectado → site: ${header[iSite] ?? "NÃO ENCONTRADA"} | nome: ${header[iName] ?? "—"} | categoria: ${header[iCat] ?? "—"}`);
  if (iSite < 0) { console.error("Coluna de site não detectada: passe --col-site=NOME_EXATO_DA_COLUNA."); process.exit(1); }

  const cands: Candidate[] = [];
  let rows = 0, skippedPrivate = 0;
  let first = true;
  for await (const line of readLines(file, enc)) {
    if (first) { first = false; continue; }
    const f = splitCsvLine(line, sep);
    rows++;
    if (onlyPublic && iCat >= 0 && !/public/.test(norm(f[iCat] ?? ""))) { skippedPrivate++; continue; }
    for (const d of extractDomains(f[iSite])) cands.push({ domain: d, institution: iName >= 0 ? f[iName] : undefined });
  }
  console.log(`${rows} linhas lidas${onlyPublic ? `, ${skippedPrivate} descartadas por não serem públicas` : ""}.`);
  const rep = await importCandidates(cands, "emec", apply);
  console.log(`Domínios distintos: ${rep.total} | cobertos por sufixo: ${rep.coveredBySuffix} | gratuitos: ${rep.freemail} | já conhecidos: ${rep.alreadyKnown}`);
  console.log(`${apply ? "GRAVADOS como pendentes" : "ENTRARIAM como pendentes (simulação; use --apply)"}: ${rep.inserted}`);
  for (const c of rep.sample) console.log(`  ${c.domain.padEnd(28)} ${c.institution ?? ""}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
