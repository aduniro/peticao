# Revisão estática curta do alias de namespace V2

Parecer SOURCE ONLY em 15/11/2026: **sem bloqueio técnico concreto no delta examinado**. A V1 congelada3303/32cce86 não foi alterada por esta revisão. A única escrita do revisor é este relatório; não houve execução de testes, host, mount, app, PG, browser, instalação, commit ou ledger.

## Delta e compatibilidade

Em `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-v2-20261115/source/driver.py:25`, o único alias novo é `/run/peticao-dev-work`. Em `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-v2-20261115/source/driver.py:115`, approved_workdir aceita esse caminho ou os dois shapes antigos de StateDirectory com ID hex32 e geração positiva. Não adiciona parâmetro de CLI/RPC, escolha de caminho pelo job, mount, chown, diretório de armazenamento ou recuperação de tentativa.

Em `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-v2-20261115/source/driver.py:129`, job_root continua exigindo UID não-root, diretório próprio0700, CapEff zero, NoNewPrivs e raiz nova (somente tmp inicial vazio permitido). Contexto e caminhos mutáveis continuam relativos ao mesmo job. A comparação de driver.py com a V1 mostrou somente a constante, a função approved_workdir e a substituição da condição antiga por essa função.

Os testes de `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-v2-20261115/source/test_namespace_alias.py:11` cobrem caminhos aceitos/recusados, previsão sem IO e recusa dos nomes antigos longos para QA. A previsão declarada é94 bytes para tmp e67 para home, ambos abaixo de108. É orçamento estático conservador, não evidência de Chromium/IPC executado. O coordenador informou13 testes afetados PASS/0,102s; não os repeti nem repeti a suíte V1 de198 testes.

## Responsabilidades que permanecem externas

A aceitação de `/run/peticao-dev-work` pelo driver **não prova** namespace privado, montagem, identidade de filesystem, propriedade física, stop/cgroup, custódia ou retirement. Cabe ao sucessor Root da Infra criar/qualificar o `/run` privado e provar o binding do alias ao MESMO StateDirectory/project backing da identidade atual (incluindo inode/dev/mount e lifecycle aplicáveis). O alias não autoriza novo backing storage, um caminho do host compartilhado ou relaxamento de cleanup. Uma pasta homônima0700 não substitui essa prova Root.

qualified/operationalReady continuam false. O driver não cria ou verifica por conta própria o bind; essa divisão está explícita na docstring atual. Permanecem necessários review/pins do sucessor runtime, manifesto e liberação próprios, bindings reais e qualificação nativa autorizada. Nada desta revisão é evidência operacional ou ACK de instalação.

Documentação V2 conferida em `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-v2-20261115/source/README.md`: a seção Sucessor V2 descreve alias94/67, V1 preservada e responsabilidade da Infra Root. A frase herdada da seção de forecast V1 sobre nenhum alias/bind adicionado foi apontada ao coordenador, que ajustará para nenhum alias/bind INSTALADO/EXECUTADO, distinguindo fonte de host. É ajuste editorial sem bloqueio técnico do delta.
