# Civo: QA canônico completo em namespace isolado

QAROOT /mnt/apps/peticao-final/.qt1, unidade peticao-civo-c472-complete-qa-20261114.service, usuário civo. Não existe ainda no host conforme consulta inicial. Esta fonte prepara e executa apenas QA do appc472; sem produção, dados reais, recursoscloudnovos, jobsgerais ou cutover.

Insumos: export Civo verificadoSHA3f2cbe26026cee736f146bf64548a9c4cc81153e585d1c0da457b9c35936930f, fontecanônica19db95.../lock529636..., dependências públicas eNode20.19.2retidos. Runtime e fonte clonados sobraiznova, imutabilidade verificada por manifests/SHAantes/depois. Nenhum bytecompilado é reescrito.

Roteiros canônicos preservam assertions por substituições estritas de paths/ports: oito arquivosbackend43, HTTPsmoke7, browser40, mapasreais2, HTTPreset8porúltimo, refreshdetokenfictíciosóarquivo0600. Total esperado100checks. Respostasexplorer controladas do browser40 são parte dos casos canônicos; mapas usam APIreal com22registros fictícios. Não se alteram critérios para obterPASS.

Python3.12 venvnovo, quatro wheels oficiais PyPI com versões eSHAfixos; pipoffline --no-index --no-deps --require-hashes. PythonPlaywright1.62.0 traz Chromiumrev1234/151.0.7922.34, igual ao browser existente. SemAPT, semnovo browserdownload, semauth. Node20boundapenas/usr/local/bin/node naunidade; hostNode22inalterado. PLAYWRIGHT_NODEJS_PATH explicita Node20 também no driverPython.

4CPU/8GiB/256tasks/2700s,PrivateNetwork,ProtectHometmpfs+tmpfsro/home/root/runuser/tmp,NoNewPriv/caps0,Docker/Tailscalemasked. Raiz e runtime/source/venv/inputs/deps/ChromiumRO; somente dirsarquivosnovos fictícios específicosRW. Namespacepreflightagregado antes dePG/Next/browser verifica leituras, escritas sópathsnovos,Node20,loopback/caps/máscaras e custódia.

PG18fictício54524 eNext3184 apenasloopback dentrodaunidade. Cookies efixture nunca stdout/copiados àprova pública; driver produzsomentecontagens/flags. Logs detalhados permanecemprivados. TMPDIR/profileHOME/XDG sobprefixocurto.qt1 para limiteIPCUnix. BrowserChromeNativo usa parâmetros dos roteiroscanônicos dentro doisolamentoSO; redeexterna bloqueada. Falhas demapas não são substituídas ou ignoradas.

Caller próprio exige TESTApoio+manifesto imutável+RootACK+hashclosure. start precisa>3100s restantes para2700stimeout+transporte;capacidade própria renovadaantesexpirar. Journalsbloqueiamrepeatincerto;STATE eartifacts preservados. stop somenteestaunidade eprova cgroupsemfilhos; nenhuma outraPG/Next alterada.

Faseslocalcaller: stage,prepare(remotosetup),start,status,evidence,stop. NãoexecutarantesdeRootreview eprópriareserva. Aindanenhumsetup/QAremotoexecutado.

Fontesoficiaisdependências: https://pypi.org/project/playwright/1.62.0/ e https://playwright.dev/python/docs/library .
