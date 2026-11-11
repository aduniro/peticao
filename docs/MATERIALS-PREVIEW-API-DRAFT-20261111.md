# Prévia autenticada de versão histórica exata — draft

Worktree local: `/mnt/apps/peticao-final/_ops/drafts/materials-preview-api-20261111`. Branch: `feat/materials-preview-api-20261111`. Base: `49b158d73ef9dc5c75b7c378dfdafca44dcf62bc`.

## Contrato e comportamento

A nova rota GET `/api/admin/materiais/[id]/previa?versionId=UUID&revision=N` é implementada em `/mnt/apps/peticao-final/_ops/drafts/materials-preview-api-20261111/site/src/app/api/admin/materiais/[id]/previa/route.ts`. Ela usa `exigirNivel` para leitura, `quemAge` e o store `materialHistory` existentes. A flag `MATERIALS_LIBRARY_ENABLED` continua desligada por padrão; a rota não aplica DDL nem inicializa um serviço ou banco por conta própria. O store revalida usuário e sessão na leitura real.

O helper `/mnt/apps/peticao-final/_ops/drafts/materials-preview-api-20261111/site/src/lib/materials-preview.ts` recebe a função de leitura por injeção e não importa o store em runtime. Aceita apenas uma ocorrência de `versionId` e de `revision`, sem extras, números ambíguos ou IDs inválidos. Uma leitura bounded usa cursor `revision + 1`; na maior revisão suportada, o cursor é null. A seleção exige simultaneamente ID da versão e revisão exatos. Falta, conflito ou corrupção nunca fazem a prévia trocar silenciosamente pelo head. O histórico permanece limitado a cinquenta entradas, conforme o store.

A versão selecionada, seu material e digest são validados antes da renderização. O HTML provém exclusivamente do renderizador estruturado já existente, preservado byte a byte. Não há entrada de HTML, JS, CSS ou URL arbitrária. A resposta usa `private, no-store`, `nosniff`, `SAMEORIGIN`, política de referrer sem envio e CSP com scripts/formulários/conexões proibidos, imagens self, CSS pelo hash exato e `frame-ancestors 'self'`.

Headers `x-material-version-id`, `x-material-version-revision` e `x-material-content-sha256` identificam a versão histórica servida. `x-material-observed-head-version-id` e `x-material-observed-head-revision` identificam apenas o head observado na transação de leitura: não afirmam que continua sendo o atual quando a resposta chegar ou depois. `x-material-preview-scope` é `exact-historical-version`. Arquivamento não apaga o acesso autenticado a uma versão histórica válida.

Os erros continuam códigos de máquina via resposta existente: parâmetros 400, proibição 403, inexistência 404, flag desligada 409 e indisponibilidade 503. A autenticação/throttle mantém os próprios resultados anteriores. Falhas internas não expõem mensagens de conexão ou detalhes privados. Nenhum texto de UI foi criado.

## Validação realizada e limites

Onze testes puros passaram, cobrindo versão histórica diferente do head, cursor máximo, query fechada, falta de versão sem fallback, erros de store, integridade, archivamento e headers/CSP. Typecheck estrito do helper/testes terminou sem diagnósticos. Prova: `/mnt/apps/peticao-final/_ops/drafts/materials-preview-api-20261111/.cache/materials-preview-validation/result.json`.

O typecheck transitivo da rota/helper também passou, com 504 inputs, 17 pacotes existentes compatíveis com o lockfile, zero diagnósticos, mismatch ou drift. O compilador usou apenas leitura do checkout e de dependências existentes, noEmit e incremental false. Não houve instalação ou import de aplicação em runtime. Prova: `/mnt/apps/peticao-final/_ops/drafts/materials-preview-api-20261111/.cache/materials-preview-transitive-typecheck/result.json`.

O renderizador, avaliador, coletor, contrato e store anteriores foram preservados byte a byte. Esta fatia ainda não foi integrada nem executada por HTTP ou com autenticação/PG reais. A leitura autenticada do store e seu transporte devem ser validados em fixture isolada em etapa posterior. Não foram gerados PDF/PNG, nem executados navegador, aplicação, HTTP ou PG. Nenhum deploy, modificação de homepage ou fluxo Contatos/IA/assinaturas/R16 foi realizado. Prévia HTML não é autorização ou qualificação de exportação e não conclui o módulo Materiais inteiro.
