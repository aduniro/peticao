# R6 — rascunho local de histórico autenticado no navegador

PREPARADO PARA REVISÃO, NÃO EXECUTADO. Quinze mocks aprovados; nenhum Node/browser/Docker/PG/app foi iniciado nesta preparação e nenhum sinal real foi enviado. Não é deploy ou prontidão operacional.

Raiz: /mnt/dev/.peticao-r0006-local-history-browser-qa-20261111
Entrada: /mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/functional_smoke.py
Hook: /mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/browser_hook.py
Driver congelado: /mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/history-browser.cjs
Mocks: /mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/mock-proof/result.json

## Proveniência e escopo

Derivado dos arquivos pinados do R4 local cuja prova19HTTP foi concluída pelo root em /mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/r0004-populated-history-http-20261111/receipt.json. O runtime é f55595cd348c23ffe559dba2de9150259db9f1e7; nenhum runtime foi copiado para R6 ainda. A fonte permanece /mnt/dev/.peticao-r0002-production-profile-20261111/export/runtime com manifesto /mnt/dev/.peticao-r0002-production-profile-20261111/export/release-manifest.json. Não depende do stage gerado R4 que foi liberado pelo root.

Driver root5commit4ab6538490be8c2d35bb268a8f619cb86af24808, SHA f405840d45f9529f0442f8b27606d03c4dae18b26670d098119d311b9180b369, copiado byte a byte. Aceita exatamente raiz/unidade R6 pareadas. Node local20.19.2 pinb9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac. Driver confere Chromium instalado SHA481fea1516a1f2b76454664272f12cd9dd1f20117b21e1f1498e08bc7f872c00, sandboxtrue, contexto novo, serviceworkers bloqueados, proxy externo morto e requisições de aplicação somente mesma origem GET/HEAD. São controles cooperativos, sem alegação de isolamento OS completo.

Contexto é LOCAL, unidade peticao-r0006-local-history-browser-qa-20261111.service, sem WorkerContext/NativePG/fila remota. Mantém fixture DockerPG17.11 imagem665dc7..., CPU1/Mem512MiB/tmpfs256MiB, bridge normal exclusiva, publish127.0.0.1:55485; Next127.0.0.1:31385. Controller labels/prefixos R6, CID/NID únicos e cleanup somente próprios. Guarda funcional idêntica ao R4 corrigido para namespace PGDATA real no container; autenticação/Securecookie/CSP/stepup da aplicação permanecem intactos.

## Hook e sessão

Apenas uma chamada adicionada APÓS os19checks HTTP e ANTES de fixture('snapshot') final e cleanup. Servidor Next permanece vivo durante o navegador. Reutiliza a mesma variável cookie do owner obtida no login HTTP real da fixture; o login do leitor usa reader_cookie separado. Não cria login/sessão adicional. Estado step-up continua sendo fixture explicitamente semeada: OTP/email e UI de login não são homologados.

Config /mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/runs/<nonce>/browser-config.json é criada O_EXCL/no-follow0600, com cookie sintético, origem31385, sourcef555, cgroupR6 e dois PDFs da fixture. NÃO é exportada ou versionada. Ambiente do driver é reconstruído com PATH/HOME/TMPDIR/LANG e PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1; não herda NODE_OPTIONS, DATABASE_URL, credenciais ou chaves da aplicação. Node explícito pinado; subprocesso em sessão/grupo próprio, timeout90s sem retry.

Gate exige driverexit0,21checks com nomes/ordem exatos e passed=true, arrays pageErrors/consoleErrors/externalRequestsBlocked/mutationsBlocked vazios, dois GETs explícitos de PDF em ordem2→1, bytes/tamanhos/SHA iguais aos PDFs sintéticos, screenshotPNG. Metadados não devem baixar PDFs automaticamente; Escape devolve foco ao botão Histórico. Não há assinatura/upload/validador/provedor/IA/contatos/fluxo unsigned.

## Limpeza e cancelamento

Baseline dos PIDs próprios do cgroup é capturado antes do browser e preserva Python/Next. Chromium pode criar grupos separados: cleanup verifica UID/cgroup/PID/startticks de todos os novos processos da unidade exclusiva, envia TERM/KILL somente aos novos IDs comprovados e recusa reuso/descendentes desconhecidos. Nunca sinaliza o baseline ou faz limpeza global. Isso comprova drenagem do browser, não drenagem da unidade inteira enquanto Next permanece ativo.

O CancellationState do controlador é passado ao hook. Durante cleanup do browser e escrita de recibos, cleaning=true defere TERM/INT/ALRM repetidos sem interromper a tentativa de limpeza. Os sinais são contados e SEMPRE invalidam exit0; um sinal durante a escrita causa substituição do recibo por falha. O estado anterior é restaurado e falha/cancelamento sobe para o finally externo que continua tentando Node e PostgreSQL independentemente. Os mocks cobrem sucesso, falha, timeout, TERM durante cleanup, INT durante escrita e sinais repetidos; isso ainda não homologa sinais reais do navegador.

## Artefatos e prova externa

Allowlist técnica inclui history-browser-result.json, browser-hook-result.json, history-desktop.png e downloads/browser-version-1.pdf e browser-version-2.pdf além dos artefatos R4. Exclui browser-config.json, logs brutos do driver e qualquer configuração/credencial. Antes de copiar cada artefato, scan recusa os bytes do cookie completo e do token. Não exportar cookie por chat/email/Git/stdout.

outer-result.json após exportação, manifesto/hash, unidade REAL retida e cgroup/dockers drenados continuam gates obrigatórios. Comando proposto está em /mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/EXECUTION-COMMAND.txt e NÃO foi executado. Unidade user CPUQuota200%,MemoryMax3G,TasksMax256,RuntimeMax720,TimeoutStop30,RemainAfterExit=yes; orçamento suave600s inclui navegador90s, com reserva de limpeza120s. Recursos Docker são adicionais aos limites da unidade. Root deve capturar Result/ExecMainCode/ExecMainStatus reais antes de stop; not-found/default0 nunca comprova sucesso.

Revisar código/pins, espaço f_bavail e lease exclusivo antes de qualquer execução. Uma cópia do runtime (~476.5MiB em blocos), preservando2GiB+headroom. Não excluir dados, stages ou originais automaticamente. Se houver falha, preservar rodada e reconciliar IDs/nonce; não tentar outro caminho automaticamente.
