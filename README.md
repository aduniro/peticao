# DEV: desenho de fencing e recuperação, sem execução

**DESIGN ONLY / NOT DEPLOYABLE.** Não houve stop, promoção, start, chamada SSH de
rede, instalação de guard ou alteração de fila. A transição1→2 dos testes ocorre
somente em dicionários em memória. As funções reais fence_primary.main() e
recovery.promote() NÃO são chamadas/importadas pelos testes; os arquivos em
legacy/ são referências públicas intactas, analisadas por AST/custódia.

Coordenador: Infra, sessão01a1d130-2948-7140-bcfb-34696b20ab8d. Operações futuras
usam o ledger/protocolo canônico existente e uma migration própria; não há
outro coordenador, votante ou mecanismo de eleição neste pacote. Root revisa
qualquer instalação/ensaio/transferência de autoridade em manifesto separado.
São Paulo, K3s, Nome–CPF, aplicação e banco de assinaturas estão fora do escopo.

## Componentes preparados

- contract.py: validação pura da prova viva e da autoridade; ensaio1→2 em memória;
  classificação dos estados parciais das três gravações do legado.
- source_probe.py: leitor futuro Root em Santiago. Só permite systemctl show e
  list-units, leitura de metadados/arquivos/SQLite em modoRO. Nunca executa stop,
  start, promoção, importação de código do coordenador ou comando recebido livre.
- live_verifier.py: adaptador futuro Root em Civo, diretamente executável com
  shebang isolado. Implementa o contrato de nonce da recovery real usando SSH
  pinado. O template entregue impede sua execução operacional. Não há instalador
  nem wrapper que execute fencing/promoção neste repositório.
- OPERATION.template.json e OWNER-CONTROL.template.json: rascunhos incompletos;
  não instalar, não preencher por inferência. O primeiro mantém cutoverfalse e
  sete qualificações ausentes. O segundo é o formato candidato compartilhado
  com o contrato de workers da Infra, nunca uma autorização por si só.
- CURRENT-PASSIVE-REFERENCE.json: referência ao restore real já verificado pela
  Infra, um checkpoint ponto-no-tempo. Não é prova de frescor para cutover.

## Código real e lacunas atuais

As fontes originais estão copiadas, sem alteração, em legacy/, com SHA em
SOURCE-CUSTODY.json. Origem:
/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-legacy-standby-20261114/runtime/.

fence_primary.py suspende/desarma a autoridade antes de parar coordenador e
workers, faz segundo inventário e grava manual-fence.json. Porém sua prova
original verifica ActiveState, não confirma explicitamente MainPID/cgroup, e
não produz o nonce exigido pela recovery. Um arquivo manual-fence antigo é
contexto auditável, não prova viva. O novo leitor acrescenta observações reais;
não reetiqueta JSON antigo com nonce e hora novos.

recovery._promote(): exige standby/suspended e generation==generation-floor;
confere host do checkpoint/geração e intenção verified; cria nonce aleatório em
ADMIN_CLUSTER_FENCE_NONCE; chama verificador externo com timeout30s e exige
nonce/host/geração/método e idade0–60s. Só então grava piso, autoridade primary
armada no boot e recibo. Não inicia serviço. As três gravações são separadas.

O gateway legado deriva papel do hostname e escolhe para Civo o diretório
/srv/admin-v2-coordinator-standby, diferente do restore aprovado em
/srv/admin-v2-coordinator. Há peers/topologia antigos fixados e fence-info aceita
unknown semnonce. Não reutilizar esse RPC como fonte suficiente da nova prova.

O launcher /usr/local/libexec/admin-v2-launch não foi qualificado por esta tarefa;
runtime_profile fixa Node, diretórios e hashes antigos. A atual authority()
não consulta guard externo. O boot_id legado também aceita ADMIN_CLUSTER_BOOT;
os futuros hooks precisam usar /proc/sys/kernel/random/boot_id real e identidade
local confiável, nunca host/boot informados pelo cliente ou ambiente. Exceções
só pertencem a fixtures explícitas. initialize() pode escrever schema antes do loop de
primary. Por isso bootstrap, RPC, dispatch, run, cancel, import/replicação e
qualquer mutação precisam de hooks qualificados ANTES de ativar um primário.
Esta tarefa NÃO escreve esses hooks: a Infra prepara overlay separado para os
módulos legados, evitando duas implementações concorrentes.

