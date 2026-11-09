# Preparo do PDF e auditoria atômicos

08/11/2026, candidato local `candidate-stage02-domains`, após `f549418`.
A atualização dos bytes, hash, tipo de assinatura e estado `prepared` agora usa
a mesma transação/conexão da auditoria `batch_prepared`. Falha na auditoria
reverte essa publicação interna; o lote e suas assinaturas reservadas continuam
identificáveis como `preparing`, com evento de falha separado. Nenhum documento
já preparado/publicado é alterado por esta correção.

O bug foi reproduzido com dados fictícios: a auditoria falhou e o registro antes
da correção permaneceu `prepared`, com bytes e hash, sem evento de preparo.
Log original `/tmp/admin-root-prepare-vja9zacq/validation.log` preservado.

Depois da correção, o caso foi consolidado no arquivo já existente
`batches.test.ts`, evitando duas regressões equivalentes. A fixture inicial do
principal foi preservada em diretório privado de recuperação, fora do Git.
Rodada final: **6/6 aprovados**, zero falhas/ignorados/cancelados, incluindo lotes,
estrangeiros e assinatura; `/tmp/admin-root-prepare-fzhnbrnt/validation.log`.

O teste injeta falha de auditoria e confirma estado `preparing`, bytes/hash/tipo
nulos, assinaturas originais preservadas salvo o vínculo reservado ao lote,
cadeia de auditoria íntegra, evento de falha e nenhum aviso/e-mail/envio criado.
Cópias verificadas dos dois logs em `.cache/qa-preparation-atomicity-20261108/`,
ignorada pelo Git. Não houve tabela/coluna nova ou alteração de texto/interface.

Este bloco não implementa recuperação de preparo interrompido, persistência de
snapshot para reconstrução, gov.br ou documento final. A reserva inicial e sua
retomada permanecem em revisão. O resultado cumulativo do snapshot `8436fa2`
continua separado e não contém esta alteração posterior. O candidato final ainda
precisará recompilar e integrar suas mudanças. Nenhum deploy/merge/escrita VPS.
