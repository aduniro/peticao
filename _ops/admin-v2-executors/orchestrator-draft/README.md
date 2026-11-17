# Coordenação local de executores do admin-v2

Camada **local e revisável**, separada do aplicativo. Repositório: `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft`, branch `ops/executors-draft`.

Decisão: **coordenação lógica local; integração e build centralizados em Santiago; São Paulo somente leitura inicialmente**. Código e commits podem circular entre clones de trabalho autorizados após o handoff. Isso não autoriza usar o clone/banco da produção, publicar, editar main/master ou ativar executores sem READY.

Protocolo do projeto: `/mnt/apps/peticao-final/peticao/docs/PROTOCOLO-EXECUTORES-ADMIN-V2-20261110.md`.

## Estado desta entrega

- Contratos, fila persistente e CLI implementados em Python stdlib.
- Configuração entregue com `execution_enabled=false`, Santiago desativado e identidades de máquina pendentes.
- Não existe runner remoto, dispatcher de rede, SSH, worker instalado ou daemon neste projeto.
- Nenhum job real foi enfileirado, transferido ou executado. O primeiro job de qualificação continua um plano.
- Transporte Git e integração são APIs locais separadas, com `execute=False` por padrão; os testes usam somente repositórios fictícios em diretórios temporários.
- Não há comando shell universal, prompt automático para outra sessão ou tipo de job de mensagens. Não há retry automático de POST ou de job expirado.

## Arquivos e responsabilidades

| Arquivo | Responsabilidade |
|---|---|
| `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/protocol.py` | Schema fechado, funções/roles/branches/paths permitidos, runtime/Node20.19.2/Next14.2.35, fontes, READY e resultados |
| `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/admin_exec/queue.py` | SQLite local, UUID, idempotência por intenção, CAS de versão, claim/start distintos, lease/heartbeat, timeout, resultado e recibo revalidado |
| `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/cli.py` | Status, validação e planos sem efeitos por padrão; `--apply-local` grava apenas metadados locais |
| `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/git_transport.py` | Inspeção, bundles entre clones independentes e gates de identidade/paths/refs; nenhum SSH |
| `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/integration.py` | Preparação de integração isolada, conflitos explícitos e promoção CAS de branch de integração após recibo verificável |
| `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/config.json` | Políticas e limites; permanece desativada |

O pacote se chama `admin_exec` para não substituir o módulo `queue` da biblioteca padrão do Python. Nenhum arquivo do candidato foi importado ou alterado por esta implementação.

## Comandos seguros de revisão

