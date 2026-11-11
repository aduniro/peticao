# R0003: adaptador privado para a fila existente

**Draft local, não integrado, não instalado e não submetido.** Não é um coordenador, serviço, executor genérico ou endpoint novo. Não houve SSH, PostgreSQL real, aplicação real, merge ou deploy. As fixtures criam somente arquivos fictícios e mockam Popen/sinais/relógio; não iniciam o harness da aplicação.

Raiz local: `/mnt/apps/peticao-final/_ops/r0003-queue-adapter-20261111`.

O único módulo implementado é `/mnt/apps/peticao-final/_ops/r0003-queue-adapter-20261111/core/route_gates_profile.py`. O código compartilhado em coordinator.py e launch.py NÃO foi alterado. A frente do vigia permanece dona daqueles arquivos.

## Contrato fixo

- Kind: `govbr-route-gates-native-pg17-r0003-v1`.
- Fonte QA: `93557bfba931f8f731807fc9f30f1d88dbafedf1`; backend integrado: `f55595cd348c23ffe559dba2de9150259db9f1e7`.
- RPC de submissão aceita EXATAMENTE action/id/kind/source_commit, com action=submit e ID32hex. Campo extra, incluindo env/command/project_subdir/path/URL/port/timeout, é rejeitado.
- Normalização interna exata: `{kind,source_commit,project_subdir:'site'}`. Coincide com WorkerContext do harness58cb9ce.
- A admissão e as propriedades do launcher são funções puras: não tentam ler o STAGE0700 do worker, segredos, banco, rede ou executáveis.
- O wrapper worker fixa externamente o manifesto `c6067a99b306b5e2675d7122857567f4348c7de0792f2b2b696b6f01ab042351`, os10 arquivos, registry integral, cinco inputs de fonte/deps/manifesto e os binários Node/PG. O manifesto não pode se autorizar com pins modificados.
- Executa somente `/usr/bin/python3 /srv/admin-v2-worker/admin-r0003-route-gates-20261111/run.py UUID32HEX`, com ambiente Python limpo e sem bytecode/cache no STAGE. O próprio harness monta env fictício de aplicação.
- NativePG continua em127.0.0.1:55487, sem novos listeners, contas, portas de worker, shell, sudo, Docker ou ambiente arbitrário.

## Fencing e recuperação

Antes dos efeitos, o worker confere UIDvigia-worker não root, authority primary/boot/geração, config ID/payload/digest, state ID/running/boot/geração, execution.started, PID/startticks/UID/cgroup do controller e do wrapper e limites efetivos do cgroup. A geração/identidade é reconferida antes do claim, antes da execução, durante a espera e após a prova/hash.

O marker extra `route-gates-profile.started` usa criação exclusiva e permanece após perda do processo. A repetição do mesmo ID não executa o harness novamente. `reconcile(ID)` lê apenas o mesmo marker/recibo; não apaga estado nem reinicia atividade. A fila existente conserva UUID, geração, eventos, reconciliação e autoridade única.

Recursos futuros fixos: CPUQuota200%,MemoryMax3G,MemorySwapMax0,TasksMax256,RuntimeMaxSec600 e TimeoutStopSec120, KillMode control-group. Orçamento600s execução+120s limpeza=720s. O wrapper só envia SIGTERM ao PID do seu harness após reconferir identidade; em incerteza/timeout não sinaliza descendentes arbitrários. O launcher existente deve drenar SOMENTE aquela unidade no fim do grace. Sem alegação de sandbox OS contra código malicioso.

## Gates obrigatórios de conclusão

Não basta um result.json com exit0. O wrapper exige exit externo do harness0, exportação atômica completa com9 recibos técnicos e manifesto de hashes, contexto correto, exatamente5 callbacks TAP admitidas sem falhas/cancelamentos/extras, guard no Node pai e único filho, contadores calculados novamente a partir do log bruto, nenhuma negação inesperada, handshake PG17.11 com nonce/datadir/porta próprios, binários atestados, lifecycle/stop/socket completos e fonte/deps estáveis.

