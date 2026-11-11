# R14 — documento da confirmação própria: gerar, recuperar e baixar na UI

Rascunho em `/mnt/apps/peticao-final/_ops/qa-r0014-own-document-browser-20261111`, fonte/runtimef55595cd348c23ffe559dba2de9150259db9f1e7. **PREPARAÇÃO SOMENTE; NÃO EXECUTAR.** Nenhum app, PostgreSQL, Docker, navegador, PDFreal ou Poppler foi iniciado nesta preparação.16mocksPython+9Node ligados ao fluxo passaram; não constituem prova do recurso.

## Bloqueio de infraestrutura explícito

`config.json` contém `infra_reviewed:false`; `functional_smoke.py` recusa execução ANTES do marcador/DB. O controlador foi herdado de R13 com timeoutcreate30s e cleanupincerto; a falha real R13 mostrou que o daemon pode concluir create depois do timeout. Este candidato NÃO qualifica essa infraestrutura nem altera timeout. Deve receber patch comum que o agentePerfil prepara, adaptado a nomes/pinos próprios, revisão independente e NOVOmanifesto/commit antes de qualquer ensaio. Nunca retry automático nem limpeza de rede enquanto criação incerta. Root decidirá a ordem R13v2/R14. Esse gate intencional precisa permanecerfalse até a integração revisada.

## Precondições honestas

O PDF ORIGINAL é uma precondição semeada: cópia fictícia83.680bytes gerada anteriormente pelo runtimef555 no R12, SHAa4bc11db09cb778c0145706e22c953abd7375095b28d6995f39628d7c5c2ceea, listHashe3b3bd547df3f5f5e90a85d7408b259dde30a7c9589973fa23456c93c0309e0a e reciboROOT148d6d7f3681e6453699bf0e08ce38b59a32020d3a44477c24ffad7258a42dd7. `/fixtures/original-proof.json` registra origem absoluta e hashes; preflight verifica arquivo e recibo. Não alegar nova geração do original nesta rodada.

A fixture cria só um loteoriginalprepared com esses bytes, dois usuários fictícios, perfilresponsávelfictício e um comprovanteconsumed SEMEADO com perfil/fingerprint/documentVersion/receipt e tempos coerentes. Não emite desafio nem consulta CPF/identidade externa; não há validação de identidade real. ZERO own_document_intents/results/artifacts preparados. A operação NOVA a validar futuramente é o PDF de confirmação própria produzido pelo backend compilado a partir desse comprovante. Este PDF não é assinatura ICP/gov.br e dispatchAllowedfalse permanece.

## Fluxo planejado e evidências

Antes do navegador: GET de metadata com UUIDausente fixo semsessão401, loginowner303, mesmoGETowner antesstepup403; loginreader303 e mesmoGETreader403. Stepupowner semeado sódepois. Esses GETs não geram documentos e não alteram perfil. Browser freshcontext usa somente cookieowner Secure/HttpOnly/SameSiteStrict real; não herda sessão do dono nem testaUIlogin.

Na UI `/admin/presidente?lote=1`: Consultarhistóricodeconfirmações→comprovantecompatível→Preparardocumentodestaconfirmação→GerarPDFdaconfirmação. Permitir exatamente1POSTJSON em `/api/admin/presidente/documentos-proprios`, corpoexato vinculado a batch1/receipt/documentVersion/requestUUID e fasearmada. Não clicarA1, configurarperfil, emitirCPFchallenge, prepararouenviarpacotes.

POST200completed deve ter metadata exata `president-own`, dispatchAllowed/icpBrasil/govBrfalse, sourceSha doR12, request/receipt/documentVersion exatos e novoartifactUUID. Handshake nonce/source fixa só libera downloads quando fixtureconfere1intent/1result/1artifact/autoria1, sourcebatchfingerprint inalterado, evidenceDigestcanonical e hashes/bytes. ConferirgeraçãodoPDF executa GET manualMESMOrequestUUID e retornaMESMOartifact/hash; baixarPDF e consultar inventáriopróprio/baixarnovamente confirmaDB/2downloadsiguais. O contratoWIRE de inventário é `documents` (kindartifacts), não `artifacts`; regressão preserva expressão pre-fix falha com JSON real, contratoTS pinado e assertcorrigida. Receipts usa `receipts`.

Recarregar a página noMESMOcontexto/sessão mantém sessionStorage, consultar e selecionarMESMOcomprovante remonta controle com requestUUIDoriginal; botãoGerar deveficardesabilitado. GETmanual recuperaMESMOartifact/bytes e nenhum POSTextra. MetadataPOST/GET valida todas as chaves/tipos/proveniência, inventário confere assurance/IDs/hashes/createdBy/source/dataUTCmicrosegundos.13checksUI exatos, zero requests não revisados, errosJS ouconsole; screenshot final mascara passwordinputs.

Fixturefinal deve ser idêntica à foto pósgeração: próprio1/1/1, fonte/hashoriginalconstantes, batch_document_versions continua0 (inventário próprio é OUTRO journal), A1jobs/validations/inputs/mailmessages/attempts/outbox/batch_sends0. Nenhum originalready/pacote/aprovação é promovido por ler histórico.

## Parsing e visual

Popplerpinado é apenas execuçãoFUTURA: PDFpróprio6páginas versus5originais; comparar texto das primeiras5 comPDFR12 e verificar página6 contendo nomefictício/receipt/sourceSHA/Confirmaçãodoresponsável. Comparar texto NÃO comprova preservação gráfica: permanece pendente rootrenderizar ambos com mesma versão/escala e comparar as5primeiras imagens e avaliar página6. Nenhuma alegação ICP/gov.br/CPFexterno ou aprovação/envio.

## Recursos, privacidade e aceite

RuntimeR6 reutilizado diretamente somente sob futura lease EXCLUSIVA de execução, manifesto7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3, inventáriointegral antes/depois e origemR2. Não copiar node_modules/runtime nem modificar/limpar R6/R12. Sem mountreadonly alegado.

Unidade futura `peticao-r0014-own-document-browser-qa-20261111.service`, CPU2/Mem3GiB/Tasks256/Runtime720s/grace120s/RemainAfterExityes; DB127.0.0.1:55494/app127.0.0.1:31394. DockerPG17.11cached/bridge/container/labels/nonce próprios (infraPENDENTE), sem segredos/volumes reais. Node20b964 e Chrome145481fea/sandboxtrue/TMPcurto0700 pornonce/inode, proxyexternofechado+routeallowlist; guardNode sóDBTCP/listenloopback, semDNS/fetch/TLS/UDP/subprocesso. Não alegar isolamento de egressOS.

MAILdev e APPROVER/RECIPIENTSvazios. PRESIDENT_OWN1 apenas, A1/govbr/reference/public/cron/provedores0. Cookieowner/reader/private-markers/browser-config/spool/logsservidor/fixture ficamprivados foraGit/export; fonteCPFexemplo é fictícia e sóHMAC vai paraDB. Exportallowlist contém recibos/guard/PDFsnovosfictícios/screenshot e hashes, não credenciais. Artefatos/request/receiptUUID são metadados de contexto, não senha.

Após patchinfra e revisão, sucesso requer13UIchecks+1POSTnativo,3recusasmetadata401/403/403, pósgeração/recovery/histórico/bytesimóveis, auth/policy intactos, guarddoPIDapp instalado0denials, Node/browser/TMP/PGDocker próprios drenados, portasfechadas, outerexit0 e unidadeRETIDA da invocaçãoexata antesstop, runtimehashstable e visualROOT separado. Nenhuma execução real nesta entrega e nenhum percentual de produto atualizado.