Diretório de execução: `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft`.

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/cli.py status
/usr/bin/python3 /mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/cli.py validate --job /mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/examples/qualification-job.json
/usr/bin/python3 /mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/cli.py enqueue --job /mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/examples/qualification-job.json
```

O último comando é **dry-run** e não cria a fila. `validate` comprova somente o contrato: `provenance_verified=false`. O exemplo contém identidades de fonte fictícias e não é um job aprovado. O plano em `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/examples/qualification-plan.json` registra a referência observada, não uma transferência autorizada em curso.

Para testes fictícios locais, executar no diretório indicado:

```bash
/usr/bin/python3 -m unittest discover -s tests -v
```

Não executar `--apply-local`, editar a ativação ou iniciar worker só por seguir este README. A CLI não oferece um modo de executar código remoto; esses passos continuam no handoff com a sessão de infraestrutura.

## Fluxo da fila

1. `validate_job` produz `JobSpec` imutável/canônico, com digest do payload e da intenção de execução. Fonte identifica commit exato, manifestos, wrapper e lockfile; branch é uma referência permitida, sem substituir o commit.
2. `Queue.enqueue(spec)` é idempotente: reentrega da mesma intenção/payload retorna o estado existente. Mesma intenção com parâmetros diferentes é conflito. A operação só grava metadados locais.
3. `register_ready` registra uma declaração de Santiago vinculada a host, papel, root, máquina, versões, configuração e validade. **A fila não verifica a máquina remota pela rede**. O gate de Git compara a máquina física local onde está executando com a identidade aprovada. READY de São Paulo é proibido; READY do coordenador pode ser validado para transporte local, mas não o torna worker da fila.
4. `claim` exige execução habilitada, identidade configurada, READY vigente, versão exata e nenhum job ativo/incerto no worker. A reserva tem UUID e generation. Claim não significa execução iniciada.
5. `start` registra processo próprio reportado pelo worker; `heartbeat` exige claim/generation/versão, lease vigente e mensagem UUID. Mensagens repetidas não prolongam lease nem incrementam versão. Status identifica o que foi reportado, não um processo remoto observado por esta camada.
6. Lease ou tempo total expirado vira `uncertain`, inclusive se a expiração ocorrer durante validação dos artefatos. Leitura de status já mostra o estado efetivo incerto, sem escrever no banco. Não há requeue automático nem nova generation após incerteza.
7. `finish` exige execução reportada, papel/READY/lease atuais, resultado ligado ao job e artefatos existentes com SHA e tamanho reais. Commit/buildCommit, Node, lockfile, wrapper, fonte/runtime e cobertura devem corresponder ao contrato. Falha não gera recibo de conclusão.
8. `completed_receipt(job_id)` relê o estado persistido e revalida os arquivos. Não aceita um recibo JSON arbitrário. Resultado concluído significa **job encerrado e aguardando revisão**, não software homologado nem autorização de merge/deploy.

A incerteza bloqueia o executor até reconciliação humana com evidências. Esta versão não implementa requeue/resolução automática nem inspeção remota do PID. Não alterar SQLite à mão para contornar o bloqueio.

## Transporte e integração

APIs separadas, sem CLI que execute transporte automaticamente:

- `RepositoryPolicy.from_config(config, host_id)` e `ready_proof(record, config)`.
- `export_bundle(..., execute=False)` / `import_bundle(..., execute=False)` inspecionam e planejam por padrão. Transferência entre hosts não está implementada; bundles são arquivos locais nesta camada.
- `integration.prepare(..., execute=False)` revisa a integração; execução autorizada futura usa uma branch temporária de trabalho e registra conflitos. Não escolhe “a versão mais recente de cada arquivo”.
- `integration.promote(..., queue, job_id, execute=False)` depende de `Queue.completed_receipt` e provas do commit integrado exato, não de um booleano `passed` recebido.

Branches permitidas: `worker/admin-v2-*`, `review/admin-v2-*` e `integration/admin-v2-*`. Main/master, produção e deploy são proibidos. Paths reais do aplicativo/banco estão bloqueados por regra fixa, além da configuração; um alias ou symlink para esses paths também é rejeitado. A checagem física do host e o update-ref CAS não substituem revisão semântica dos formulários, backend e contratos compartilhados.

Manifesto de fontes Git: mapa de todos os caminhos rastreados com modo e SHA do blob. Isso mantém symlinks e executáveis visíveis na revisão. O bundle e cada artefato também têm digest próprio. O clone de origem/destino precisa ser independente e limpo; não copiar worktrees ou dependências com referências locais.

## Ambiente, limites e provas

Somente jobs `qualification_delivery` e `qa_history_metadata` estão permitidos. Ambiente tem nomes/valores explícitos e dev-only; chaves reais, certificados A1 e endereços de produção não são parâmetros aceitos. Os wrappers originais continuam responsáveis pela configuração QA vazia, dados fictícios, portas próprias, rede externa bloqueada, manifestos202ativos e cleanup. Não relaxar os paths/guards originais para adaptar uma VPS.

CPU/memória/tempo declarados são limites de contrato; **cgroups/containers e supervisão remota ainda não foram instalados**. Caches, build, PGDATA, temporários e artefatos precisam ser próprios por host/job. A configuração atual permite um job por vez, sem disputar produção. O primeiro job medirá compatibilidade e desempenho; não há promessa de ganho em percentual ou horas.

O estado SQLite e artefatos ficam em `var/`, ignorado pelo Git e sem criação em status/dry-run. Arquivos de estado são 0600 e diretórios 0700. Um SQLite existente precisa ter o application_id desta fila; diretório já existente compartilhado ou banco alheio é rejeitado sem alterar permissões/tabelas. Logs/eventos registram apenas metadados do job; não exportam variáveis completas, mensagens ou dados pessoais reais.

## Handoff com infraestrutura

A outra sessão permanece dona da configuração de Santiago/Tailnet. Ela não deve editar o admin-v2 ou a branch principal. Entregar READY e inventário; o coordenador termina a coorte ativa, escolhe commit e manifestos realmente congelados e verifica a identidade/orçamento. Só então se decide a ativação e o transporte dentro da autorização existente. São Paulo permanece somente leitura nesta fase; não é um segundo executor ativo.

A página pública consolidada no commit `1e656d76467d8a86cc7de24b53b015f406769d27` já é ancestral do candidato observado; futuras edições dos formulários precisam de branch/contratos e revisão de diferenças, sem merge redundante da mesma base.
