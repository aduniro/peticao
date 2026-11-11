# R14 — documento da confirmação própria: gerar, recuperar e baixar na UI

Revisão2 do observador em `/mnt/apps/peticao-final/_ops/qa-r0014-own-document-browser-20261111`, fonte/runtimef55595cd348c23ffe559dba2de9150259db9f1e7. A primeira execução real7582e0d58daa4da88d84d4d119229e52 falhou depois de criar o PDF próprio, na leitura do primeiro GET pelo CDP; falha/marker/run preservados. Esta revisão NÃO executou app/PG/Docker/Chrome/Poppler e depende de revisão/rootlease novos.43mocksPython+17Node ligados ao fluxo passaram; não constituem prova real da nova versão.

## Bloqueio de infraestrutura explícito

O freeze anterior e6ac055 manteve `infra_reviewed:false`. Nesta revisão, o root habilitou `infra_reviewed:true` após o aceite real R13v2 e a revisão independente do port R14, vinculados em `INFRA-ACCEPTANCE.json`. Uma configuração não revisada continua sendo recusada ANTES do marcador/DB. Esta revisão porta somente a correção mínima R13v2 (commit 13a25175f3ea1a3e625e97e7c1e38080cbfdba7e): create único com orçamento de 90s, estado incerto persistido antes de qualquer mutação Docker, confirmação de identidade e fence antes de liberar incerteza. Em timeout, sinal ou erro após mutação, não iniciar/repetir nem remover dependências; recibo falha e exige reconciliação manual. Os limites globais continuam 600s/720s e TimeoutStop120. O aumento de orçamento não comprova causa de I/O resolvida. Nenhum gate de falha anterior R13 foi portado: A primeira R14 permaneceu independente do antigo nonceR13. A infraestrutura aceita não autoriza repetir a tentativa: observadorv2 usa NOVAintenção estática vinculada à própria falhaR14, manifesto e lease root novos.

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

## Revisão2 — observação GET pela UI tipada, sem ler corpo via CDP

Falha1 é fato preservado, não diagnóstico definitivo do aplicativo: response.json no primeiro GETmanual lançou Network.getResponseBody/no data. Troca SOMENTE observação dos GETreceipts/artifacts/recovery: esperar status200, response.finished()===null e request.failure()===null; validar DOM que o próprio cliente tipado consumiu. POSTack.json permanece igual (já passara), DBhandshake/downloads/13checks/1POST e fonteapp preservados.

Receipts: exatamente1linha com receiptID correto/Compatívelcomdocumentoatual e preparar habilitado. Inventoryartifacts: exatamente1linha com artifactID/hash/URLdownload exatos. Ownrecovery: observerDOMsomente leitura instalado em estado fixtureisolado Symbol/Promise; evaluate retorna ACKready e é AGUARDADO antes do click (não aguarda transição antesclick, evitando deadlock). Depois GETfinalizado, exige observar aria-busytrue+statuslimpo e depois busyfalse+COMPLETED novo. Assim mensagemuncertain ou artifact/link antigos NÃO comprovam sucesso. Validar requestUUID/receipt/documentVersion/PDFsha/sourceSHA/linkartifact exatos do DOM atual. Estados observados são limitados64frames/180chars; helper de freshness usado no caminho real.

CincoGETobservados devem ter as fasesexatas: receipts, ownrecovery, artifacts, receipts pósreload, ownrecovery pósreload. Sem respostaJSONviaCDP nessas leituras, sem relaxar rede/HTTP/UI. Regressores têm response.json que lança CDPmasDOMválido, hash/ID/sourceerrados, HTTP403, finishedError/requestfailure, staleCOMPLETEDsemciclo e UIuncertaincomartifactantigo. Mocks provam ACKdeinstalação antesclick. Diagnóstico futuro bounded salva fase/status/finishedError/requestfailure/ownStatus; emfalha screenshotmascarapassword. SemHTML/cookie/header/trace. PNGdefalha fica no run, FORA da exportallowlist, com filename/hash técnico; captura e logs do servidor não são publicados.

