# Retomada de quota do executor Vigia — 09/11/2026

## Escopo e estado observado

Autorização: continuar automaticamente depois da recuperação de uso/créditos,
preservando pausa do usuário, segurança e os limites de publicação. Implementação
em `/mnt/dev/peticao/.cache/admin-integration/candidate-vigia-quota-20261109`,
base `7dfb6f82f030fe3a7bdad511a92975c68ce347ec`. Nenhuma mudança no app, VPS,
conta, modelo, cobrança ou permissões do Codex.

O serviço local `peticao-monitor.service` estava ativo, PID134442;
`peticao-monitor-watchdog.timer` estava ativo/aguardando. O executável
`/home/barre/.local/bin/codex` informou versão0.167.0. Seu protocolo foi gerado em
`/tmp/peticao-vigia-protocol-20261109` somente para inspeção de tipos.

A consulta `account/rateLimits/read` funcionou com autenticação normal existente,
sem iniciar thread/turno. Retornou `ordinaryUsageAllowed=false`, `hasCredits=true`,
janela principal0% e secundária100%, sem causa específica em
`rateLimitReachedType`. Não foram registrados saldo, conta, credenciais ou
conteúdo de conversas. Esses indicadores não permitem prometer liberação por
recarga: é indispensável a permissão positiva do backend.

A execução legada `ff55e73442224c69994bb2b45fe06ec0` estava `completed`.
A execução `518ee8bcfd0c4700a6148881510c4e7a` estava `failed/unknown`. Cinco
etapas antigas estavam `waiting`; nenhuma foi retomada ou reclassificada.
O Goal nativo do root foi informado pelo principal como `active`, depois de
controle suportado pelo usuário; este mecanismo não altera Goals nem acorda
automaticamente este chat ou seus subagentes.

## Contrato implementado

- Opt-in por tarefa supervisionada, somente para pedidos criados depois da
  ativação. Não migra erros históricos nem pesquisa mensagens por palavras-chave.
- Elegibilidade exclusiva de pedido local `ai`, vinculado a etapa `working`,
  com erro terminal `usageLimitExceeded`. HTTP429 genérico, crédito mencionado
  em texto, orçamento de sessão, autenticação, sandbox, política de segurança,
  recusas, comandos shell e VPS não são elegíveis.
- Recusa, aprovação pendente, cancelamento ou erro terminal distinto no mesmo
  turno impedem a retomada. `willRetry=true` não cria outro turno; é necessário
  aguardar o resultado terminal do turno já existente.
- Espera persistida em tabelas novas do banco **do monitor**, não do app:
  `quota_policy` e `quota_waits`. A tarefa fica `waiting`, com etapa
  `Aguardar quota Codex`; não há agente trabalhando durante essa espera.
- Sondagem metadata-only a cada15min, ou15s após um reset oficial mais próximo.
  Reset é prazo para consultar, nunca autorização para executar. Não existe
  compra/consumo de reset credits, tentativa de inferência para testar saldo,
  troca de conta/modelo ou repetição ocupada.
- Só agenda quando `ordinaryUsageAllowed` é exatamente `true` e o bucket
  `codex` não informa limite atingido/controle de gasto. Campo ausente/null ou
  RPC indisponível mantém espera. Percentuais baixos, saldo positivo e horário
  vencido não substituem esse sinal. Esse caminho é conservador para uso
  incluído; não garante retomada apenas porque créditos pagos foram repostos,
  pois o contrato público não documenta um sinal positivo equivalente completo.
- Revalida em transação depois da consulta: tarefa/política ativas, causa
  original, controles, mesma thread, etapa original e ausência de outro pedido
  ativo/enfileirado. PID anterior existente ou inacessível impede repetição.
  Uma transação/lease impede sondagens e sucessoras concorrentes.
- Cria uma única requisição sucessora com contexto original, histórico na mesma
  thread, referência à execução anterior e checkpoint. O executor exige thread
  `idle` antes de `turn/start`; não interrompe um turno existente.
- Pausa/espera manual, interrupção, conclusão ou falha registrada pelo usuário
  cancela a espera de quota. Alterar escopo, diretório ou ambiente também cancela
  essa autorização. Voltar a `running` não ressuscita essa espera.
  O claim da fila também respeita o estado da tarefa.
- Máximo de duas retomadas automáticas por tarefa, preservando todos os registros.
  Reativar o opt-in não limpa esse histórico. Ao esgotar o limite, revisão
  explícita de escopo/checkpoint é necessária; não há reset automático do contador.
- Aprovações existentes continuam individuais. Retomar não aprova comandos,
  deploy, merge, envio, avisos ou acesso externo.

## Operação após revisão e integração

