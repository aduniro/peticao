# Reserva de assinaturas limitada à lista capturada

08/11/2026, candidato local após `fdc77b2`. Nenhuma alteração na validação de CPF,
nomes, textos, layout, esquema ou documentos já preparados/publicados.

## Corrida reproduzida

A criação lê a lista confirmada que será impressa e depois marcava todas as
assinaturas confirmadas ainda sem lote. Uma confirmação ocorrida entre essas
operações podia receber o vínculo ao lote sem constar da lista capturada para
seu PDF. Isso a retirava da seleção de assinaturas novas do próximo lote parcial.
Não se afirma que um cadastro real específico passou por essa corrida.

A regressão reproduz o interleaving inserindo uma confirmação fictícia no
BEFORE INSERT do lote, depois da leitura da lista e antes da atribuição. Antes da
correção, ela recebeu indevidamente `batch_id=1`; log original em
`/tmp/admin-root-prepare-v0u_qubk/validation.log`.

## Correção e prova

A atribuição passa a exigir também `id=ANY(ids da lista capturada)`, mantendo os
filtros de confirmação e ausência de lote. Uma assinatura posterior permanece
pendente para o próximo lote. A lista seguinte continua acumulada, como antes;
o primeiro PDF, seu hash, a lista e a data de criação permanecem imutáveis.

Rodada final **7/7 aprovada**, zero falhas/ignorados/cancelados, incluindo a nova
regressão e os testes anteriores de lotes, estrangeiros, assinatura e falha de
auditoria do preparo. Log `/tmp/admin-root-prepare-ujt1joh4/validation.log`.
Cópias conferidas em `.cache/qa-batch-snapshot-20261108/`, fora do Git.
Dados/contatos são fictícios, banco exclusivo54352 e mail dev. Não há envio real.

O commit contém somente este ajuste na atribuição, seu teste e este relatório.
As alterações simultâneas de recuperação de rejeição ficam fora do índice deste
bloco. A cumulativa do snapshot `8436fa2` não inclui esta mudança posterior.
Build/tipos/integração do candidato final permanecem necessários. Persistência de
snapshot e recuperação de preparo interrompido continuam pendentes. Sem VPS.
