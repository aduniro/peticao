// Diagnóstico da consulta de CPF SEM mostrar dado pessoal na tela: só diz o que veio e se o que você digitou confere.
// Consulta a API REAL (gasta 1 consulta) usando a chave de ../secrets. Uso: npm run cpf:diagnostico
import { askHidden, closePrompt } from "./lib-prompt.mjs";
import { cpfBrasilProvider, motherNameMatches, birthMatches, ProviderUnavailable } from "../src/lib/cpf-check";
import { readSecret } from "../src/lib/secrets";
import { isValidCpf } from "../src/lib/cpf";
import { normalizeRegistryBirth } from "../src/lib/birth";

async function main() {
  const key = readSecret("CPF_BRASIL_API_KEY", "cpf-brasil-api-key");
  if (!key) { console.error("Nenhuma chave encontrada. Rode antes: npm run chave:cpf"); process.exit(1); }
  const cpf = (await askHidden("CPF a consultar (não aparece na tela): ")).replace(/\D/g, "");
  if (!isValidCpf(cpf)) { closePrompt(); console.error("CPF inválido (conta matemática)."); process.exit(1); }
  const mae = (await askHidden("Nome da mãe como você digitaria no site (Enter para pular): ")).trim();
  const nasc = (await askHidden("Data de nascimento como você digitaria, dd/mm/aaaa (Enter para pular): ")).trim();
  closePrompt();
  try {
    const rec = await cpfBrasilProvider(key).lookup(cpf);
    if (!rec) return console.log("\nResultado: CPF NÃO ENCONTRADO na base da CPF Brasil (o site responderia 'dados não conferem').");
    const toks = (rec.mae ?? "").split(/\s+/).filter(Boolean);
    console.log("\nA consulta funcionou. O que veio (valores não exibidos):");
    console.log(`  nome:            ${rec.nome ? "sim" : "NÃO"}`);
    console.log(`  data nascimento: ${rec.nasc ? "sim" : "NÃO"}${rec.nasc ? ` · formato reconhecido: ${normalizeRegistryBirth(rec.nasc) ? "sim" : "NÃO"}` : ""}`);
    console.log(`  nome da mãe:     ${rec.mae ? `sim · ${toks.length} palavra(s)${toks.some((t) => t.length === 1) ? " · contém INICIAIS (cadastro abreviado)" : ""}` : "NÃO (por esse método o site pede a data de nascimento)"}`);
    if (nasc) console.log(`  sua data confere: ${birthMatches(rec.nasc, nasc) ? "SIM" : "NÃO"}`);
    if (mae) console.log(`  seu nome da mãe confere: ${motherNameMatches(rec.mae, mae) ? "SIM" : "NÃO"}${rec.mae && toks.length !== mae.split(/\s+/).filter(Boolean).length ? ` (o cadastro tem ${toks.length} palavra(s); você digitou ${mae.split(/\s+/).filter(Boolean).length})` : ""}`);
  } catch (e) {
    console.log(`\nA consulta FALHOU: ${e instanceof ProviderUnavailable ? e.code : String(e)}`);
    console.log("  Códigos comuns: INVALID_API_KEY/MISSING_API_KEY (chave errada), TOKEN_EXPIRED (renovar no painel), PLAN_EXPIRED, QUOTA_EXCEEDED, NETWORK.");
  }
  process.exit(0);
}
main();
