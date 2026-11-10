# Ponte local de observação do cluster

Arquivo: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/vigia_bridge.py`.

Comando para o timer externo local, aproximadamente a cada 30 segundos:

`/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/vigia_bridge.py`

Uma execução consulta somente `jobs` por `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/cluster.py`, no nó Santiago por padrão. `--node sp` deve ser usado somente quando o operador desejar observar a reserva. A ponte não submete tarefas, não controla executores, não faz merge/deploy, não modifica a tarefa principal admin-v2 e não instala timers. A consulta usa a conexão SSH privada já configurada pelo cliente.

Checkpoint padrão: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/state/vigia-bridge.json`, modo0600. Lock exclusivo evita coletores concorrentes. Cada nó guarda after_seq, observações por job e última coleta bem-sucedida/erro. Eventos têm IDs estáveis e deduplicação no Vigia, inclusive se a ponte encerrar entre gravar evento e checkpoint.

Registra tarefas somente com prefixos `cluster-job-UUID` e `cluster-observer-santiago`/`cluster-observer-sp`. O detalhe inclui nó, commit, geração, estado remoto, datas, resultado/exit code e caminhos. Starting é espera por confirmação; canceled é interrompida com etapa explícita. Não calcula porcentagem nem ETA de conclusão sem evidência. O observador espera entre coletas, não aparece como construtor do painel. Até200 jobs recentes e500 eventos são consultados por ciclo; o offset continua no próximo ciclo. Eventos de jobs fora da janela criam observação com estado atual desconhecido, sem presumir execução a partir de evento histórico.

Falha na coleta deixa observador failed e jobs ativos previamente observados waiting, preservando o último estado conhecido no detalhe. Isso significa observação indisponível, não prova de encerramento do processo remoto. Uma coleta posterior restaura os estados efetivamente retornados pelo coordenador. Falha retorna exit1; coleta bem-sucedida exit0. O registro usa a API local Store.task/event/snapshot, evitando o agendamento de e-mails que `vigia tarefa` faria automaticamente.

Para verificar sem SSH nem tocar no banco real do Vigia, forneça todos os caminhos absolutos:

`/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/vigia_bridge.py --input-json /CAMINHO/ABSOLUTO/captura-jobs.json --vigia-db /CAMINHO/ABSOLUTO/monitor-isolado.sqlite --checkpoint /CAMINHO/ABSOLUTO/checkpoint-isolado.json`

A captura aceita o resultado direto `{jobs,events,authority}` ou o envelope RPC `{ok:true,result:{jobs,events,authority}}`. Não fornecer dados pessoais ou segredos. Verificação local realizada com banco temporário: deduplicação, persistência do offset, falha/retomada de observação, estados running/completed, somente IDs isolados e zero e-mails enfileirados. Validação sintática também aprovada. Nenhuma conexão SSH foi executada nesta implementação.
