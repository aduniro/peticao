# R12 — geração real de PDF pelo runtime, com assinaturas fictícias

Rascunho privado `/mnt/dev/.peticao-r0012-local-pdf-preparation-qa-20261111`. **Não executou app, PostgreSQL, Docker, HTTP, geração ou parsing real de PDF.**19mocksPython+1Node com conteúdo dummy passaram; sintaxe conferida. Necessita revisão independente e nova lease de execução.

Fonte fixa f55595cd348c23ffe559dba2de9150259db9f1e7. Runtime manifesto7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3 reutilizado diretamente de `/mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/runs/af07e86c4964/runtime`, com origemR2 `/mnt/dev/.peticao-r0002-production-profile-20261111/export/runtime`. Inventários integrais antes/depois, sem cópia grande ou alegação de mountRO; não modificar/limpar origens. Qualquer drift encerra/preserva tentativa, sem restaurar cegamente. R6/R9/R10/R11 permanecem intactos.

## O que o seed contém — e não contém

Somente dois usuários fictícios e3assinaturas confirmadas: servidorUNIR/PortoVelho, apoiadorManaus e estrangeiroPT/universidadefictícia. Nomes/e-mails/hashes/códigos/consentimentos são fictícios. `seq` e `verify_code` são definidos para evitar backfill mudar a lista. O TEXT_VERSION é calculado do conteúdo puro f555 pinado, sem importar backend/provedor.

**ZERO lotes, PDF, snapshots de preparo ou versões históricas semeados.**Nenhuma classificaçãoICP/gov.br, certificado, políticaA1 ou prova criptográfica fictícia é criada. O seed consulta as tabelas e exigezero. Os arquivosPDF surgem SOMENTE depois de a rota real criar o documento: uma cópia dos bytes publicados no DB e downloadsHTTP protegidos.

As tabelas/esquemas são inicializados na base fictícia; catálogos estáticos que a aplicação normalmente mantém podem ser inicializados pelo próprio runtime. Não há acesso a banco/pessoas/segredos da produção.

## Dez verificações HTTP planejadas

1. POST `/api/admin/lotes/criar?portal=presidente` semsessão→401.
2. LoginHTTP real da contaTotal fictícia→303/cookieSecureHttpOnlySameSiteStrict.
3. MesmoPOST semstepup→403 e nenhumlote. Step-up então semeado explicitamente, sem homologar desafio por e-mail.
4. GET `/admin/presidente`→200: formulário nativoPOST real “Fechar lote final agora” habilitado e nenhumdocumento.
5. POST vazio na mesmaaction do formulário→303+mensagem“Lote final1criado.”+lote1. É `createBatchForAdmin(final)`/`buildBatchPdf` do runtime compilado, não geração pelo harness.
6. GET `/admin/presidente?lote=1`→200: documentoPDFpronto, link de download e botãofinal desabilitado.
7. GET `/api/admin/lotes/1/pdf`→200, headersPDF/protegidos e bytes iguais ao DB/hashpublicado.
8. GET `/api/admin/lotes/1/versoes`→200: versãooriginalprepared única, ordinal1/autoria1/hash correto.
9. GET da versãoUUID retornada→200 e mesmosbytes do originalgerado.
10. RepetirPOST lógico de fecharfinal→303/NadaaFechar; inspectdepois precisa ser idêntico, sem duplicar lote/preparo/versão ou mudar PDF.

Somente esses métodos/paths são admitidos (além do GETpúblico de readiness). Nenhum endpointcodigo/aprovar/conciliar/upload/A1/assinatura/validador é permitido. O teste da interface nesta fatia é **HTML renderizado pelo servidor**, não clique/hidratação de browser. Browser nativo de criação é etapa posterior separada; não promoverSSR a prova de interação.

## Prova documental e parsing

SQLprivado exige3assinaturas reservadas ao lote1, contagens1/1/1, listHash igual ao SELECTexato pinado e snapshotimutável correspondente; origemadmin/autor1, SIGNERnone, apenas1claimpreparo concluído e leases limpos. PDF publicado com digest correto, statusprepared, semsignedPDF/aprovação/envio; históriaoriginalprepared tem mesmosbytes/hash/lista/autoria1/recordedBy1. Audits batch_created/batch_prepared são únicos e vinculados ao snapshot/ator. Não se declara cadeia de auditoria integral verificada por esses dois eventos.

Poppler existente `/usr/bin/pdfinfo` e `/usr/bin/pdftotext` foi apenas inventariado/pinado nesta preparação. Futura execução fixa semshell, timeout20s/reader e limites de saída: PDF multipágina2–20, títuloPLV12/2026/lote1, presença dos3nomes fictícios, prefixolistHash e rodapébaseline `NAO ASSINADO (teste)`. Esse rodapé é preservado; não se altera políticaA1. Não é assinatura criptográfica. A prova binária compara DB/originalHTTP/históricoHTTP; o harness não re-renderiza um PDF equivalente para comparar.

## Isolamento e encerramento

PostgreSQL17.11 imagemlocal665dc7... sempull; DBsomente127.0.0.1:55492/app127.0.0.1:31392. NovosDockerbridge/container/nonce privados, sem volumes/credenciaisreais. Node20.19.2b964, productionsemPREVIEW, SIGNERnone,MAILdev, **APPROVER_EMAIL e RECIPIENTS vazios**: notifyApprover retorna semtransportar. GOVBR/basevalidation/package/own/reference ficamdesligados. HOME/TMP/secrets/GEO/spool privados, guardNode semDNS/TCPforaDBfixture/fetch/TLS/UDP/processos arbitrários. Isso não é isolamento de egress do sistema operacional.

Unidade `peticao-r0012-local-pdf-preparation-qa-20261111.service`: CPU2/Mem3GiB/Tasks256/Runtime720s/grace120s/RemainAfterExityes, orçamento600s. Preflight mantém reserva2GiB+64MiB e conferebinariesPoppler antesdecriarDB. Sucesso exige outerexit0+unidaderetida0/cgroupdrenado/DBDockerpróprioausente/portasfechadas/guardsemdenial/inventáriosestáveis. Mailjournal/attempt/outbox/batch_sends e spool precisampermanecerzero. Cookies/servidorlogs/logsfixture ficamforaGit/export; PDFs exportados contêm apenas os dadosfictícios desse ensaio.

Pendentes explícitos: clique nativo browser e prévia visual/PDF; recuperação de preparo interrompido e concorrência de criação; homologaçãoA1/gov.br real; validação de destinoSãoPaulo e rollback completo. BaselineR7case5 e outros ensaios são evidências separadas, não substituem esta geração peloHTTP de produção.
