// Importa domínios de órgãos públicos a partir dos CSV abertos de CNPJ da Receita (baixados e descompactados manualmente:
// o servidor da Receita exige verificação anti-robô). Usa Empresas (natureza jurídica do grupo 1 = Administração Pública)
// e Estabelecimentos (e-mail cadastral). Posições padrão do layout oficial; confira na simulação e ajuste se mudarem.
// Uso: npm run import:cnpj -- --empresas=A.csv,B.csv --estab=X.csv,Y.csv [--apply]
//      Opcionais: --col-nat=2 --col-razao=1 --col-email=27   (índices começando em 0)
import { extractDomains } from "../src/lib/domain-extract";
import { importCandidates, type Candidate } from "../src/lib/domain-import";
import { readLines, splitCsvLine } from "./lib-csv";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const list = (n: string) => (arg(n) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  const empresas = list("empresas"), estab = list("estab");
  if (!empresas.length || !estab.length) { console.error("Informe --empresas=... e --estab=... (um ou mais CSV, separados por vírgula)."); process.exit(1); }
  const apply = process.argv.includes("--apply");
  const iNat = Number(arg("col-nat") ?? 2), iRazao = Number(arg("col-razao") ?? 1), iEmail = Number(arg("col-email") ?? 27);

  const publicos = new Map<string, string>(); // cnpj básico -> razão social
  for (const f of empresas) {
    for await (const line of readLines(f, "latin1")) {
      const c = splitCsvLine(line, ";");
      if ((c[iNat] ?? "").startsWith("1")) publicos.set(c[0], c[iRazao] ?? "");
    }
    console.log(`  ${f}: ${publicos.size} entidades da administração pública até aqui`);
  }
  const counts = new Map<string, { n: number; name: string }>();
  let shown = 0;
  for (const f of estab) {
    for await (const line of readLines(f, "latin1")) {
      const c = splitCsvLine(line, ";");
      const razao = publicos.get(c[0]);
      if (razao === undefined) continue;
      if (shown < 3) { console.log(`  amostra: básico=${c[0]} e-mail="${c[iEmail]}" razão="${razao}"`); shown++; }
      for (const d of extractDomains(c[iEmail])) {
        const cur = counts.get(d);
        if (cur) cur.n++; else counts.set(d, { n: 1, name: razao });
      }
    }
  }
  const cands: Candidate[] = [...counts].sort((a, b) => b[1].n - a[1].n).map(([domain, v]) => ({ domain, institution: v.name, count: v.n }));
  const rep = await importCandidates(cands, "cnpj", apply);
  console.log(`Domínios distintos: ${rep.total} | cobertos por sufixo: ${rep.coveredBySuffix} | gratuitos: ${rep.freemail} | já conhecidos: ${rep.alreadyKnown}`);
  console.log(`${apply ? "GRAVADOS como pendentes" : "ENTRARIAM como pendentes (simulação; use --apply)"}: ${rep.inserted}`);
  for (const c of rep.sample) console.log(`  ${c.domain.padEnd(28)} x${String(c.count).padEnd(4)} ${c.institution ?? ""}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
