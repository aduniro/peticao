# Prontidão factual: documentos e aprovação

Captura local8cdd97a mais correção isolada deJSON/holder e-CNPJ. Este mapa trata
capacidade observada no código/testes, não configuração ou saúde atual daVPS.
Não leucredenciais, certificados, banco real ou arquivos privados do proprietário.

| Fluxo | Estado factual | Impedimento/aceite para uso |
|---|---|---|
| Gerar/retomarPDFde lote | backend e formulários existentes; snapshotdurável preservado | QAcompilado atual e ambiente publicado precisam corresponder àversãoaprovada. Não reconstruir lote antigo semsnapshot. |
| A1e-CNPJporassinador externo e upload | caminho de download/upload disponível | Usar oPDFexato do lote e assinador compatível com prefixo incremental; adapterICPreal homologado comholderADUNIR precisa existir. JSONmock não comprova essa homologação. |
| A1 automático no servidor | `signPdf` implementa apenas`SIGNER=none`; outrosmodoslançamerro | Não configurar`SIGNER=icp` como se jáfuncionasse. Instalação/uso doPFXe senha é outrafrenteautorizada, semchave nestecheckout. |
| Holder do adapter | lacuna corrigida nesta branch: CNPJobrigatório/correto eJSONlimitado | Integrarcommit e executarQAHTTPdo fluxo. Arquivoexternoadmitido não éICPnem liberaenvio. |
| Confirmação própria do presidente | perfil/desafio/recibo duráveis e APIs existem | UIprópria ainda desabilitada; reciboown-confirmation não assinaPDFnem altera`signature_kind`. Depende integraçãovisual/identidadeconfigurada e decisão técnica de representação. |
| gov.br integrado | botão desabilitado; nenhum adapterde assinatura gov.br é exposto pela tela | Uploadgenérico não equivale integraçãoOAuth/gov.br, nempromove assinatura avançadaaICP. |
| Petiçãogov.brfixa para todoslotes | proprietário aprovou PLANEJAR como anexo-base independente imutável | Exige registro/versão/hash/manifesto de anexos. O ofício/lista do lote continua seuprópriodocumento; assinatura da petiçãobase não assina ofício/lista novos. NenhumPDFfoi modificado. |
| Código e aprovar/enviar | backend e formulários existentes; código vinculado àrevisãode bytes | GateICPprodução, Total/stepup, aprovador/destinatários e transportes configurados continuam exigidos. Não foram liberadosenviosreais. |
| Histórico binário | tabelaimutável e endpoints protegidos existentes | Tela atual mostra bytes correntes e documentos/lotes, não interface de versõescompleta. Integrar endpoints existentes é correção independente de nova política. |
| Resultado e conciliação | comprovantes e ação de conciliarsemreenviar existentes | Aceite do transporte não comprova entrega. Incerto continua bloqueado para repetição. |
| QR/hash do documento | QRsindividuais jáexistem; endpointmetadadodocumento defaultoff | QRcomhashfinal do próprioPDF é circular. Opções documentadas no contratoQR; não bloqueia preservação dos PDFsatuais. |

## Prioridade prática de integração

1. Integrar a correção e-CNPJ, validarHTTPdownload→upload→classificação→aprovação
   comadapterloopbackfictício, autorizações e preservação dos bytes/histórico.
2. Homologar oadapter real emfrenteexplicitamente autorizada, com PDFefetivamente
   assinado peloe-CNPJADUNIR. A presença deURLconfigurada naUI não prova saúde,
   identidade ou validação criptográfica correta.
3. Para operação inicial segura, o caminho jáexistente é assinatura externa do
   **arquivo do lote** e upload. A1automático, confirmaçãoprópria e basegov.br são
   capacidades distintas; nenhuma deve ser mostrada como concluída apenas para
   preencher a tela antes do prazo.
4. Integrar o histórico de versões ao portal com componentes/avisos jáaprovados,
   sem mexer nos bytes. APIsjáexistentes evitam criar outro backend de documentos.
5. Projetar anexo-basegov.br separadamente com a frenteAPOIO; preservarICP para
   documento do lote e não reusar assinaturade outrobinário como sua assinatura.

Novoaviso do validador: **REJEITADO** pelo dono; mantidas mensagens existentes e
códigos internos. Não repetir a pergunta. Nenhum deploy está autorizado por esta
prontidão e não se afirma que esses fluxos estejam operacionais naVPS hoje.
