# Qualificação isolada do broker — fase A

Este repositório contém **preparo de código**, não uma instalação nem uma qualificação da VPS. `OPERATION.template.json` permanece com `execute=false`. A fase B global não está autorizada por um resultado A.

## Divisão de trabalho

Infra é o coordenador. Infra fornece cliente, Gate e instalador; Apoio fornece contrato, núcleo sintético, helper e servidor. A fonte do contrato foi congelada no commit `ef8e0784830283d3595c9c2caa25f1e151eefc9d`. A fila, autoridade, admission, tokens, custódia e receipts desta tentativa são exclusivamente sintéticos. Não há alteração da fila operacional, autoridade real, aplicação ou banco de assinaturas.

## Caminhos exatos na VPS Civo

- Código público root: `/opt/peticao-dev-worker-broker-qual-20261115-attempt1`.
- Estado sintético privado: `/mnt/apps/peticao-final/.runtime/civo-worker-broker-qual-20261115-attempt1`.
- Socket privado: `/run/peticao-dev-worker-broker-qual-20261115-attempt1/worker.sock`.

O instalador deve criar somente o destino exclusivo ausente. O pacote tem 23 arquivos: 10 módulos congelados em `runtime/`, 5 módulos congelados em `broker/`, 6 módulos de harness na raiz, `RUN-REQUEST.json` e `readonly-marker`. A marca pública contém exatamente `synthetic public readonly marker\n`. Código e marca devem ser root0644, diretórios públicos root0755. Estado e socketparent são root0700; socket root0600. Nenhum chown/chmod de ancestral compartilhado, serviço global ou unidade persistente é instalado pela fase A.

## Execução separada

O cliente externo tem as fases preflight, install, bootstrap, start, observe e cleanup. O helper remoto admite preflight/bootstrap/start/observe/cleanup e um filho interno fixo `_run`, protegido pela mesma closure, intent exclusivo e execution lock. Este documento não contém comando para executar a tentativa: uma nova operação TEST, revisão independente, janela Root e lease próprio da Infra são necessários.

Preflight verifica versão exata do systemd255, namespace/montagens do PID1, ausência de ambos os diretórios privados e de quatro IDs/unidades/StateDirectory. Qualquer ocupação ou divergência recusa a tentativa. Não existe overwrite nem tentativa automática de recuperação.

## O que a execução A deverá demonstrar

1. Um broker persistente real, socket UNIX real, SO_PEERCRED root e keeper `UnitReferences()` nativo por encarnação. O cliente usa somente `broker_wire.proxy_once`; nunca chama WorkerRPC diretamente para executar trabalho.
2. Três unidades novas: sucesso0, falha7 e cancelamento com dois PIDs no mesmo cgroup. Namespace, limites e isolamento são verificados; falha93 de isolamento não é sucesso da qualificação.
3. Ref real mantida até stop, custódia fsynced e armazenamento físico retido; depois Unref. Trace privado comprova mesmo PID/boot/invocation e held→released. Não há token nos traces/manifestos/resultados.
4. Perda deliberada da resposta de uma única ação retire: enviar uma vez, fechar sem receber e usar somente retirement de leitura com identidade exata. Nenhuma repetição da mutação.
5. Quarto job preparado e cancelado antes de start: sem unidade, binding, backing, bundle ou retirement.
6. Encerrar normalmente a primeira encarnação somente após três refs released; startup real da segunda reconcilia quatro receipts sem rearmar refs antigas.
7. Startup negativo usa uma cópia nova do journal sintético, alterando apenas uma linha para running. Abre um keeper nativo de prova separado, sem listener e sem Ref. Não restaura/rebaixa o floor real ou sintético.
8. Fechar a conexão nativa da segunda encarnação somente quando não há refs held e todos os três backings/receipts estão retained. Provar loss/quarentena reais, duas recusas precisas RetirementUncertain e retirement somente leitura. **Não qualifica recuperação de I/O com referências held.**
9. Kernel EACCES para UID65534 no socket root-privado; nenhuma permissão é afrouxada para testar isso. Inotify do tmp do PID1 permanece sem arquivos/eventos da tentativa; serviços de baseline mantêm os mesmos PIDs/invocations.

Após quarentena sem refs, o runner pode matar somente seu próprio PID2 vinculado por PID/start_ticks/boot e remover somente seu socket device/inode original. Se qualquer prova estiver ausente ou incerta, preserva processos/estado para reconciliação separada. Não mata unidades desconhecidas, não repete mount/unmount/retire e não reassume referências de processo morto.

## Falha parcial e observação

Intents são exclusivos e fsynced antes de subprocessos e mutações. Intent sem receipt de processo é incerto e bloqueia cleanup; ausência de receipt não prova que o processo não nasceu. Start valida o bootstrap e boot antes de gravar intent/log ou chamar Popen. Falhas conservam evidências, registrando somente a classe do erro. Observe não dispara trabalho. Cleanup só aceita uma tentativa integralmente concluída e verificada, sem processos próprios vivos, mantendo os backings/evidências e fechando apenas admission sintético.

## Limites

`NATIVE_BROKER_A_PASS`, se obtido de verdade, terá `scope=isolated-A`, `global_qualified=false` e `live_held_reference_io_recovery_qualified=false`. Não cobre os caminhos globais, socket activation FD3, broker_entry global, serviço/socket global ou transporte operacional. B exigirá lease DEPLOY distinto, baseline, floor/admission reais autorizados, testes nos caminhos globais e qualificação própria. Não fabricar primary, reutilizar PASS A nem publicar metadados globais qualified por causa desta tentativa.

Os testes locais exercitam contratos, guardas, intents, traces e interfaces com fixtures/mocks. Eles não comprovam comportamento nativo de systemd/bus/socket da VPS. Os resultados nativos só existirão após a execução separada pela Infra.
