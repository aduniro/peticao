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

## Evidência persistida, ainda sem eleição ou envio

O incremento seguinte acrescenta `petition_base_validations` ao mesmo bootstrap aditivo (31 tabelas adicionadas ao legado). FK composta vincula UUID e SHA256 do arquivo; índice adicional não altera os artefatos existentes. Triggers impedem UPDATE/DELETE/TRUNCATE e constraints recusam evidência incompleta, assinatura classificada como ICP no fluxo gov.br e CPF bruto no campo de titular.

`/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/petition-base-validation-store.ts` separa captura em transação curta da consulta externa e da persistência. Ao persistir, exige novamente Total, sessão/stepup atuais, perfil ativo, mesma revisão, texto atual, bytes/hash e capacidade interna válida na configuração vigente. Prova repetida produz replay com a autoria/data originais; auditoria e evidência são atômicas. O resultado continua `usableInPackage:false`: validar não elege a base, aprova ou envia lote. Nenhuma rota de HTTP aceita JSON como prova interna.

Rascunho: sete testes PostgreSQL e tipos aprovados (captura/auth, replay concorrente, mudança de perfil/texto/verificador/arquivo, rollback de auditoria, imutabilidade/replay DDL e constraints). Contrato anterior 05224f1 passou sete grupos pelo runner e tipos com fontes/commit estáveis:

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/base-validation-1794275539620316358/result.json`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794275539615389046/result.json`

Após este commit, repetir esquema aditivo, tipos e testes do store integrado. Não houve modificação do banco da VPS.

```bash
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/final-local.py base-store
```

## Resultado integrado da persistência

Commit 9553c86: 14/14 testes integrados (upload anterior e evidência de validação), tipos e ensaio de esquema aditivo aprovados; código e commit estáveis. A migração soma 31 tabelas ao legado sem modificar dados antigos e preserva compatibilidade com o bootstrap anterior. Evidências:

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/base-store-1794276273740869656/result.json`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794276273819719075/result.json`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/schema-1794276298499244062/result.json`

Esses resultados são do núcleo de evidência: eleição da base, requisição de validação via interface e congelamento do pacote ainda são as próximas etapas. Nenhum banco de produção foi alterado.

## Eleição explícita e versionada

O próximo incremento acrescenta `petition_base_selections` (32 tabelas aditivas no total), sem trocar arquivos. A escolha exige requestId, revisão esperada, recibo de validação, SHA256 efetivamente revisado e versão do texto. Total/sessão/stepup, perfil, arquivo, configuração do verificador e evidência recente são rechecados na transação. Pedidos concorrentes têm um único vencedor; a repetição de decisão antiga retorna a revisão histórica sem torná-la atual. Auditoria e decisão são atômicas; FK composta e CHECK IS TRUE recusam recibo de outro arquivo e revisão anterior NULL.

A evidência passa a registrar fingerprint de configuração (nullable apenas para preservar recibos anteriores). Recibos sem esse contexto exigem nova validação, sem inventar dados. O digest do relatório usa representação canônica, independente da ordem das chaves em JSONB, e vincula a política do verificador. CPF bruto continua fora do relatório persistido.

Rascunho: nove testes PostgreSQL e tipos aprovados. Cobrem concorrência/replay, CAS, autorização/hash/texto/perfil, mudança do verificador, recibo legado, rollback, imutabilidade, leitura com validação desativada, alteração de CPF mesmo sem incremento indevido da revisão, desligamento durante espera e constraints. O primeiro harness falhou em imports relativos; a evidência foi preservada antes da correção. Depois deste commit, executar as rodadas integradas e o esquema32.

A leitura informa a revisão atual e se o perfil/contexto ainda correspondem. `usableInPackage` permanece falso até implementar o pacote: eleger não equivale a enviar. Nenhuma interface nova, texto visível ou banco da VPS foi alterado por este incremento.

## Primeira integração da eleição

Em 0079f2e (código funcional 1d5fbd8), tipos e esquema32 passaram; store/eleição ficou em 22/23. A falha era a expectativa de mensagem do teste: com a FK nova, TRUNCATE simples da tabela de validação é recusado pela dependência antes do trigger. O teste passa a aceitar essa recusa e exige explicitamente que TRUNCATE CASCADE seja barrado pelo trigger, preservando as linhas. Nenhuma proteção SQL foi retirada. Evidência da rodada original: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/base-store-1794277790521938978/result.json`. Repetir os 23 testes após a correção; não declarar esse resultado original aprovado.


## Continuidade — contratos HTTP e recuperação exata

`057864d`: inventário limitado de metadados, POST de validação externa com rechecagem da conta após o I/O, seleção explícita/CAS e revisão/preparo do pacote.4/4 testes dos handlers reais passaram em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/base-http-1794281995142582973/result.json`; tipos e build passaram no mesmo commit (respectivamente `types-1794281995085119914/result.json` e `build-1794282131092941528/result.json` no mesmo diretório integrado). Validador HTTP local simulado, não homologação gov.br real; nenhum envio/aprovação.

`9919069`: GET por `requestId` em upload, seleção e pacote resolve somente a intenção do ator autenticado e do lote esperado. Histórico permanece consultável com gates de novas operações desativados. Outra conta Total recebe404, intenção antiga não é apresentada como corrente e nenhuma leitura repete mutação.5/5 testes passaram em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/base-http-1794282669143591460/result.json`; tipos passaram em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794282669152885278/result.json`. Build deste incremento posterior ainda não repetido; build057864d não certifica9919069.

Textos dos controles gov.br aprovados expressamente pelo dono: “Petição-base gov.br”, “Carregar PDF assinado”, “Conferir assinatura”, “Selecionar esta versão”, “Preparar pacote para revisão”, “Pacote preparado” e “Os PDFs do lote e da petição-base serão mantidos como arquivos separados.” Proposta preservada em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/govbr-ui-draft/TEXTOS-PARA-REVISAO.md`. Integração visual ainda não concluída; não declarar botão ativo só porque o texto foi aprovado.


## Atualização de 10/11/2026

A interface compilada e os formulários reais foram ensaiados no commit c351e1f; a sequência posterior corrigiu revalidação negativa e respostas fora de ordem. Registro consolidado, distinção entre evidências históricas e atuais, testes e próximos pontos: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/docs/ETAPA-06-REVALIDACAO-GOVBR-20261110.md`. As descrições de etapas anteriores acima são históricas. Nenhuma homologação real ou publicação foi realizada.
