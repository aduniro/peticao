# Vigia

## Continuidade supervisionada

A fila com dependências, checkpoints, verificações independentes e detector de
paralisação está descrita em [VIGIA-CONTINUIDADE.md](../../docs/VIGIA-CONTINUIDADE.md).
O temporizador local `peticao-monitor-watchdog.timer` verifica atividade a cada
minuto. A supervisão é habilitada por tarefa com `vigia supervisionar ID` e não
repete comandos shell interrompidos nem autoriza deploy.

## Painel com abas

Execute **`vigia`** ou `/mnt/dev/peticao/vigia`. A instalação registra o alias em `/home/barre/.bash_aliases` e o executável em `/home/barre/.local/bin/vigia`, preservando cópia do arquivo anterior.

- **Tarefas:** filtre em andamento/concluídas; selecione com mouse ou setas. Crie/edite tarefa e etapas/subetapas, estados, peso, contexto e estimativa. A árvore calcula a porcentagem pelas folhas concluídas, sem contar o grupo duas vezes. Sem plano não há porcentagem inventada. O tempo da tarefa conta desde sua criação; etapas mostram os tempos realmente registrados.
- **Processos / VPS:** processos observados, diretório/porta, CPU/RAM quando disponíveis, duração e serviços. “Sem terminal” descreve a sessão do processo, não prova trabalho ativo de um agente.
- **Git:** branches/remotos, worktrees, grafo real de commits/merges, arquivos e diffs. Selecione uma branch para seus commits, depois um commit/arquivo. Um diff local selecionado acompanha versões novas do arquivo. Forks externos só seriam consultáveis com uma fonte de hospedagem conectada; não são inventados a partir de nomes de branches. Nenhum commit/rebase/deploy ocorre pela aba de observação.
- **Prompt / execução:** **F2** abre o prompt da tarefa. Escolha IA local, IA na VPS, shell local ou job SSH de adunir, confira o diretório e envie. **Ctrl+Enter** ou **Enviar** registra o pedido. Conversas são independentes por tarefa/host; texto ainda não enviado é preservado entre tarefas enquanto a tela está aberta. IA e shell têm controles distintos para direcionamento ou entrada. Pausa/retomada/interrupção valem somente para execuções criadas pelo Vigia; não injeta comandos em processos observados de terceiros.
- **Aprovações:** ação, execução e payload vinculados ao pedido do Codex, decisão única com validade de 20 minutos. Aceite é para aquela ação; não concede autorização permanente. A seleção por teclado e o botão usam o mesmo pedido visível.
- **Eventos / testes:** histórico filtrável, falhas e códigos de saída. Selecione um evento e abra a execução para ler a saída/stack do comando. Agentes também podem registrar resultados com `vigia evento`. O monitor não consegue observar decisões internas do chat; atualizações declaradas e evidência de processos/arquivos são fontes distintas.
- **Assinaturas / diagnóstico:** dados técnicos do backend, contagens de eventos/tentativas e índice de aprendizagem. Exportação PostgreSQL fixa `READ ONLY`, cursor, paginação, replay de 120 segundos e deduplicação por ID. Não exporta contatos, CPF, nome, nascimento, mãe, sexo ou resposta cadastral. Contagens de grupos não são contagem de pessoas impedidas nem devem ser somadas assim.
- **E-mails:** assunto, horário, estado e ID do provedor das notificações ao proprietário, a partir da integração. Aceite não prova entrega. Não se apresenta esse histórico como inventário retroativo de todos os e-mails antigos.
- **Planos / contexto:** plano da tarefa, escopo e resumo em `tools/monitor/CONTEXTO.md`. Não há ligação automática com todo o histórico deste chat.

**Ctrl+Q** fecha em qualquer campo; `q` fecha fora dos campos de digitação. Fechar a tela não para os coletores ou os jobs. Para terminais pequenos, o `vigia-simples` continua disponível.

## Persistência e limites

