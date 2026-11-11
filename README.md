# R10 — aprovação e conciliação no browser do portal do presidente

Preparação privada em `/mnt/dev/.peticao-r0010-local-package-browser-qa-20261111`. **Não executou browser, app, HTTP, PostgreSQL ou Docker.** Somente mocks/política pura e verificação sintática. Exige revisão independente, lease de execução nova e conferência das portas antes de qualquer ensaio.

Deriva do R9 rev2 aprovado e já executado separadamente; não modifica R9/R6/origens. O driver R6 somenteGET permanece intacto. Novo driver `/mnt/dev/.peticao-r0010-local-package-browser-qa-20261111/package-browser.cjs` permite somente cinco POSTs nativos, em sequência e um por fase:

1. `/api/admin/lotes/1/codigo?portal=presidente`;
2. `/api/admin/lotes/1/aprovar?portal=presidente`;
3. `/api/admin/lotes/2/codigo?portal=presidente`;
4. `/api/admin/lotes/2/aprovar?portal=presidente`;
5. `/api/admin/lotes/2/conciliar?portal=presidente`.

Cada corpo exige campos únicos/tipos/binding exatos. Aprovar exige o OTP privado que o broker acabou de ler; conciliar exige proof exato do hiddenfield. Segunda requisição na mesma fase é bloqueada antes de continuar. Nenhum retry automático após erro ou perda de resposta. Origem, content-type e query `portal=presidente` são fixos. GET somente página selecionada1/2/retornos internos, assets presentes no manifesto e `/api/admin/alertas` (hidratação já observada no R6); nenhum `/api/**` genérico. Criar/cancelar/upload/A1/validação/assinatura própria/contatos/IA não são autorizados.

## Fixture e resultados esperados

Banco NOVO próprio PostgreSQL17.11 (imagem local665dc7..., sempull) em `127.0.0.1:55490`; Nextproduction em `127.0.0.1:31390`. Nova bridge/containerR10/nonce, sem volumes ou credenciais reais. Runtime f555 reutilizado diretamente de `/mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/runs/af07e86c4964/runtime`; origem `/mnt/dev/.peticao-r0002-production-profile-20261111/export/runtime` também inventariada antes/depois contra manifesto7b85. Não é mount somente leitura. Não copiar runtime grande, alterar/limpar origens ou restaurar às cegas se houver drift.

SeedSQL herdado/revisado do R9 com pacotes1/2 novos, dois PDFs sintéticos cada, e classificação criptográfica fictícia estrita apenas no banco do ensaio. Não altera assertSendable/gates; não usa ICP/assinatura/validador real. MAILdev/destinatários@example.test/pepperfictício/segredosvazios. Endpoint de identidade da política é loopbackporta1 e nunca é chamado: guardNode bloqueiafetch/TCPforaDBfixture e listenerforaapp. Não há alegação de egress isolado no sistema operacional.

Login HTTP real de owner fictício uma vez, step-up SQL explicitamente semeado; browser reutiliza essa sessão. Não comprova UI de login nem desafio por e-mail. Cookie Secure/HttpOnly/SameSiteStrict, sandboxChromium e CSP não são afrouxados. Chromium145 binSHA481fea..., flags/proxyfailclosed herdados do R6; TMPcurto próprio em `/run/user/<UID>/r10-<nonce>-...`, UID0700/canonical/inode/nonce/budgetAF_UNIX<108, removido somente após browser.close confirmado.

Happy: clicar código, ler exatamente um spool privado novo, preencher e clicaraprovar uma vez;303/retorno e mensagem acompanhados. Exigir status visual `Aceite registrado` e comprovante `Aceito pelo transporte`.

Falha: triggerSQL apenas no lote2 instalada antes do browser. Após aprovar, portal303 deve mostrar mensagem de conferência, enquanto SQL prova acceptedjournal e ausência de recipient2. Driver emite apenas evento fixo `browser-fault-ready.json`; hook verifica nonce/source/estado, remove SOMENTE esse trigger e respondeACK privado fixo. Então clicar `Conferir aceites sem reenviar`; exigir mensagem de não repetição e status visualaceito. Arquivos de spool e contagens de mailjournal/attempts/outbox antes/depois da conciliação precisam ser idênticos.

Depois do browser: SQL exige ambosstatussent/sent_at/nocodehash e1recipientokcada; exatamente4mensagens/4attempts/0outbox/2batch_sends e4spoolsdev (2OTP+2pacotes). Archivefictício decifrado somente compepperfictício compara os dois buffers de cada envelope às fixtures; exporta sóhashes/booleans. Fingerprints dos bytes PDF/signed e versões/package/base/validação/seleção antes/final devem ser iguais. Browsernãoexibe updated; número2 já foi validado em R9 e não será alegado como textoUI. Replaybrowser não está incluído nestes5POSTs: prova de replay pertence aoR9.

## Privacidade, limites e encerramento

OTP/cookie/proof ficam privados0600 e emmemória; nunca corpoHTTP, stdout/stderr, trace/HAR/vídeo, export ou e-mail. Screenshots somente APÓS redirect/inputvazio (ouausente), com inputcódigo mascarado. Config/browserlogs/serverlogs/spool/markers ficam fora da allowlist. Scanner de marcadores verifica cada export. PNGs finais mostram só dadosfictícios.

Unidade fixa `peticao-r0010-local-package-browser-qa-20261111.service`, CPU2/Mem3GiB/Tasks256, RuntimeMax720s, orçamento600s, grace120s, RemainAfterExit=yes. Hookbrowser150s; um subprocesso fixo pinado, sem appenv no driver. Cleanup porUID/cgroup/startTicks exclui baselineNext/Python; nenhuma limpeza de processos/containers alheios. Cancelamento durante cleanup/export forçafalha e preserva evidência; resultadointerno0 não basta. Coletor precisa outerexit0+unidaderetida0+18checks exatos+guardsemdenial+browser/node/cgroupdrenados+Dockerpróprioausente+portasfechadas+inventáriosestáveis.

Preparação:11testesNode de política (semPlaywright/Chrome) e18mocksPython passaram; inclui nove regressões herdadas de estado/bytes doR9, sem reexecutar app. Não representa18checks reais de browser.

Pendentes explícitos: expiração/cincoerros/indeterminateHTTP, browserreplay/concorrência, mudança deconfiggates, ICP/certificado/validadorreal, entregaOTP/email, produçãoSP. R9/provasanteriores continuam separadas. Roteiro: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/approval-otp-reconciliation-audit-20261111/BROWSER-NEXT.md`.
