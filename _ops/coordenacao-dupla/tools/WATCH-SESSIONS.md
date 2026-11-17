# Observador de metadados das duas sessões

Programa: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/watch_sessions.py`.

Observa somente arquivos JSONL cujos nomes contêm os IDs autorizados:

- apoio:01a1c0b3-f069-75a0-a2e9-e691094c9bab.
- admin:01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7.

Não copia mensagens, raciocínio, argumentos/saídas de ferramentas ou linhas brutas. Retém timestamps, tipo do evento e nome da ferramenta quando presente. Nenhum descendente é deduzido como ativo; subagentes devem vir dos registros reais do Vigia. Os arquivos originais não são alterados.

Estado sanitizado para o relatório horário: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/state/sessions.json`. Campos principais: observed_at (horário da coleta), sessions (array com actor,thread_id,last_activity_at,turn_state,observation_state,last_event_type,last_tool_name,stale), actors (metadados agregados por ator) e repositories (commit mais recente que tocou código da aplicação, branch e status rastreado limitado à aplicação). O horário da coleta nunca substitui o horário da atividade da conversa.

Estados: task_closed exige evento explícito de encerramento; recent_activity significa somente metadados recentes; stale significa ausência de confirmação recente; unknown significa evidência insuficiente. Nenhum estado prova que o processo Codex está vivo, conclui o admin-v2 ou calcula percentual de progresso. Sem evento explícito task_started/task_complete, turn_state fica unknown.

Checkpoint privado: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/state/watcher-checkpoint.json`, modo0600. Guarda inode/device, offsets e somente metadados sanitizados. A primeira leitura começa no trecho final de até256KiB por ator; initial_history_skipped_bytes informa o histórico anterior não varrido. Até512KiB de linhas são lidas por ciclo no total, com limite128KiB por linha; linhas grandes são ignoradas sem persistir seu conteúdo. JSON parcial curto é relido no ciclo seguinte; truncamento/rotação reiniciam o cursor. Um lock evita execuções simultâneas. Descoberta de arquivos possui orçamento de50mil entradas; não se faz busca textual ampla no histórico.

Git consulta somente os três checkouts autorizados: `/mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109`, `/mnt/dev/peticao` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109`. A coleta limita paths a site/src,site/assets,site/public e manifests/configurações da aplicação. Não coleta arquivos não rastreados nem conteúdo de arquivo; exclui CSV/TSV/XLS/XLSX/SQLite/DB/SQL/dump/log/env. stat de arquivos rastreados modificados permite detectar mudanças adicionais sem ler o conteúdo.

Integra somente pelo ledger CLI existente `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py`: announce --no-require-ack para metadados; observe --app-code-only --no-require-ack para Git. Chama cada ação somente quando o snapshot relevante muda. São avisos de observação, nunca ACK de compatibilidade, integração ou publicação. O observador não edita coord.py nem acessa o SQLite do ledger diretamente. Falha de entrega preserva o checkpoint das partes concluídas e devolve exit1 para nova tentativa, sem confirmar atividade fictícia.

Comando de uma coleta:

`/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/watch_sessions.py`

Uma coleta inicial foi executada com --no-ledger para produzir o snapshot sanitizado sem anunciar baseline. --no-ledger também permite revisão local; --session-root e --state-root aceitam diretórios alternativos para testes.

Unidades somente preparadas, não instaladas/iniciadas:

- `/mnt/apps/peticao-final/_ops/coordenacao-dupla/units/coord-sessions-watch.service`.
- `/mnt/apps/peticao-final/_ops/coordenacao-dupla/units/coord-sessions-watch.timer`.

O timer pede uma coleta30 segundos após o encerramento da coleta anterior e não cria sessões Codex, agentes, SSH ou e-mail. Não há listener de rede.

Verificação:

`/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools -p 'test_watch_sessions.py' -v`

Oito testes aprovados: incremental/JSON parcial, truncamento/rotação, limite de leitura, canários sensíveis ausentes do estado, distinção entre atividade e heartbeat, deduplicação/sem ACK, somente arquivos de sessão autorizados e exclusão de dados privados/não rastreados no Git. py_compile e systemd-analyze --user verify também aprovados. Sem SSH, deploy, e-mail ou nova sessão Codex.
