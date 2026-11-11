# R7 — core histórico: seis callbacks PG atuais e oito views herdados

Rascunho preparado; NÃO executado. Sete mocks de perfil aprovados. Nenhum Docker, banco, app ou callback de histórico foi executado nesta preparação. A próxima rodada proposta contém EXATAMENTE /src/lib/batch-document-history.test.ts (6casos); não repete document-history-view.test.ts.

Raiz: /mnt/dev/.peticao-r0007-local-history-core-pg17-qa-20261111
Runner: /mnt/dev/.peticao-r0007-local-history-core-pg17-qa-20261111/local_runner.py
Mocks: /mnt/dev/.peticao-r0007-local-history-core-pg17-qa-20261111/mock-proof/result.json
Herança: /mnt/dev/.peticao-r0007-local-history-core-pg17-qa-20261111/INHERITED-VIEW-PROOF.json

## Fonte e herança

R3stagedsource proposto somente leitura: /mnt/dev/.peticao-r0003-local-pg17-qa-20261111/attempt-2/runs/71931338c422/source. Não foi copiado para R7. Runner verifica inventário COMPLETO antes de PG e depois dos testes, contra manifestos pinados source93557bfba931f8f731807fc9f30f1d88dbafedf1 + dependênciasprod f55595cd348c23ffe559dba2de9150259db9f1e7 + três pacotesQA tsx/esbuild/@esbuild. Limite de arquivo256MiB mantém SWC156809432bytes qualificado na revisãoR3, sem repetir falha do teto128MiB. Inventário inesperado causa falha; não há cópia alternativa nem chmod/mutação do source reutilizado. Root deve preservar esse source enquanto houver lease de execução R7.

Gitdiff entre f555 e93557 em site contém somente petition-base-route.test.ts; esse arquivo NÃO é executado. Dez pins específicos dos arquivos de histórico/testes/schema/componentes foram comparados byte a byte entre ambos os commits. Assim os seis testes atuais e o código por eles importado são f555; não se herda a antiga prova de uma biblioteca sem a1-worker/president-own. Guarda Node58cb node_guard/guard_policy/dns_guard copiada sem alteração; fonte config93557/DB55487 e closures tsx continuam fixas.

Os oito view/parser/SSR atuais são herdados, não repetidos: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794306537726264712, result0/sourceStable, TAP72–79, commit9811f81225486e6d7dfe4e96cf88d8e4e91cce1e. Comparei Git desses três arquivos (view.ts/view.test.ts/HistoricoDocumento.tsx) com f555, byte-idênticos. INHERITED-VIEW-PROOF.json fixa hashes dos arquivos e do result/source-manifest/log. Isso é herança limitada a esses oito casos e suas fontes, não nova execução nem validação de toda a antiga bateria.

## Seis casos novos propostos

1. Append-only e download bytes/hash/auditoria/Total, incluindo recusa UPDATE/DELETE/TRUNCATE CASCADE.
2. Preservação de original/variantes legadas e uploads sintéticos sem fabricar autoria; lote aprovado congelado.
3. Concorrência/ordinais únicos/observação repetida sem versões artificiais.
4. Falhas de auditoria revertem histórico/troca de bytes e download falha fechado.
5. Preparo atual createBatchForAdmin grava bytes/autoria atomicamente. É código normal do repositório f555, não draft unsigned em cache; não faz envio unsigned.
6. Handlers históricos reais: sessão/step-up, variante selecionada, hash/headers, lote divergente e conta revogada.

Os PDFs/identidades são fictícios. A estrutura /Sig do teste é sintética, sem certificado ICP real ou validador externo. Não exercitar IA/contatos/drafts unsigned bloqueados. MAIL_PROVIDER/MAIL_PROVIDERS=dev, APPROVER_EMAIL/RECIPIENTS vazios, proverores reais ausentes, diretórios config/credentials/GEO/HOME próprios vazios e MAIL_OUTBOX_DIR privado fora do source. Spool deve terminar vazio; os testes também têm asserções noMail. Nenhum código ou mensagem real será enviado.

## Isolamento, gates e coleta

Contexto LOCAL verdadeiro, sem WorkerContext/identidade Santiago. Unidade user peticao-r0007-local-history-core-pg17-qa-20261111.service, CPU2/Mem3GiB/Tasks256/RemainAfterExit=yes, orçamento600+reserva120, TimeoutStop120. Docker separadoCPU1/Mem512MiB/PIDs128/tmpfs256MiB (recursos adicionais à unidade), imagem665dc7... emcache --pull=never, bridge normal exclusivamente nonce/labels R7, publish somente127.0.0.1:55487. Nenhum dado/volume/rede de produção. Preflight imagem/porta, create/start únicos com validação pré/pós-start e IDs/labels; PostgreSQL170011/cluster_nonce/database pelo container e TCP host antes dos testes.

Loader tsx direto, um único arquivo fixo, padrão.* limitado àquele arquivo; guard autoriza pai/filho exatos. Exigir seis nomes TAP exatos e totals tests6/pass6/fail0/cancelled0/skipped0/todo0; extra/skip falha. Comprovar guarda instalada no pai e no único filho de teste, negações inesperadas0, preservar contagem das eventuais recusas IPC opcionais esperadas. Contar schemas t_document_history_* restantes0 e spool0. Inventário completo antes/depois e pins f555 devem coincidir.

Após resultado, drenar somente processos próprios, remover container/rede próprios com mesmosCID/NID e confirmar porta55487fechada. Timeout de create/start ou troca de identidade nunca repete por outro caminho. Resultado interno não basta: root coleta outer-result após export, manifesto+hash, retained-unit ExecMainCode/Status/Result real e cgroup inteiro drenado antes de stop/liberarlease. not-found/default0 não é sucesso. Nenhum deploy/merge; C2 e percentuais só podem mudar após essa prova real ser aceita.

Comando proposto, NÃO EXECUTADO: /mnt/dev/.peticao-r0007-local-history-core-pg17-qa-20261111/EXECUTION-COMMAND.txt. Fresh review/lease exclusivo de execução e conferência de recursos antes de lançar. A auditoria OTP segue documentada em /mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/approval-otp-reconciliation-audit-20261111/PLAN.md e não foi misturada à rodada histórica.


## Revision2 — root review corrected before any execution

Baselineea9ae83aec032c2f3d5fde228e9f92abdc5eac1e is preserved. Its main still inspected R3names after creating R7resources: the new main-lifecycle mock fails on that baseline before SQL/Node. All names now derive from one owned_name(nonce,kind) invariant used by creation, ownership validation, inspections and cleanup. The mock executes actual main through networkcreate→inspect→containercreate→inspect→start→reinspect with substituted Docker; no resource is created.

CancellationState counts signals and raises outside cleanup; during finish_run cleanup/export/receipt it defers repeated TERM/INT/ALRM and forces exit1. Node cleanup failure/signals do not skip Docker cleanup or export; a deferred signal during outer receipt writing is repaired to a failed receipt. Retained unit exit and complete drain remain required externally. Thirteen local mocks passed, including each cleanup/export/receipt cancellation stage and an explicit outside-cleanup cancellation. No real signals or Node/PG/Docker/core callbacks were run. Proof: /mnt/dev/.peticao-r0007-local-history-core-pg17-qa-20261111/mock-proof/revision2-result.json.

Registry kind is explicitly local-core-history-pg17-r0007-v1; six callbacks, not five; no remote/nativegovbr authority is claimed. Fresh review/lease remains required before execution.
