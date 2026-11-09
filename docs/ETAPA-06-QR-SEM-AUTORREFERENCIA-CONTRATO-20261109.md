# QR e hash de documento: contrato sem autorreferência

Auditoria somente leitura em09/11/2026. Pedido original: LOG04 item1.8,
linhas154–156. Fonte corrente adicional inspecionada no candidato principal
`8cdd97a`: `document-verification.ts`, `batch-document-history.ts`, `pdf.ts`,
`batches.ts` e documentos de histórico/metadados. Esses arquivos estavam limpos
na leitura. Este documento não altera código, PDF, assinatura, gate, UI ou VPS;
não inclui helper artificial ou teste que alegue fechar uma integração ausente.

## O que está aprovado e o que existe

O pedido exige preservar o padrão visual, incluir representação da confirmação
do presidente, hash eQR, e manter o envio travado. A relação assinatura própria/
ICP-Brasil continua escolha material separada. Autenticar presidente com senha/
CPF/nascimento não permite declarar validação criptográficaICP.

`buildBatchPdf` já usa hash da lista eQRs das assinaturas individuais. EssesQRs
consultam o código de assinatura, não a integridade de todo oPDF. Não há blocoQR
do documento baseado em hash final do próprio binário nesta fonte.

O histórico corrente preserva variantes binárias e seusSHA256. O UUID da versão
é produzido em `appendDocumentVersion` **depois** de existirem os bytes.
`documentVerificationUrl` exige UUID da versão eSHA256final, compondo
`/api/documentos/verificar/<uuid>?sha256=<hash>`. A API atual tem gate global
defaultoff, liberação administrativa explícita Total/stepup/CAS, auditoria e
vínculo à variante imutável exata atualmente selecionada/aprovada. Retorna só
metadados permitidos, sem binário/PII e com `onlineValidationPerformed:false`.
A URL não é uma autorização independente desses controles.

## Circularidade e variantes

Se oQR contémSHA256 doPDF inteiro e esseQR entra nos próprios bytes, incluir ou
mudar oQR muda oSHA256. Calcular outra vez e regravar o resultado não resolve o
ciclo. Um hash de bytes com um campo previamente zerado/excluído é outra função
de compromisso; não pode ser rotuladoSHA256 do arquivo integral.

Assinatura incremental também acrescenta bytes. O hash doPDFbase é diferente do
hash da variante assinada. O verificador estrutural atual exige que o upload
preserve o prefixo original e a assinatura cubra a revisão, mas isso permanece
distinto da validação criptográfica do adapter. InserirQR/carimbo depois de
assinar alteraria bytes cobertos e não está autorizado.

Usar o hash doPDFbase no lugar do final sem explicar seu escopo seria incorreto.
Além disso, o endpoint atual só admite a variante selecionada atual; umQR para
uma variante original pode deixar de ser elegível quando a assinada é escolhida.
Não reaproveitar esse endpoint silenciosamente como resolvedor de edição lógica.

## Opções executáveis para decisão

### A. Recibo externo aoPDF, compatível com o contrato atual

Finalizar/admitir o binário sem o modificar, capturar versão e hash, aprovar e
liberar metadados explicitamente; só então gerarURL/QR em recibo separado do
arquivo. OQR usa UUID/hash finais reais, e oPDF mantém os mesmos bytes.

Vantagem: aproveita o endpoint/gates existentes e evita autorreferência. Limite:
oQR não estará dentro do mesmoPDF; precisa aceitação explícita dessa apresentação.
Uma página anexada ao próprioPDF não seria recibo externo e voltaria ao problema.

### B. Referência opaca pré-alocada dentro de futurosPDFs

Antes de renderizar, reservar um identificador de referência da edição lógica;
embutir umaURL que contém esse identificador, sem o hash final. Depois da
finalização/assinatura, associá-lo explicitamente ao UUID/hash da variante final
capturada/aprovada. O hash final permanece no recibo/metadado externo. A referência
não é o UUID de variante hoje gerado depois dos bytes e não pode mudar de sentido
silenciosamente para outro documento.

Vantagem: permiteQR interno sem ciclo e preserva assinatura incremental. Limites:
exige contrato novo de referência/resolução, vínculo/versões/revogação e controles
aditivos. O gate defaultoff e a liberação da versão exata continuam obrigatórios.
Não autoriza mudar o endpoint atual para aceitar hash ausente nem substituir a
variante aprovada sem nova decisão. UmQR copiado para papel/arquivo adulterado
continua identificando o registro, não autenticando visualmente esse suporte;
é necessário comparar oSHA256 do arquivo efetivamente apresentado.

### C. Compromisso de conteúdo ou hash da fonte, rotulado como tal

Imprimir `listHash`, hash de manifesto canônico ou hash doPDFfonte conhecido antes
do bloco. ConservarSHA256final integral fora do binário. Isso elimina o ciclo
apenas porque os objetos de hash são distintos; não equivale a validar oPDFfinal.
Depende de escolher/rotular o escopo e de um resolvedor apropriado. Não declarar
que o hash da lista ou da fonte é o hash final solicitado.

## Invariantes e aceites antes de integrar

- Escolher uma opção e identificar em cada campo qual objeto foi hasheado.
- Nunca regravar bytes antigos/assinados, nem inserir oQR após assinatura.
- Preservar algoritmo/layout/QRs individuais; qualquer bloco visual novo passa
  por aprovação e teste de regressão/renderização próprios.
- Em opçãoB, referência prévia e UUID/hash de variante são tipos distintos;
  associação e autorização exatas/auditadas não podem ser presumidas peloQR.
- Hash exibido deve ser recalculado dos bytes finais capturados, após todos os
  passos que os alterem, e confrontado com histórico/aprovação/release atuais.
- Testar trocas de variante, revogação, referências copiadas, alteração de bytes,
  ausência de aprovação, URLconfigurada segura e ausência de publicação implícita.
- Metadados íntegros/aprovação registrada não significam que a consulta validou
  ICP-Brasil, gov.br, identidade, certificado, revogação ou entrega do documento.

Nenhuma opção foi implementada ou escolhida por inferência. Não houve build,
teste, consulta pública, abertura dePDFreal ou modificação de documento. Os gates
e a API atual permanecem exatamente como estavam, desligados por padrão.