Banco privado: `/home/barre/.local/state/peticao-monitor/monitor.sqlite`, com diretório 700 e banco/sidecars 600. A tela lê esse banco; o serviço separado `peticao-monitor.service` coleta e executa a fila. Atualização visual/local em torno de 2 s; Git/SSH em torno de 10 s; diagnóstico em torno de 60 s. Horários e indisponibilidade das fontes são explícitos. Mudança de arquivo observa versão/mtime; não é inferência de autoria ou progresso.

Na VPS, o coletor `peticao-monitor-collector.service` roda como **adunir**, a cada 20 s, e guarda `/home/adunir/.local/state/peticao-monitor/health.sqlite`. Jobs ficam em `/home/adunir/.local/state/peticao-monitor/jobs/`, em serviços de usuário `peticao-vigia-job-<id>`. Linger de adunir foi habilitado para mantê-los após logout. Não muda o serviço peticao nem carrega segredos do app. O coletor de saúde e os jobs remotos continuam se o computador desligar; visualização e notificações locais retomam quando o coletor local voltar.

Comandos locais interrompidos não são repetidos automaticamente. Jobs remotos retomam a observação pelo mesmo ID e comando/diretório vinculados, sem novo envio. Estado/offset de saída são persistidos; não controla um PID reutilizado como se fosse o processo original. A saída de cada execução é limitada a aproximadamente 2 MB. O shell usa as permissões normais da conta; o Vigia não é um cofre nem cria isolamento adicional contra o próprio usuário. Não digite credenciais no prompt ou publique arquivos de runtime. Captura/limpeza de saída é defesa parcial, não garantia de detectar todo segredo possível.

