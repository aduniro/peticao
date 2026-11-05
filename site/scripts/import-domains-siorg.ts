// Coleta domínios de órgãos federais pela API pública do SIORG (e-mails e sites de contato de cada unidade).
// Uso: npm run import:siorg            (simulação, só mostra o que entraria)
//      npm run import:siorg -- --apply (grava como PENDENTE; a aprovação é humana em /admin/dominios)
import { extractDomains } from "../src/lib/domain-extract";
import { importCandidates, type Candidate } from "../src/lib/domain-import";

const BASE = "https://estruturaorganizacional.dados.gov.br";
const get = async (url: string, tries = 3): Promise<any> => {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      if (r.ok) return await r.json();
    } catch { /* tenta de novo */ }
    await new Promise((res) => setTimeout(res, 800 * i));
  }
  return null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const units: { id: string; nome: string }[] = [];
  for (const poder of [1, 2, 3]) {
    const j = await get(`${BASE}/doc/orgao-entidade/resumida?codigoPoder=${poder}&codigoEsfera=1`);
    for (const u of j?.unidades ?? []) units.push({ id: String(u.codigoUnidade).split("/").pop()!, nome: u.nome });
  }
  console.log(`${units.length} órgãos/entidades federais listados no SIORG.`);

  const cands: Candidate[] = [];
  let withContact = 0, i = 0;
  const queue = [...units];
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      const j = await get(`${BASE}/doc/unidade-organizacional/${u.id}/completa`);
      const text = JSON.stringify([j?.unidade?.contato ?? [], j?.unidade?.site ?? []]);
      const ds = extractDomains(text);
      if (ds.length) withContact++;
      for (const d of ds) cands.push({ domain: d, institution: u.nome });
      if (++i % 50 === 0) console.log(`  ${i}/${units.length}…`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker)); // 4 em paralelo: educado com o servidor público

  console.log(`${withContact} unidades com contato (e-mail/site) informado.`);
  const rep = await importCandidates(cands, "siorg", apply);
  console.log(`\nDomínios distintos: ${rep.total} | cobertos por sufixo (.gov.br etc.): ${rep.coveredBySuffix} | provedores gratuitos: ${rep.freemail} | já conhecidos: ${rep.alreadyKnown}`);
  console.log(`${apply ? "GRAVADOS como pendentes" : "ENTRARIAM como pendentes (simulação; use --apply)"}: ${rep.inserted}`);
  for (const c of rep.sample) console.log(`  ${c.domain.padEnd(28)} ${c.institution}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
