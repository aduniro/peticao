// Testa se a chave da CPF Brasil funciona, SEM mostrar dado pessoal: consulta o CPF de teste público da documentação (00000000191)
// e imprime só o resultado (válida, expirada, plano, quota…). Gasta 1 consulta. Uso: npm run cpf:chave-teste
import { cpfBrasilProvider, ProviderUnavailable } from "../src/lib/cpf-check";
import { readSecret } from "../src/lib/secrets";

async function main() {
  const key = readSecret("CPF_BRASIL_API_KEY", "cpf-brasil-api-key");
  if (!key) { console.error("Nenhuma chave encontrada. Rode antes: npm run chave:cpf"); process.exit(1); }
  try {
    const rec = await cpfBrasilProvider(key).lookup("00000000191");
    console.log(rec ? "CHAVE VÁLIDA: a API respondeu normalmente (dados não exibidos)." : "A API respondeu, mas o CPF de teste não foi encontrado (a chave foi aceita).");
  } catch (e) {
    const code = e instanceof ProviderUnavailable ? e.code : String(e);
    const hint: Record<string, string> = {
      INVALID_API_KEY: "a chave está errada ou o usuário está inativo", MISSING_API_KEY: "a chave não foi enviada", TOKEN_EXPIRED: "o token expirou (renove no painel da CPF Brasil; vale 30 dias)",
      PLAN_EXPIRED: "o plano expirou", PLAN_SUSPENDED: "o plano está suspenso", QUOTA_EXCEEDED: "a cota mensal acabou", NETWORK: "este computador não alcançou a API (rede)",
    };
    console.log(`A consulta FALHOU: ${code}${hint[code] ? ` — ${hint[code]}` : ""}`);
    process.exit(2);
  }
}
main();