## Um guard candidato, alinhado com a Infra

Decisão expressa registrada em DECISIONS.json: controle persistente fora da
árvore restaurável, em /etc/peticao-dev-authority/epoch.json nos dois nós.
Diretório root0755 e arquivo single-link root0644, legível pelo serviço sem
permissão de escrita; todos os ancestrais root-owned, sem group/world write e
sem symlinks. Nada disso foi instalado.

JSON EXATO, sem campos extras:

    {"generation":2,"primary_host":"civo","coordinator_boot_id":"UUID-real-do-Civo","operation_id":"32hex-da-operação-canônica"}

"civo" é ID lógico; o hostname que deve ser observado é "peticao-civo".
Origem lógica "santiago", hostname "sonda-verifica3". A representação canonical
é json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False), SHA256
igual ao contrato de workers633/3046. generation já é o piso; não há outro
campo epoch concorrente. Manifestos de worker vinculam generation,
coordinator_host,coordinator_boot_id,authority_operation_id,epoch_sha256.

Rearmar Santiago na geração1, ou como geração2 sem ser o owner, deve falhar.
Reboot invalida o boot armado e o coordinator_boot_id; não há rearm automático
nem atualização silenciosa do guard. Nova operação revisada é necessária.
Restaurar backup da fila não pode recuar esse arquivo externo.

O guard é materialização de uma operação canônica, NÃO consenso distribuído,
STONITH ou eleição automática. Distribuição qualificada e fencing do primário
antigo são requisitos. O modelo confia nos administradores Root; não impede
um Root malicioso de violar o protocolo ou editar arquivos fora dos programas
qualificados. Se houver partição sem prova positiva, não promover.

## Ordem de uma operação futura, ainda não autorizada aqui

1. Reservar no ledger canônico os recursos de DEV necessários, com revisão e
   ACK reais. Fixar operação, checkpoint/snapshot IDs, SHAs, boot IDs, contas,
   paths, fonte completa e preimages. Manter somente um escritor autorizado.
2. Qualificar overlays/bootstraps/gateway/topologia/launcher/identidades/runtime
   e política de admissão no destino ainda passivo. As sete entradas em
   runtime_qualifications permanecemNone agora; um artefato de teste com PASS
   inventado ou só um booleano não constitui qualificação operacional.
3. Impedir novas admissões por mecanismo previamente qualificado. Atualizar a
   cópia final antes do fencing, mantendo checkpoint e schema/linhas/sequence
   íntegros. O snapshot real já feito é ponto-no-tempo; não provar freshness
   apenas por ter sido copiado com sucesso.
4. Em fase futura explicitamente revisada, executar fencing real da origem pelo
   operador qualificado: suspender/desarmar, parar coordenador e workers e
   comprovar estados. Este pacote não fornece executor dessa fase.
5. Distribuir/observar o guard2/ownerCivo/bootCivo/opID nos dois nós, sem rearmar
   a origem; hooks já qualificados devem impedi-la de voltar a mutar. Root
   precisa provar a distribuição, não apenas escrever um arquivo local.
6. Sob a mesma operação serializada e antes de qualquer promoção, pedir prova
   nova: recovery gera o nonce; verificador o encaminha pela stdin em SSH
   pinado a Santiago. Ler autoridade suspensa/desarmada gen1, boot, recibo,
   guard, código instalado, dois inventários e estados de unidades, MainPID0,
   cgroups-v2 vazios/ausentes e fatos da fila iguais ao checkpoint final.
7. Provar também destino standby/suspended gen1/piso1, boot esperado, arquivo
   do checkpoint com SHA real e ownership, fila coerente e serviços inativos.
   Guard externo2 não equivale à promoção da fila, cujo piso legado ainda é1.