O código foi preparado e testado isoladamente. O serviço atual NÃO foi reiniciado,
e nenhuma política real foi habilitada por esta unidade. A alteração só tem efeito
no executor persistente depois de carregar a versão integrada. Antes disso,
conferir `/home/barre/.local/state/peticao-monitor/monitor.sqlite` em modo somente
leitura, os processos próprios e as filas; preservar backup SQLite consistente
em diretório privado. Não reiniciar enquanto houver execução ou aprovação ativa.
O restart existente chama recuperação; não deve servir para reanimar plano antigo.

Para um **novo plano revisado** já supervisionado, depois da integração:

```sh
/mnt/dev/peticao/vigia retomada-quota ID_DA_NOVA_TAREFA
/mnt/dev/peticao/vigia retomada-quota ID_DA_NOVA_TAREFA --desativar
/mnt/dev/peticao/vigia tarefa ID_DA_NOVA_TAREFA --estado paused
```

O primeiro comando deve preceder pedidos novos; timestamps iguais ao opt-in são
excluídos conservadoramente. Desativar não cancela processo já iniciado; para
esse processo, usar seu controle explícito normal. `vigia retomar` não é comando
para contornar segurança nem revisar automaticamente impedimento desconhecido.

Rollback de código: retirar esta unidade antes de reiniciar o executor, com fila
inspecionada e políticas desativadas. Preservar as duas tabelas para auditoria;
não apagar registros históricos nem restaurar um backup antigo sobre atividade
posterior. Não há alteração no banco, schema ou serviço da petição.

## Evidências e limites de cobertura

Comando executado, a partir de
`/mnt/dev/peticao/.cache/admin-integration/candidate-vigia-quota-20261109`:

```sh
/home/barre/.local/share/peticao-monitor/venv/bin/python -m pytest -q /mnt/dev/peticao/.cache/admin-integration/candidate-vigia-quota-20261109/tools/monitor/tests/test_quota.py /mnt/dev/peticao/.cache/admin-integration/candidate-vigia-quota-20261109/tools/monitor/tests/test_supervision.py /mnt/dev/peticao/.cache/admin-integration/candidate-vigia-quota-20261109/tools/monitor/tests/test_monitor.py /mnt/dev/peticao/.cache/admin-integration/candidate-vigia-quota-20261109/tools/monitor/tests/test_simples.py
```

Resultado final:87/87 em79.37s, SQLite privado e protocolo fictício. Cobertura inclui
concorrência, persistência, contexto/thread, indisponibilidade, espera espaçada,
pausa antes/depois da consulta, claim pausado, PID vivo, mudança de autorização,
recusa, segurança, cancelamento, turno ativo, `willRetry`, legado e limite de
tentativas. Não simulou recarga financeira real nem iniciou inferência para QA.

Na rodada ampliada,12 testes do verificador legado falharam tanto no candidato
quanto na referência original. O arquivo
`/mnt/dev/peticao/tools/monitor/vigia_monitor/known_qa.py` espera o checksum
`4fd45c10b3b83ebcf8caf134c28b5f37c47e5e466d7cba90af71940bc4fe5574`, mas
`/mnt/dev/peticao/.cache/admin-integration/candidate-stage02-domains/tools/admin-qa/consolidation.py`
tem `642a16146af63b8f780544c4e87430165a302cfb3d29494206f77edca1ece1a6`.
Baseline verificado:13 aprovados e12 falhas em6.67s.
A proteção/allowlist permaneceu intacta. Nenhum comando de QA antigo foi
readmitido; uma expectativa antiga de aceite não justifica liberar esse helper.

O recurso cobre apenas execuções próprias gerenciadas pelo Vigia com o erro
terminal estruturado. Falha de RPC antes do turno, serviço desligado, ausência
de sinal positivo oficial, erro legado ou Goal/subagente de outro ciclo não
recebem promessa de retomada. Na máquina desligada o monitor não opera.

## Fontes primárias

- [OpenAI — App Server, Rate Limits e lifecycle de turnos](https://learn.chatgpt.com/docs/app-server).
- [OpenAI — limites, créditos e uso do Codex](https://learn.chatgpt.com/docs/pricing).
- Contrato instalado0.167.0:
  `/tmp/peticao-vigia-protocol-20261109/v2/GetAccountRateLimitsResponse.ts`,
  `/tmp/peticao-vigia-protocol-20261109/v2/ErrorNotification.ts`,
  `/tmp/peticao-vigia-protocol-20261109/v2/TurnError.ts` e
  `/tmp/peticao-vigia-protocol-20261109/v2/ThreadStatus.ts`.

O contrato local explicita que `ordinaryUsageAllowed=null` é indisponível e que
clientes não devem inferir recuperação por percentuais ou datas. O código faz
essa distinção; não amplia as capacidades documentadas nem remove controles.