Notificações: somente operator-78ffa47eeb@example.invalid`, em HTML, em transições e controles; andamento consolidado a cada 30 min enquanto houver tarefa ativa. Envios inconclusivos não são repetidos cegamente. Histórico e fila sobrevivem a reinícios. A Ponte existente permanece o canal de e-mail; ela e o painel de revisão não foram substituídos. O adapter de **WAHA está desativado**, sem listener, pareamento ou instalação.

## Operação e integração por agentes

```sh
/mnt/dev/peticao/vigia
/usr/bin/systemctl --user status peticao-monitor.service
/usr/bin/journalctl --user -u peticao-monitor.service -n 30 --no-pager
/mnt/dev/peticao/vigia diagnostico
/mnt/dev/peticao/vigia diagnostico --vps
```

Crie/atualize tarefas pela interface ou `vigia tarefa ID --titulo 'Título' --estado running --etapa 'Testes' --diretorio /mnt/dev/peticao`; etapas com `vigia etapa ID etapa 'Título' --estado completed --peso 1 --pai grupo`; eventos com `vigia evento ID --tipo test_passed 'Resultado validado'`. Pedidos explícitos via `vigia pedir ID --tipo shell 'comando'`. O agente pode continuar usando `vigia-simples --register`, importado com deduplicação. Não declare execução ou conclusão sem evidência, nem use porcentagem baseada em tempo.

Instalação local: `/usr/bin/python3 /mnt/dev/peticao/tools/monitor/install.py`; remota: o mesmo com `--vps`. Dependências Python ficam no venv `/home/barre/.local/share/peticao-monitor/venv`, fixadas em `requirements.txt`, sem alterar o Next.js. O serviço remoto tem usuário sem elevação automática. O shell remoto pode ser restrito por `NoNewPrivileges`; root não é adquirido pelo monitor.

O prompt usa o [protocolo oficial Codex App Server](https://learn.chatgpt.com/docs/app-server), com login já existente do CLI, inicialização, criação/retomada de thread, eventos e aprovações. Schema foi conferido no Codex CLI 0.167.0. Nenhuma chave de API foi copiada para o monitor.

## Validação do painel

```sh
/home/barre/.local/share/peticao-monitor/venv/bin/pytest -q /mnt/dev/peticao/tools/monitor/tests/test_monitor.py
/usr/bin/python3 -m unittest discover -s /mnt/dev/peticao/tools/monitor/tests -p test_simples.py -v
```

Há testes de fila/transações, progresso hierárquico, replay, contexto vinculado, expiração/decisão única, Codex RPC simulado, shell/entrada/pausa/retomada/cancelamento, Git, seleção segura por teclado, editores e sincronização de diagnósticos sem valores pessoais. Ensaios reais verificam autenticação nos dois hosts, resposta da IA local sem ferramentas, job persistente/idempotente na VPS, serviço local, notificações e terminal real. Evidências ficam em `.cache/vigia-qa/`; não são dados para versionar.


## Monitor imediato de uma tela

Execute **`vigia-simples`** em outro terminal. O alias foi acrescentado a `/home/barre/.bash_aliases`, com cópia de segurança do arquivo anterior; o executável também está em `/home/barre/.local/bin/vigia-simples`.

Comando completo: `/mnt/dev/peticao/vigia-simples`.

- `1`: aba **Em andamento** (padrão), somente tarefas ainda não concluídas e observação de processos/serviços.
- `2`: aba **Concluídos**, somente tarefas finalizadas, com resultado e horário.
- `Tab`: alternar abas.
- `q`: sair sem interromper tarefas ou serviços.
- `j` / `k`: percorrer os processos em andamento ou as tarefas na aba de concluídos.
- Espaço: pausar somente a atualização da tela.
- `r`: atualizar.
- Em terminais pequenos, usa apresentação compacta; em terminais maiores, mostra detalhes.
- `--uma-vez` imprime um retrato; `--json` retorna dados estruturados; `--sem-vps` dispensa SSH.

A tela distingue atualizações registradas pelos agentes de processos/serviços observados diretamente. Estado do agente com mais de três minutos aparece sem atualização recente; não é transformado automaticamente em execução comprovada. Percentuais aparecem somente quando o agente informa itens concluídos e total fixo. Sem isso, não se inventa porcentagem.

A coleta local ocorre a cada dois segundos; a VPS é consultada a cada dez, por comando SSH fixo somente leitura. Mostra indisponibilidade e horário da última coleta. Ter arquivos de um módulo e build presentes não comprova, sozinho, que um deploy foi validado.

Não lê credenciais, entradas do formulário, arquivos de ambiente ou dados de assinantes. Argumentos de processos não são impressos. O monitor não inicia testes, modifica o servidor ou faz consultas CPF. Fechar a tela não cancela as atividades acompanhadas; enquanto fechada esta versão simples não coleta amostras novas. Os coletores persistentes pertencem à versão completa.

## Atualização pelos agentes

Use `/mnt/dev/peticao/vigia-simples --register identificador --title 'Título' --state running --stage 'Etapa real' --environment local --scope 'Backend' --detail 'Resumo verificável'`. Estados: `queued`, `running`, `waiting`, `interrupted`, `failed`, `completed`.

`--done N --total M` só deve ser usado para conjuntos efetivamente mensuráveis. O registro fica em `/home/barre/.local/state/peticao-monitor/simple/activities`, com modo 600; não é exportação de dados pessoais. O agente do deploy de diagnóstico já está integrado a essa atualização.

## Validação

`python3 -m unittest discover -s /mnt/dev/peticao/tools/monitor/tests -p test_simples.py -v`.

Cobertura: escrita atômica, preservação de criação, permissões, validação de total/identificador, filtragem de sequências de terminal, arquivos corrompidos e renderização compacta/detalhada. Os oito testes incluem separação das abas, transição sem perda de histórico e uma sessão PTY real, com teclas em sequência e encerramento. Um travamento causado pelo buffer de entrada foi corrigido e coberto por regressão. A consulta somente leitura da VPS também foi exercitada.

Após atualizar o código, saia com `q` e abra novamente `/mnt/dev/peticao/vigia-simples` para carregar as novas abas. A troca de aba não altera estados nem registros.
