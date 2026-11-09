# Cancelamento de lote — atomicidade da auditoria

Correção local de 08/11/2026 no candidato `candidate-stage02-domains`, após
`3a7bfdc`. Não altera textos, aparência, esquema, documentos ou versão publicada.

## Problema reproduzido

A chamada `cancelBatch` atualizava o status e apagava o código de aprovação antes
de gravar a auditoria, em comandos separados. Uma falha de persistência do evento
retornava erro, mas deixava o lote cancelado e o código consumido. A regressão
injeta uma falha no evento `batch_cancelled` e compara o registro completo.
Ela falhou como esperado em `/tmp/admin-root-cancel-evu65520/validation.log`:
estado `prepared` tornou-se `cancelled` apesar do erro de auditoria.

## Correção e prova

Atualização e auditoria agora compartilham a mesma transação e conexão. Uma falha
reverte as duas operações. Sem falha, somente estados já permitidos são cancelados;
a repetição não acrescenta outro evento nem modifica o PDF original.

A repetição, incluindo os testes anteriores de lotes/estrangeiros, passou:
**6/6**, zero falhas, ignorados ou cancelados. Log completo em
`/tmp/admin-root-cancel-cszonaiw/validation.log`. Conferidos bytes/hash/lista do
PDF, código antes do rollback, um único evento após sucesso, cadeia de auditoria
e ausência de novos assinantes, filas ou envios. Todos os dados eram fictícios,
banco isolado na porta 54351, entrega dev e configuração vazia. O runner encerrou
seu banco; nenhum serviço existente foi reutilizado.

Cópias verificadas dos dois logs em `.cache/qa-cancel-atomicity-20261108/`, fora do
Git. O build anterior de controles de pausa não é apresentado como prova deste
novo código: a integração final ainda deverá recompilar o candidato acumulado.

## Escopo restante

Isso não conclui assinatura/aprovação/envio de lotes nem a Etapa 6 inteira.
Versão e autoria transacional nas demais mutações, reserva de envio e tratamento
de resultado incerto continuam pendentes. Preservar os documentos publicados,
ICP e código de aprovação; não liberar transporte nem apagar registros de envio.
Nenhum deploy, merge com VPS, alteração pública ou mensagem a participantes.
