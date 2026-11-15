# Hooks candidatos de autoridade para o legado

**SOURCE ONLY / NOT DEPLOYABLE.** Nenhum arquivo instalado, serviço, fila real,
permissão, listener, chave ou máquina foi alterado. Santiago segue primário;
Civo continua réplica passiva. Este candidato não libera cutover.

`SOURCE-CUSTODY.json` fixa os oito módulos do staging2976 e a cópia EXATA de
remote_contract.py da fonte3046. `upstream/` conserva os originais; `runtime/`
contém os candidatos. O guard é o mesmo EpochGuard do contrato dos workers,
sem outro schema paralelo ou nova autoridade/ator de votação.

## Mudanças concretas

* `coordinator.authority()` só retorna effective_role=primary quando o controle
  root-owned fora da fila coincide com geração, máquina, boot e operação.
  Autoridades antigas sem os novos campos ficam suspensas. O boot vem somente
  de /proc; ADMIN_CLUSTER_BOOT e HOSTNAME do ambiente não substituem identidade.
  Os únicos hosts coordenadores candidatos são peticao-civo e sonda-verifica3,
  mapeados para os IDs lógicos civo/santiago; host desconhecido é recusado.
* `initialize`, submit, dispatch, run, cancel, import-source e snapshot não podem
  iniciar trabalho/escrever inicialização sob autoridade passiva ou revogada.
  RPC de leitura exige fila existente e não inicializa um banco acidentalmente.
  O daemon encerra o laço se perder autoridade, em vez de continuar heartbeat.
  Isto não substitui parar/provar a unit e os executores na operação de fencing.
* `recovery._promote()` mantém os requisitos legados de nonce, verificador
  root-owned e frescor. DEPOIS da resposta válida e ANTES das escritas, vincula
  o novo primário ao controle persistente e à identidade devolvida pelo verifier.
  A identidade é gravada junto à autoridade nova. É um fluxo administrativo:
  standby gen1 com controle preparado gen2 NÃO precisa passar require_primary
  antes da promoção. A guarda exata da confirmação segue o contrato do Apoio629.
* `rearmed_copy()` só calcula um JSON em memória para um operador root, com nova
  operação canônica e controle já preparado para o boot atual. Não há CLI/RPC,
  atualização de /etc, escrita de authority.json ou atalho para rearm standby.
* Gateway e replicação legados são recusados antes de ler o request, snapshot,
  lock ou transporte: ainda carregam topologia de Santiago/São Paulo. Não se
  habilita tráfego com esse endereço antigo na Civo. São gates deliberados;
  copiar estes candidatos para produção agora quebraria funcionalidades.

O campo de geração em /etc/peticao-dev-authority/epoch.json é um piso persistente
fora dos checkpoints da fila. Schema exato: generation, primary_host,
coordinator_boot_id, operation_id. Root controla todos os ancestrais e o arquivo;
serviços leem sem escrever. Permissões candidatas: parent0755/file0644.
As autoridades recebem coordinator_host, authority_operation_id e epoch_sha256.
Esses campos extras não são uma autorização por si só: precisam coincidir com
o controle root-owned, o host local real e o boot atual.

## Ordem e bloqueios que permanecem

A leitura local desse arquivo NÃO fornece consenso nem promoção atômica entre
hosts. Antes de mudar a época: fechar admissão, parar/cercar todos os launchers
e jobs antigos, provar quiescência, produzir o checkpoint final consistente,
distribuir o controle protegido e conferir a prova viva. Só então pode haver
promoção, rearm e início coordenado do novo serviço. Não reiniciar tarefas
incertas nem restaurar o piso de /etc a partir do arquivo antigo da fila.

Estas mudanças não são um instalador. O pacote ainda NÃO inclui:

1. Transação operacional de instalação, distribuição durável do controle,
   preparação dos campos atuais, boot/rearm real, shutdown/fencing e rollback.
   Instalar só parte dos imports/arquivos deixaria o serviço indisponível.
2. Root launcher e bootstrap systemd qualificados. Guardar run() não cerca,
   por si só, um launcher antigo que crie um processo após a troca de época.
   Todos devem estar parados e a admissão fechada antes da troca do controle.
3. Gateway autenticado/SSH/RPC com nova topologia e replicação para destino
   aprovado. O candidato bloqueia os caminhos antigos, não os substitui.
4. Backend remoto integrado, reconciliação dos recibos, finalização/exportação
   e cancelamento de cgroup, nem prova de jobs reais ou Dell desligado.
5. Ensaio de promoção/restart/failback real. Qualificação do verifier629,
   floor root→usuário de serviço, imports root-owned/env-i e relação dos hashes
   com o manifesto final precisam de operação própria e revisão independente.

Não muda produção São Paulo, validação Nome–CPF, A1, e-digger ou sessões Codex.
Não há segundo Kubernetes, GPU, novo recurso cloud ou relaxamento de auth.

## Testes

`python3 -m unittest -v` executa somente fixtures privadas neste diretório.
30 testes cobrem a integração do código legado com o mesmo guard, recusas antes
de marcadores de execução/escritas, RPC readonly sem inicialização, daemon
revogado, ambiente adulterado, rearm, vínculo de promoção e preservação das
checagens de nonce/frescor. A promoção positiva escreve SOMENTE um diretório
fictício, com resposta de verifier simulada; não é prova de fencing vivo/SSH.
Os testes injetam explicitamente validador UID1000 no guard de fixture; o
default de produção continua root_control_file. Não alegam isolamento systemd
ou permissão real de serviço por usar mocks. Logs privados preservam resultados.
