# Regressão do próximo snapshot incremental aceito

## Estado

Preparação de ferramenta e guardas, sem bateria longa iniciada. O hash final será fornecido pelo agente integrador depois de reunir os incrementos aceitos. Não usar a worktree principal, arquivos WIP nem a mera ausência de alterações rastreadas como autorização para executá-los. A frente interrompida de texto rico fica excluída; o runner recusa seus arquivos/importações nos testes.

A referência anterior `c9753047e23ba50bed2849cd570ae3a0edaa0c41` passou545/545 testes em117arquivos,23:23:01–23:41:52UTC, com PostgreSQL54351 e execução serial. Aquela prova antecede vários incrementos e não substitui a validação do novo conjunto. O número esperado de casos novo só será conhecido pela execução; o plano congela a quantidade de arquivos e seus hashes antes de iniciar.

## Ferramenta e fases fixas

`tools/admin-qa/cumulative-snapshot.py` aceita somente um novo checkout com nome `candidate-cumulative-*` sob `/mnt/dev/peticao/.cache/admin-integration/`, hash completo40caracteres idêntico ao HEAD e fontes rastreadas limpas. Dependências: cache existente `peticao-admin-deps-preview-v1`, com todas as versões instaladas comparadas ao lock e hashes dos metadados. Pacotes opcionais ausentes ficam explícitos.

Preparar não executa Node, banco ou browser. O plano privado fixa SHA-256 de todos os arquivos rastreados, lista ordenada dos testes `src/lib/*.test.ts` e `src/i18n/*.test.ts`, hash do runner, dependências e portas exclusivas54364/3044. Um novo incremento invalida o plano e exige novo snapshot/plano; não se altera a lista durante a execução.

Ordem proposta, serial e com slot de build/browser coordenado:

1. `prepare`: congelar plano, dependências e fontes.
2. `tests --execute`: toda a lista fixa, `--test-concurrency=1`, heap1536MiB, concorrência interna dos próprios testes preservada. PostgreSQL novo e diretório temporário novo por fase.
3. `schema --execute`: ensaio do bootstrap/upgrade/rollback sobre fixtures de esquema sem registros reais. Validar a quantidade de tabelas realmente presente no hash recebido, sem reduzir expectativas para passar.
4. `build --execute`: build próprio do hash aceito, ambiente fictício vazio; conservar fontes pre/pós.
5. `types --execute`: tipos globais desse mesmo hash, após build.
6. Contratos HTTP/visuais abaixo, serialmente, com o artefato fechado e fontes/dependências iguais. Não incluídos como execução implícita no runner de unidades.

Cada fase exige `--execute` expresso e o plano preexistente idêntico; nunca inicia por importação da ferramenta. A fase grava comando/pid/estado/horários/log/checksum e manifestos de fonte antes/depois. Logs ficam em diretório privado diferente por execução, com checkpoints históricos e ponteiro da última fase. Erro/interrupção não vira aprovação nem provoca repetição automática. Uma rodada interrompida não é reaproveitada como aprovada; uma nova execução explícita usa banco novo e mantém a evidência anterior.

## Matriz de contratos compilados proposta

Não alterar portas rígidas dos contratos implicitamente. Reservar cada dupla e comprovar limpeza depois; só uma instância Chromium por vez.

| Grupo | Contratos | Dupla existente suportada | Isolamento |
| --- | --- | --- | --- |
| Consolidação principal | referrals, referrals-browser, content-retention, whatsapp-senders, contact-history, contact-drafts, contact-list, mail-recovery, mail-preview, actions-ui, admin-password-ui, batch-control, batch-reservation, batch-reconciliation |3033/54349|schema novo por contrato, nunca banco anterior|
| Contato AV14 |contact-triage-ui|3043/54363|banco novo, falhas controladas de rede/payload, worker determinístico sem cron/envio|
| Portal Presidente |president-portal|3039/54360|banco novo, PREVIEW_MODE0 para bloqueio ICP, PDFs fictícios e renderização somente leitura|
| Novos incrementos integrados |adaptador de desafio, domínios/campus e demais aceitos pelo hash|a fixar depois da integração|executores próprios já aprovados ou extensão explícita da matriz, sem UI cujo texto esteja pendente|

A matriz preserva as guardas de origem, autorização, versão e envio dos contratos. Contratos IA/rich interrompidos e WIP não participam. Rotas de formulário público, conteúdo/privacidade, validação Nome/CPF, resolvedor e configuração de provedores estão no manifesto integral; diferenças estáticas do hash consolidado devem ser revisadas como escopo, sem consultas reais ou alterações para “compatibilizar” o teste.

## Recursos e conclusão

A referência545 levou18min51s; a lista atual é maior. Estimativa inicial:20–30min para unidades, mais build/schema/contratos, condicionada à carga e resultados. Não é prazo de conclusão do painel integral. Os próprios testes de guardas da ferramenta são leves e não iniciam serviços.

Esta regressão certifica somente o snapshot incremental identificado. Não encerra o admin-v2, não libera funcionalidades ainda incompletas e não autoriza merge/deploy ou integração com a VPS.
