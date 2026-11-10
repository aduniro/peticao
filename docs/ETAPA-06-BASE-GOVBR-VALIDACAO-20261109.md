# Base gov.br: contrato independente de validação

Este incremento prepara o contrato do adaptador configurado; não é protocolo público do ITI e não ativa endpoint, serviço, envio, eleição de base ou migração. Upload privado continua pendente.

Fontes oficiais consultadas em 09/11/2026: [ITI, assinatura avançada](https://www.gov.br/iti/pt-br/assuntos/assinatura-eletronica-avancada), [VALIDAR, finalidade e limites](https://validar.iti.gov.br/sobre.html), [Governo Digital, preservação do arquivo eletrônico original](https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica). A assinatura avançada gov.br e o e-CNPJ ICP-Brasil são fluxos distintos. Não se transforma imagem de assinatura em prova criptográfica. O PDF assinado deve ser preservado sem reimpressão/conversão; a base será anexo separado.

## Vínculo e confiança

`/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/petition-base-validation.ts` exige verificador confiável configurado, gate próprio e lista explícita de perfis. HTTPS remoto, HTTP apenas loopback; credencial nunca vem da requisição do usuário. Falta de configuração não realiza chamada externa. Nenhuma URL de validador oficial foi presumida ou copiada de endpoint não documentado.

O resultado deve comprovar arquivo exato, assinatura avançada gov.br, titular cujo CPF corresponde ao HMAC do perfil do responsável, integridade, cadeia, cobertura integral, modificações e revogação. UTC recente, campos obrigatórios e configuração estável são conferidos. O CPF bruto não entra no metadado persistível. A capacidade de validação é local ao processo e não pode ser reconstruída por JSON ou cópia de símbolo. Ela fica vinculada ao UUID da base, versão do texto da petição, conta responsável e revisão de perfil.

O transporte limita efetivamente a resposta a 64 KiB e todo o ciclo a 30 segundos, incluindo corpo travado, mesmo em mock que ignore AbortSignal. Não há retry automático. Nenhum documento real foi submetido nos testes; os casos positivos são simulação do contrato, não verificação criptográfica gov.br real.

## Gates e testes

Variáveis próprias do backend: GOVBR_BASE_VALIDATION_ENABLED, GOVBR_BASE_VALIDATOR_URL, GOVBR_BASE_VALIDATOR_TOKEN e GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES. Elas não foram configuradas ou ativadas. Primeiro ensaio isolado: sete grupos de testes e TypeScript aprovados; reteste do commit integrado ainda necessário.

```bash
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/final-local.py base-validation
```

## Próxima implementação

Persistir somente a prova interna validada, rechecando sessão/Total/stepup, bytes e perfil após a consulta externa. Seleção da base deverá ser explícita e versionada; pacote de cada lote congelará a versão escolhida, sem substituição automática nos retries. A validação da assinatura não comprova conteúdo da petição: o fluxo deve registrar revisão/autorização da base exata pelo responsável. Backend de persistência/eleição, pacote e interface ainda pendentes. Nenhum deploy ou alteração do banco de produção.