8. Só um executor FUTURO separado e qualificado poderia chamar a promoção real
   gen1→2 após todos os gates e a prova viva. Não há essa chamada aqui.
   Continuar sem serviços/jobs até a etapa própria de ativação ser autorizada
   e ensaiada. Não alterar standby_guard para aceitar primary genericamente;
   a futura unit ativa precisa de contrato próprio.

Se os fatos da origem após fencing diferirem da cópia, abortar a transferência.
Não descartar jobs/events nem rearmar o primário antigo só para satisfazer o
exportador atual, que exige roleprimary. Uma nova captura segura de fonte já
fenced necessitaria helper/escopo/revisão próprios. Jobs gen1 não são reenviados
nem executados automaticamente em gen2; o legado os interrompe por geração.

## Prova viva: dados e limites

Endpoint exclusivo: Root em100.80.18.81:2224, TailnetSantiago. HostKeyAlias
[sonda-verifica3.tail1a6d71.ts.net]:2224 e known_hosts público pinado. Identidade
existente da CivoRoot é consumida apenas pelo programa SSH, nunca lida como
bytes pela implementação. BatchMode, IdentitiesOnly, strict checking, sem
ControlMaster/ControlPath reutilizado, senha, fallback de host ou accept-new.

Executável futuro direto:
/usr/local/libexec/peticao-dev-live-fence-verifier, com bibliotecas públicas em
/opt/peticao-dev-fence e política root600 em
/etc/peticao-dev-fence/operation.json. Não instalar estes caminhos agora. A
recovery só verifica verifier[0] e ancestrais: NÃO usar python seguido de script
livre como contorno. O adaptador checa hashes e ownership dos módulos, política,
host pin e metadados da privada; só SSH abre a privada para autenticação.

A sonda exige pins dos cinco módulos reais de base e da closure adicional
qualificada, no máximo16 módulos limitados. Nunca importa/executa esses módulos
na origem: lê apenas bytes públicos para hashes. Consulta SQLite dev com
mode=ro/query_only e retorna somente contagens/digests, não linhas ou logs;
metadados de cache/SHM do SQLite podem ser acessados pelo próprio SQLite. Não
é promessa de ausência de toda atualização de metadados do filesystem.

O timestamp da origem deve corresponder à janela da requisição com tolerância
máxima5s; RTT máximo20s. verified_at é a recepção local após observar fonte nova,
com timestamp original preservado, não um arquivo velho reembalado. Core ainda
exige0–60s e termina verificador após30s. Hash do checkpoint e leituras locais
precisam ser medidos no ambiente real para caber nesse budget; não foram
medidos aqui. Timeout/clockdivergente/hostoubooterrado/unknown/LivePID/cgroup
ocupado/queuechanged/guardmismatch recusam confirmação. Não inferir provider
powered-off pela falta de SSH; esse método não foi implementado nesta proposta.

## Falhas parciais e recuperação

- Piso1/autoridade1: observar se houve efeito antes de nova decisão.
- Piso2/autoridade1: bloqueio administrativo; nunca decrementar piso para1.
- Autoridade2/piso2 sem recibo correspondente: pode já haver promoção; observar,
  não repetir nem reenviar jobs para obter um recibo conveniente.
- Autoridade2/piso2/recibo2 válido: observar boot/guard/runtime; não iniciar
  serviço automaticamente. Reboot/owner divergente continuam recusados.

Qualquer reconciliação futura necessita nova decisão registrada de Infra/Root,
com autoridade canônica e evidências. Não usar token alheio, force ou renovar
reserva incerta. Não há failback automático; retorno de ownership é outra
operação com geração monotônica e prova própria.

## Validação deste preparo

24 testes locais passaram: nonce/frescor/clock, host/geração/boot, cgroup vazio
ou ocupado em fixtures, origem viva desconhecida recusada, queue/checkpoint,
sete gates obrigatórios, guard canônico compatível, rearm/reboot/opID recusados,
três gravações parciais sem replay e contrato real analisado por AST. Não
executam fence_primary.main(), recovery.promote(), serviços ou SSH de rede.
Não afirmam prova viva real, distribuição do guard, recuperação operacional,
consenso ou cutover. Nenhuma mudança emSP/K3s/NomeCPF/Azure foi realizada.
