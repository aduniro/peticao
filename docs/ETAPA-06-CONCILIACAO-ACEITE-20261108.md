# Etapa 6 — conciliação de aceite sem transporte e AV17

Execução `d24c089484ec4e609dd3fe750e190284`. **continue**: não conclui a Etapa 6.
Base local `8436fa2`, bloco de reserva validado com 19 testes/build/tipos/HTTP.
A cumulativa do principal em snapshot separado só se aplica àquela base congelada.

## Contrato

Novo backend `batch-reconciliation.ts` e GET/POST protegido em
`/api/admin/lotes/[id]/conciliar`, sem controle visual conectado. Exige Total,
confirmação extra, origem no POST e revalidação transacional do administrador.
POST limitado a 1024 bytes e prova HMAC vinculada ao ator, documento, aprovação e
evidências exibidas. Não cria aprovação, código, mensagem, tentativa ou envio.

Só aceita lote com a reserva nova e exatamente uma auditoria `batch_approved`
compatível com versão/hash e destinatários congelados. A mesma fábrica de envelope
preserva literalmente os textos anteriores. Confere chave estável, destinatário,
canal, fingerprint e Reply-To original. Aceite exige tentativa finalizada aceita,
sem tentativa ainda ativa; não promove entrega individual, rejeição ou incerteza.
Estados ausentes/divergentes continuam bloqueados. Lotes legados sem essa prova
não são promovidos por inferência.

`batch_sends` e auditoria são atualizados atomicamente, preservando aceites já
gravados. Só conclui o lote quando todos os destinatários da aprovação têm aceite.
`sent_at` conserva valor anterior; quando ausente usa o último primeiro aceite
comprovado, com seis casas de microssegundos. Repetição não duplica auditoria nem
renova conteúdo. O fechamento normal também conserva `sent_at` já conciliado.
Aceite de transporte não significa entrega.

## AV17

Decisão explícita do dono transmitida pelo principal: “APROVAR ESSE AVISO DOS
LOTES”. Aplicado o texto exato “Resultado do envio a conferir. Verifique o histórico
antes de tentar outra ação.” ao resumo com falhas. Mantém quantidades, fontes e
layout; evita ponto duplicado. Resumo sem falhas e razões de recusa permanecem.
Catálogo registra origem/proposta exata e que a aprovação é posterior a `8436fa2`.
Não aprova outros AVs ou deploy/merge.

## Validação efetiva

`python3 tools/admin-qa/consolidation.py --document-tests`: 21/21 em
`/tmp/admin-consolidation-n4a08xkg/validation.log`; tipos saída 0.
Depois de AV17 e prova de expurgo: **22/22**, saída 0 em
`/tmp/admin-consolidation-dc7ei2ve/validation.log`; tipos saída 0.
Artefatos copiados em `.cache/qa-batch-reconciliation-20261108/` (fora Git).

Regressões: aceite com resultado não persistido, falha de auditoria com rollback,
dois conciliadores concorrentes/replay sem duplicação, recusa de incerteza/prova
divergente/ator revogado/documento alterado; expurgo real por `purgeArchivedContent`
após idade fictícia de 31 dias, conservando conteúdo expirado e data de aceite
fictícia `2026-11-08T12:34:56.123456Z`. Sem leitura/recriação do conteúdo expirado.
AV17 testado com contagens positivas e zero aceites, sem alterar resumo de sucesso.

Build atualizado saída 0, helper `verify_admin_candidate.py build`, sessão16877;
captura em `.cache/qa-batch-reconciliation-20261108/build.log`. Tipos pós-build
também saída 0. Primeira execução HTTP em
`/tmp/admin-consolidation-reqmd8iw/validation.log`: reserva passou, conciliação
recebeu303 em vez do500 injetado. Os contratos compartilhavam caixa dev, e a
fixture selecionava o primeiro código do lote1, pertencente ao contrato anterior.
Isolada a caixa por contrato no runner; nenhuma assertion/guarda foi relaxada.

Repetição conjunta `--contracts batch-reservation batch-reconciliation` saída 0 em
`/tmp/admin-consolidation-onhenc1d/validation.log`, com ambos os JSON positivos.
Configuração fictícia restrita aos contratos; perda de persistência/rollback
injetados, conciliação concorrente, prova de expurgo e AV17 verificado em resposta
compilada com falha antes do transporte. Logs inicial/final e JSON preservados em
`.cache/qa-batch-reconciliation-20261108/`. Commit identificado no checkpoint seguinte.

## Próximas lacunas independentes

Recuperação de rejeição conclusiva com nova aprovação permanece pendente; reserva
consumida continua bloqueando qualquer repetição, inclusive nesse caso. Não liberar
incerteza. Rever atomicidade do preparo inicial de PDF/auditoria sem tocar bytes
publicados. AV9/11/12/16 seguem pendentes, sem ativação. Nenhum dado real, mensagem
externa, publicação nominal, decisão CPF, outro worktree ou VPS alterado.
