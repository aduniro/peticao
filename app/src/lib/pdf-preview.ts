import { config } from "./config";
import { query } from "./db";
import { buildBatchPdf, type ListRow } from "./pdf";
import { LIST_SQL, badgeCounts } from "./batches";
import { signerNote } from "./signer";
import { sha256 } from "./security";

/** Assinaturas fictícias que cobrem todos os casos do bloco (servidor com/sem região, CPF conferido ou não, apoiador, exterior). */
export function sampleRows(): ListRow[] {
  const d = (n: number) => new Date(Date.UTC(2026, 10, 3, 13, 5 + n * 7, 12 + n)).toISOString();
  const base: Omit<ListRow, "seq" | "verify_code" | "confirmed_at" | "id">[] = [
    { name: "Maria Aparecida dos Santos Oliveira", category: "servidor", role: "docente", institution: "UNIR", city: "Porto Velho", uf: "RO", campus_ibge: 1100205, region_validated: true, cpf_name_check: "match", email_domain_kind: "ifes" },
    { name: "João Batista Ferreira Lima", category: "servidor", role: "tae", institution: "IFRO", city: "Guajará-Mirim", uf: "RO", campus_ibge: 1100106, region_validated: true, cpf_name_check: null, email_domain_kind: "ifes" },
    { name: "Ana Clara Rodrigues de Souza", category: "servidor", role: "docente", institution: "UFAC", city: "Cruzeiro do Sul", uf: "AC", campus_ibge: 1200203, region_validated: true, cpf_name_check: "match", email_domain_kind: "ifes" },
    { name: "Francisco das Chagas Pereira Nascimento", category: "servidor", role: "tae", institution: "UFAM", city: "Manaus", uf: "AM", campus_ibge: 1302603, region_validated: true, cpf_name_check: "match", email_domain_kind: "ifes" },
    { name: "Luiza Helena Moraes", category: "servidor", role: null, institution: "UnB", city: "Brasília", uf: "DF", region_validated: false, cpf_name_check: "match", email_domain_kind: "ifes" },
    { name: "Pedro Henrique Albuquerque Cavalcanti de Vasconcelos Filho", category: "apoiador", role: null, institution: null, city: "Ji-Paraná", uf: "RO", cpf_name_check: "match", email_domain_kind: null },
    { name: "Raimunda Nonata Silva", category: "apoiador", role: null, institution: null, city: "Belém", uf: "PA", cpf_name_check: null, email_domain_kind: "publico" },
    { name: "Carlos Eduardo Tavares", category: "apoiador", role: null, institution: null, city: "Porto Alegre", uf: "RS", cpf_name_check: "match", email_domain_kind: "discente" },
    { name: "Sophie Lefèvre", category: "estrangeiro", role: null, institution: null, city: null, uf: null, country: "FR", university: "Université Paris Cité" },
    { name: "Julián Andrés Gómez", category: "estrangeiro", role: null, institution: null, city: null, uf: null, country: "CO", university: "Universidad Nacional de Colombia" },
    { name: "Hannah Müller", category: "estrangeiro", role: null, institution: null, city: null, uf: null, country: "DE", university: "Freie Universität Berlin" },
  ];
  // mais nomes fictícios para a prévia ter páginas cheias
  const first = ["Antônia", "José", "Francisca", "Antônio", "Adriana", "Paulo", "Juliana", "Marcos", "Patrícia", "Raimundo", "Fernanda", "Sebastião", "Cláudia", "Rafael", "Josefa", "Lucas", "Débora", "Wellington"];
  const last = ["Costa", "Almeida", "Ribeiro", "Carvalho", "Gomes", "Martins", "Araújo", "Barbosa", "Rocha", "Dias", "Teixeira", "Correia", "Monteiro", "Mendes", "Freitas", "Cardoso", "Nunes", "Batista"];
  const ifes: [string, string, string, number][] = [["UFRR", "Boa Vista", "RR", 1400100], ["UFPA", "Altamira", "PA", 1500602], ["IFAP", "Oiapoque", "AP", 1600501], ["UFMS", "Corumbá", "MS", 5003207], ["UNILA", "Foz do Iguaçu", "PR", 4108304], ["UFT", "Araguaína", "TO", 1702109]];
  const cities: [string, string][] = [["Ariquemes", "RO"], ["Vilhena", "RO"], ["Rio Branco", "AC"], ["Santarém", "PA"], ["São Paulo", "SP"], ["Recife", "PE"]];
  for (let i = 0; i < 20; i++) {
    const name = `${first[i % first.length]} ${last[(i * 5) % last.length]} ${last[(i * 7 + 3) % last.length]}`;
    if (i % 2 === 0) { const [inst, city, uf, ibge] = ifes[i % ifes.length]; base.push({ name, category: "servidor", role: i % 4 === 0 ? "docente" : "tae", institution: inst, city, uf, campus_ibge: ibge, region_validated: true, cpf_name_check: i % 3 ? "match" : null, email_domain_kind: "ifes" }); }
    else { const [city, uf] = cities[i % cities.length]; base.splice(base.length - 3, 0, { name, category: "apoiador", role: null, institution: null, city, uf, cpf_name_check: i % 3 ? "match" : null, email_domain_kind: null }); }
  }
  // servidores/apoiadores antes dos estrangeiros
  base.sort((a, b) => Number(a.category === "estrangeiro") - Number(b.category === "estrangeiro"));
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const codes = base.map((_, i) => Array.from({ length: 10 }, (_, k) => A[(i * 7 + k * 13 + i * k) % 32]).join(""));
  return base.map((r, i) => ({ ...r, id: i + 1, seq: i + 1, verify_code: codes[i], confirmed_at: d(i) }));
}

/** PDF de prévia: "modelo" (dados fictícios) ou "real" (assinaturas confirmadas agora, como entrariam no próximo lote). Não cria lote nem altera o banco. */
export async function previewPdf(tipo: "modelo" | "real"): Promise<{ bytes: Uint8Array; n: number }> {
  const rows = tipo === "modelo" ? sampleRows() : (await query<ListRow & { category: string }>(`${LIST_SQL} WHERE status='confirmed' ORDER BY confirmed_at, id`)).rows;
  const seq = tipo === "modelo" ? 1 : (await query<{ n: number }>("SELECT COALESCE(MAX(seq),0)::int+1 n FROM batches")).rows[0].n;
  const nS = rows.filter((r) => r.category === "servidor").length;
  const nE = rows.filter((r) => r.category === "estrangeiro").length;
  const now = new Date().toISOString();
  const bytes = await buildBatchPdf(rows, {
    seq, kind: "final", generatedAt: now, listHash: sha256(JSON.stringify(rows)), nServidor: nS, nApoiador: rows.length - nS - nE, nEstrangeiro: nE,
    signedNote: signerNote(), origin: config.appUrl(), ...badgeCounts(rows),
    preview: tipo === "modelo"
      ? "PRÉVIA DO MODELO: nomes, códigos e dados FICTÍCIOS. Os QR Codes não abrem assinaturas reais."
      : `PRÉVIA do documento real com as ${rows.length} assinaturas confirmadas até agora. Ainda NÃO foi enviado; o lote oficial é gerado na aba Lotes.`,
  });
  return { bytes, n: rows.length };
}
