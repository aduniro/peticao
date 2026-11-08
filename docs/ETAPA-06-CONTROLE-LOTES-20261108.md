# Etapa 6 — controle de lotes, continuidade local

Execução `d24c089484ec4e609dd3fe750e190284`, candidato exclusivo
`candidate-stage02-domains`. Estado: **continue**; este bloco não conclui a Etapa 6.

## Controle de pausa e confirmação extra

As seis rotas de escrita de lotes exigem Total com confirmação extra vigente.
A página encaminha à confirmação existente. Pausa/retomada recebe estado desejado
explícito e versão vinculada ao ator e à revisão da configuração exibida. Revalida
o usuário atual e grava configuração/auditoria na mesma transação. Resposta perdida
não transforma repetição em alternância; concorrentes e versões antigas conflitam.
Corpo limitado a 1024 bytes. Aparência, botões e mensagens existentes preservados.

Validação efetiva: `python3 tools/admin-qa/consolidation.py --document-tests`,
**10/10**, saída 0, log `/tmp/admin-consolidation-5de4k0fh/validation.log`.
Inclui concorrência, versão obsoleta, mudança de papel/identidade, rollback por
falha da auditoria, autorização/stepup/origem e corpo limitado das rotas.
Tipos aprovados pelo helper `verify_admin_candidate.py types`, saída 0.
Build e tipos pós-build executados pelo principal: saída 0 nos logs
`/tmp/admin-root-document-build-20261108.log` e
`/tmp/admin-root-document-types-20261108.log`. Outra execução de tipos cruzou o
aviso do principal e também terminou 0; não há alteração motivada por ela.
Contrato `python3 tools/admin-qa/consolidation.py --contracts batch-control`:
saída 0, `/tmp/admin-consolidation-4ohlftup/validation.log` e `batch-control.json`.
HTTP compilado comprova redirecionamentos, seis recusas por falta de stepup,
origem/corpo limitado e dois POST concorrentes (303/409), autoria e preservação
dos documentos, sem escrita em assinaturas/fila/envios. Cópias dos logs e JSON
em `.cache/qa-document-control-20261108/` (artefatos locais, fora Git).

## Lacunas observadas, sem aceite fabricado

`approveAndSend` ainda lê código/status sem reserva transacional, consome código e
audita separadamente; chamadas concorrentes podem chegar ao transporte antes de
`batch_sends`. Falha incerta não pode ser tratada como autorização para repetir.
É necessário vincular aprovação ao documento e reservar identidade de mensagem,
sem manter transação aberta durante HTTP.

`attachSignedPdf` valida antes da gravação, sem comparar a revisão atual após o
validador; atualização e auditoria precisam ser atômicas. `cancelBatch` também
precisa unir mudança e auditoria. Preservar ICP, códigos, textos, bytes, hashes e
documentos publicados. Próximo bloco: concorrência/rollback nesses fluxos e
idempotência com journal existente, somente transporte fictício.

Nenhum envio de lote, publicação nominal, promoção de decisões locais, deploy ou
merge VPS realizado. AV9/11/12/16 continuam pendentes; nada foi ativado por inferência.