O wrapper revalida byte a byte os inputs/STAGE/runtime compartilhado após a execução. Antes de retornar, todos os outros PIDs devem ter saído do cgroup, exceto os2 controllers verificados (worker da fila e este wrapper). O gate posterior `qualify_collected(folder, outer_exit)` deve ser chamado pelo próprio PID do worker da fila: exige exit externo do wrapper0, marker/recibo consistente, manifestos/hash novamente conferidos e só o controller existente restante no cgroup. Arquivos extras, exports parciais, PIDs residuais e contextos antigos falham, mesmo com result interno0.

O coletor genérico existente continua copiando os arquivos; o novo módulo apenas qualifica o resultado desse coletor. As únicas entradas esperadas em `job/artifacts` são `route-gates-profile.json` e a subpasta `govbr-route-gates`. A privacidade de PGDATA/fonte/deps/segredos é herdada da allowlist do harness; o adaptador não copia esses dados.

## Duas importações e três ramos de adaptação futuros

**Não foram feitos neste draft.** A aplicação futura exige revisão/ACK pelo responsável da fila:

Importações (2): `import route_gates_profile` no coordinator.py existente e no launch.py existente, usando o mesmo diretório de módulos confiáveis da instalação. O módulo não lê caminhos privados durante import.

Ramos de adaptação (3 áreas, com os call sites explícitos):

1. **Admissão/despacho no coordinator.py:** incluir KIND no conjunto conhecido; em submit chamar payload(data); em commands(payload,job) retornar argv(job). A fila e o digest continuam sendo os originais. Não usar o ramo genérico npmci/test/build.
2. **Worker/conclusão no coordinator.py:** incluir KIND na lista de perfis fixos que pulam a cópia genérica da fonte; manter work/home/marker/state existentes; após wait do wrapper e a coleta genérica, chamar qualify_collected(folder,code) antes de marcar completed. Uma exceção desse gate precisa produzir failed/uncertain, preservando evidência e nunca reexecutando automaticamente.
3. **Limites no launch.py:** reconhecer KIND e aplicar exatamente launcher_properties(), sem alterar o SSH administrativo, autoridade, marker de unidade existente ou o perfil de outra frente. A promoção de coordenação e o cancelamento continuam pelos mecanismos existentes.

São três áreas de adaptação, não a promessa de um único if por área. Não há patch que edite arquivos de outro autor; este README registra os pontos para integração coordenada posterior.

## Caminhos remotos: somente proposta, nenhum staging atestado

Harness proposto: `/srv/admin-v2-worker/admin-r0003-route-gates-20261111`.

Input runtime comum proposto com a frente de histórico: `/srv/admin-v2-worker/admin-r0002-runtime-qa-20261111/inputs/runtime.tar`, SHA2952a2b0d7ffb06b553caa03fdb3d8546981a96118a1cc9aa0ca47da4adc8ee0. Manifesto irmão release-manifest.json SHA7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3. Somente o artefato LOCAL está comprovado. Não afirmar que existe na VPS. O staging remoto deverá ter recibo RO, dono/modos/pins e ACK antes de qualquer execução, sem duplicar475MB.

A instalação futura também precisa reservar janela pesada única, validar espaço livre/porta55487 e confirmar o gate do launcher/coletor. Nada disso foi executado. Testes reais R3 continuam0, e não há homologação A1/gov.br/produção.

## Reproduzir apenas mocks locais

`/usr/bin/python3 /mnt/apps/peticao-final/_ops/r0003-queue-adapter-20261111/validate_draft.py`

Esse comando executa somente as fixtures desta pasta e grava stdout/stderr/result em artifacts. Não executa run(), CLI do harness, PostgreSQL ou SSH fora dos mocks controlados.