Novo marcadorliteral `/mnt/apps/peticao-final/_ops/qa-r0014-own-document-browser-20261111/execution.response-observation-v2.started` O_EXCL/NOFOLLOW. Gate exige reciboROOT6002a111ce453b60eeb2a3229ce57d402cff778d75bb27a79ee483f8d5cc6807,4UIpartial/13planejadas,1POST/exit1/cleanuptrue, mesmaunidade7582failedloaded/ExecMainCode1/Status1 (MainPID não constava no snapshotROOT, não foi inventado), outerfailed/stable/NodeCG/ports/PGstopped e hashesrootdeouter/browser/proof/unidade+execution.started original. Nenhum retrygenérico nem substituição da falha1. PREVIOUS-OBSERVATION-FAILURE.json pina5arquivos/marcadorantigos.

O hook também preserva a snapshot técnica pósgeração antes do ACK, permitindo distinguir criação de recuperação caso nova observação falhe; validaçõesDB não foram alteradas. source/journals final ainda só qualificam se ensaio completo passar. Mockprep intermediário com2asserts desatualizados falhou e está preservado em mock-proof/observation-v2-prep-attempt-1.json;43Python/17Node posteriores passaram. Novo ensaio continua pendente e visualroot permanece separado.

## Diagnóstico pontualv3 — ainda não executado

O ensaio v2real falhou após6/13checks: recuperação GET com DOMnovo e primeirodownloadbyteigual passaram; artifactGET200terminousemfalha, maslinknãoapareceu anteswrapper150s. A causa não foi atribuída ao app nem ao harness. Preserva runs/b450444f60d2/root-failure-receipt.json SHA114aa409203c74d3621047cf8c3399d4368b9fa1541551debf0fb9c924a126a3, unidade/invocationbf03, marcadorv2 eprimeirafalha6002.

Novo marcadorliteral execution.history-diagnostic-v3.started exige ambasfalhas, hashesproofs, retainedfailed1/cleanup/runtime/portasdrained eoldv2marker. Nenhumreplaygenérico. latest-run.json foi removido SOMENTEdoíndice/futuroinventário eignorado; arquivo físicopreservado, oldcommit96pinsnãoalterado.

Browseragora defaultlocator10s/navigation20s; artifactlinkwait10s. ApósnativeGET200/finishednull/requestfailure0, faz EXATAMENTEumGETauxiliaryread-only artifacts dentroda página(fetch comheaders x-r14-history-observer:1,Abort5s/body64KiB), contabilizado como sourceobserver. Não usa CDPbody. Salva history-diagnostic.json comJSONtécnico, mensagenshistory,busy,rows/linkcount echecagemcontratual. Essa observação NÃO substitui13UIchecks; DOM/link e2downloads continuamobrigatórios. Falha captura own/historyrolestatus ePNGpasswordmasked anteswrapper150s. history-diagnostic.json/PNGfalha ficam própriosdorun, semnovaexportallowlist; resumoJSONtécnico tambémconsta own-browser-result.

Apóscapturareal, parse-captured-history.ts pode ser executado emprocessopuroisolado pelo root contraJSONcapturado, importando o parser atual pinado contracts/site__src__lib__president-own-history-client.ts (byteigualf555). Requer Node20/tsxlocalverificados, semapp/DB/rede; reporta parseraceitou/recusou ekeys, jamaisqualificaUI. Oprofile não lança esseprocessoautomaticamente e ainda não existeJSONrealda nova leitura. Dependência loader/ambiente do probe deverá serqualificada antes dessa execuçãoauxiliar.

47Python/21NodepurePASS;2snapshotsmockdesatualizados falharam antes eforampreservados emmock-proof/history-diagnostic-v3-prep-attempt-1. Nenhumapp/PG/Docker/Chrome/Popplerrealexecutado nesta preparação. Próximoensaio exige root+peerreviewfreeze eleasefresh.
