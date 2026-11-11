# R13 — botão nativo e PDF moderno preparado para A1/referência

Rascunho privado `/mnt/dev/.peticao-r0013-local-pdf-preparation-browser-qa-20261111`. **Não executou browser, app, HTTP, PostgreSQL, Docker, geração/parsing/rasterização real de PDF.**15mocksPython+8Node de política/conteúdo dummy passaram. Exige root+peerreview e nova lease de execução.

Fonte fixa f55595cd348c23ffe559dba2de9150259db9f1e7. Controladores pequenos vêm do GitR12/903b8c5c; Chrome145/sandbox/TMPcurto/cleanup e ícone estrito vêm do GitR10/c946e019. Não alterar R6/R9/R10/R11/R12. Runtime f555 reutilizado diretamente de `/mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/runs/af07e86c4964/runtime`, origemR2 também verificada antes/depois contra manifesto7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3. Sem cópia grande ou alegação mountRO; se drift, interromper/preservar, nunca desfazer cegamente.

## Render moderno sem assinatura

Seed:2usuários e3assinaturas fictícias confirmadas, zero lote/PDF/history/snapshot/reference. Única configuração adicional é o settings `batch_a1_policy_v1` **SINTÉTICO**, formato dos testes f555: profile `pades-basic-unhomologated-v1`, versãoUUID/truststore/fingerprint fictícios, CNPJ de identificação esperado e credentialActive metadata. **Não há PFX, senha, certificado, arquivo de credencial ou operação criptográfica**. `a1PreparationEnabledTx` apenas determina o alvo do render; não cria job, assina, aprova ou envia.

SIGNERnone, BATCH_A1_ENABLED1, DOCUMENT_REFERENCE_ENABLED1. O código real deve criar snapshotv2/meta.signaturePreparationa1/signedNote vazio e referência reservada porautor1. A publicação permanece original/`signature_kind=none`, statusprepared, semsignedPDF. No banco, jobsA1/validations/bindings/aprovação/envios/mail devem continuarzero; sem jobs não há tentativas de worker. Esses invariantes são conferidos no handshake póscriação e no final.

`documentReferenceUrl` recusa IP/loopback/http/.test/.invalid. Por isso DOCUMENT_REFERENCE_ORIGIN=`https://documents.example.org` é **apenas TEXTO/QR sintético**, como nos testes existentes. APP_URL e browser continuam loopback31393; DOCUMENT_VERIFICATION_PUBLIC0. Não navegar/acessar essa origem, não publicar documento nem contornar o contrato para aceitarlocalhost. URL/UUID da referência são conferidos contra snapshot/tabela/audit e textoPDF. A referência não é vinculada ao documento final assinado/publicado.

## Browser e bytes reais

LoginHTTP real de owner fictício, step-up SQL explícito (não homologa desafio de login). Mesmo cookie Secure/HttpOnly/SameSiteStrict no browser, sem enfraquecer CSP ou sandbox. ReadinessHTTP `/privacidade`200 não depende de PRESIDENT_OWN_ENABLED, que permanece0; não habilitar outro fluxo para satisfazerQA.

Novo driver `/mnt/dev/.peticao-r0013-local-pdf-preparation-browser-qa-20261111/preparation-browser.cjs`: arma apenas **UM POSTvazio** nativo `/api/admin/lotes/criar?portal=presidente`, com Origin/Referer/método/query exatos e bloqueio de repetição. Login ocorre fora do browser. Aprovação/envio/código/A1worker/validação/upload/draftsunsigned são proibidos, mesmo com policyA1 metadata ativa. GETs somente portal selecionado, assets pinados, ícone localGET/HEAD exato semquery, alertashidratação, PDForiginal e histórico/versionUUID exato liberado pelo broker. Origemhttps da referência é bloqueada como externa.

Quinze checks de browser planejados: contextosemcookiesherdados; portalvazioautenticado; botãofinal habilitado; clique nativo303; documento pronto; botãofinal desabilitado; snapshotmoderno/ref via handshake; downloadoriginal exato; históriaúnica; downloadhistórico exato; Escape/foco; POSTúnico; zero requestsinesperados/JS/console.

O broker reage somente a um evento fixo criado após303/portalpronto: verifica nonce/source, consulta fixture própria, exige reserva/listHash/snapshotv2/autoria/histórico/reference/A1jobs0. Não aceita comando/SQL do driver. ACK0600 traz apenas metadadosdocumentais. Browser então baixaPDForiginal e versãohistórica reais e compara com os bytes publicados noDB. Não há PDF présemeado nem re-render de referência pelo harness.

Após browserclose, SQL exige estadoidêntico ao snapshotpóscriação e zerooperaçõescriptográficas/envio. Mailproviderdev, APPROVER_EMAIL e RECIPIENTS vazios evitam inclusiveavisonotifyApprover. Spool/journals/attempts/outbox/batch_sends devem ficarzero.

## PDF e referência: limite da prova

Poppler já existente/pinado fará parse futuro: páginas2–20, trêsnomes fictícios, título/lote1, prefixolistHash, UUID e rótuloAutenticidade numa única página. O rodapé `NAO ASSINADO`/`NÃO ASSINADO` deve estar AUSENTE nesse alvoA1 (diferente do baselineR12). Isso NÃO torna o PDF assinado: classificação continua none.

`pdftoppm` fixo renderizará só a página da referência para `/downloads/reference-page.png` do run, para inspeção visual posterior. Não há decoderQR local; não instalar/baixar. **Não se alega decodeindependente, leitura por câmera nem validação de payload por decoder.**URLsnapshot/UUIDtexto/bitmap são provas distintas; visualização do QR permanece pendente até rootinspecionarbitmap. O código renderizadorf555 pinado é quem usa meta.documentReference.url no encoder. Nenhuma URL será aberta para testar o QR.

## Limites e recibos

DB17.11 localDocker665dc7... sempull em127.0.0.1:55493; Nextproduction em127.0.0.1:31393, bridge/container novosnonce sem volumes/segredosreais. Node20.19.2b964; guard proíbe DNS/fetch/TCPforaDB/TLS/UDP/childprocess arbitrário noapp. Não é isolamentoegress do sistemaoperacional. HOME/TMP/secrets/spool próprios.

Unidade `peticao-r0013-local-pdf-preparation-browser-qa-20261111.service`, CPU2/Mem3GiB/Tasks256/Runtime720s/grace120s/RemainAfterExit; orçamento600s/hook150s. TMPChromeUID0700/canonical/inode/nonce/socketbudget<108, removido apósclose confirmado. Cleanupbrowser exclui baselineNext/Python e confereUID/cgroup/startTicks. Sucesso depende outer0+unidaderetida0+15checksreais+PDFbytes/parse+inventáriosestáveis+guard0+Node/Chromium/cgroupdrenados+Dockerpróprioausente+portasfechadas.

Cookie/config/logsservidor/fixture/browserstdout ficamprivados0600 fora Git/export/e-mail, com scanner de marcadores antes da exportação. PNGs/PDFs exportados contêm apenas a fixture. Screenshotportal mascara inputcódigo vazio; nenhuma solicitaçãoOTP é prevista.

Pendentes: decodeindependente/câmeraQR, reviewvisualbitmap apósensaio, concorrência/recoverymoderno, certificadoA1 e validadorICP reais, destinoSãoPaulo/rollback completo. O teste não toca os draftsunsigned bloqueados e não fecha homologação criptográfica.
