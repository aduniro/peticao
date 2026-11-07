# A6 — registro durável da Central de Ações

Implementação local, ainda não liberada. Não altera o journal/protocolo de comandos do Terminal, que continua independente.

## Contrato implementado

- Modos aceitos explicitamente: `simular`, `executar` e `consultar`. A palavra de confirmação existente continua obrigatória para ações de escrita; a rota mantém Total + confirmação extra.
- Ações de escrita reservam ID, ator, parâmetros normalizados e identificador de pedido junto com a auditoria **antes** do efeito. Falha na reserva impede a operação.
- A trava é por grupo e esquema do banco, evitando sobreposição de iniciar/parar e interferência entre esquemas de teste independentes.
- Reenvio e ativação/desativação do Terminal usam o cliente da transação: efeito no banco, resultado final e auditoria são confirmados juntos. Falha no resultado reverte essas alterações.
- A notificação opcional de ativação do Terminal ocorre depois do commit e da liberação da trava. Demora/falha do aviso não impede desligar nem transforma a ativação confirmada em falha. O indicador de aviso só é complementado quando seu registro é confirmado; não prova entrega na caixa de entrada.
- Pedidos externos não são tratados como transações reversíveis. Resultado incerto permanece registrado e bloqueia repetição da mesma ação; consultas e outras operações seguras continuam disponíveis. Não apagar reservas por idade.
- Uma recusa tipada que comprova ausência de efeito é registrada como falha. Erro genérico após possível aceite é indeterminado. Em perda da confirmação do commit, o resultado durável é relido antes de responder.
- `aceito` na publicação significa pedido aceito, **não deploy concluído**. O identificador do sinal é o mesmo gravado antes do efeito, permitindo correlação posterior com o serviço root. A interface de dois argumentos de `pedirPublicacao` permanece compatível.
- Reservas antigas de efeito apenas no banco só são recuperadas depois de obter a trava do grupo: efeito e resultado teriam sido confirmados juntos, portanto uma reserva ainda pendente não tem efeito confirmado. Não executar a reserva antiga novamente.
- As colunas `central_*` são aditivas. Linhas anteriores recebem `legacy`; IDs, parâmetros, resultados e horários antigos não são reescritos nem reexecutados. Leituras/simulações mantêm o conteúdo de retorno anterior.

## Evidências e limites atuais

Testes locais com banco fictício e callbacks controlados cobrem reserva, rollback, resultado externo incerto, trava entre ações opostas, recusa conhecida, commit confirmado com resposta perdida e aviso pós-commit sem impedir desligamento. A publicação de teste usa somente arquivo-sinal em diretório temporário; nenhum executor/deploy real é chamado. O ensaio de migração também verifica o histórico anterior da Central.

Validação desta revisão: **277/277** testes cumulativos, tipos, build e migração aprovados. A suíte específica passou 27/27. Logs em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: `stage01-cumulative-actions-journal.log`, `stage01-typecheck-actions-journal.log`, `stage01-build-actions-journal.log`, `stage01-action-journal.log` e `stage01-action-journal-migration.log`.

O navegador passou em seis larguras para recuperação de simulação após falha de rede, preservação das datas, registro de consulta e ausência de alterações nas configurações de reenvio/Terminal. Evidências em `visual-actions/actions.json` e `stage01-actions-browser.log`; captura de 1280 px inspecionada. Esse roteiro não executa ações de escrita, nem comprova a correção da descrição estática da janela (AV-6).

Ainda faltam a integração do resultado indeterminado na interface, após aprovação do AV-5, e o histórico/conciliação controlada. O vínculo único simulação/execução e sua recuperação no navegador foram validados conforme o contrato abaixo. **O mecanismo controlado de conciliação de pedidos externos e a exposição do histórico ao administrador ainda precisam ser concluídos**; neste checkpoint uma ação externa indeterminada permanece bloqueada. Não fornecer edição SQL ou limpeza de histórico como atalho para desbloquear.

Os avisos anteriores e as Etapas 2–7 permanecem no escopo. Este documento não autoriza publicação nem declara a integração concluída.


`central_fim` representa encerramento/classificação do registro local; não é o horário de conclusão de uma publicação externa. A primeira rodada específica encontrou disputa de trava entre esquemas de teste independentes; a trava passou a incluir o esquema. Os testes de ações concorrentes no mesmo esquema continuam exigindo exclusão mútua. A notificação pós-commit do Terminal permanece de melhor esforço, sem prometer entrega nem exatamente um e-mail após falha de processo.


## Intenção única e recuperação de resposta HTTP

Cada simulação de escrita emite ID e token aleatório de 24 bytes, válido para admissão por 15 minutos. O banco conserva somente SHA-256 do token. O vínculo inclui ação, parâmetros normalizados, ID e e-mail do administrador. Publicação vincula o SHA efetivamente retornado na simulação. A rota HTTP exige sessão Total, confirmação extra, palavra e intenção; campos do corpo não podem desativar essa exigência. Chamadas internas do núcleo sem `requireIntent` permanecem compatíveis com os testes legados; o único chamador de produção é a rota, que sempre exige a intenção.

A admissão trava a simulação e possui índice único para uma execução por simulação. Repetir o pedido recupera o resultado persistido; não chama novamente o efeito. A expiração bloqueia novas admissões, mas não impede consultar uma execução já admitida. Falha definitiva exige nova simulação explícita; falha da auditoria de admissão não consome a intenção. Resultado externo incerto continua bloqueado, inclusive com simulação nova, até conciliação controlada.

O navegador conserva a intenção e os parâmetros antes do POST em `sessionStorage`, por conta/sessão/ação. Após erro de rede, mantém os valores e usa a mesma intenção na tentativa explícita seguinte. Ao recarregar, apenas consulta; nunca executa automaticamente. O token não substitui autenticação nem confirmação extra. Armazenamento indisponível limita a recuperação a essa instância da página. Não existe garantia de recuperação automática depois de fechar a aba. Respostas antigas não sobrescrevem um pedido mais recente.

Os novos campos são aditivos e nulos no histórico legado. O ensaio `deploy/test/admin-schema-upgrade.mjs` foi ampliado para conferir essa preservação. Testes de núcleo cobrem concorrência, identidade/parâmetros/token diferentes, expiração, auditoria, consulta sem execução e publicação incerta sem replay. O QA de navegador é `tools/admin-qa/action-intent.mjs`, restrito a servidor/banco locais fictícios: interrompe a resposta depois de concluir `reenvio.parar`, alterna nova tentativa e recarga, verifica uma única admissão e restaura a preferência tocada. Nunca inicia reenvio, publicação ou Terminal.

Avisos AV-5/AV-6, histórico/conciliação e demais etapas continuam pendentes. Nenhum texto visível foi modificado nesta revisão.


### Validação do vínculo único

Suíte cumulativa **283/283**, tipos, build e migração aprovados. O navegador passou nas seis larguras, com uma única admissão por caso depois de perda da resposta: repetição explícita em 320/768/1280 px e recarga seguida apenas de consulta em 390/992/1920 px. A rodada ampliada também rejeitou erros HTTP inesperados; não houve exceções nem falhas de rede além dos abortos deliberados. Configurações fictícias restauradas e sessão revogada. Captura de 390 px inspecionada; o teste não declara paridade por pixel de todas as telas.

Evidências em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: `stage01-cumulative-intent-isolated.log`, `stage01-typecheck-intent.log`, `stage01-build-intent.log`, `stage01-intent-migration.log`, `stage01-intent-browser-http.log` e `visual-action-intent-http/intent.json`. A primeira rodada cumulativa (`stage01-cumulative-intent.log`) teve duas falhas provocadas por `MAIL_PROVIDERS=dev`, que sobrepunha a troca de transporte feita pelos próprios testes; o log foi preservado. A repetição removeu essa variável, sem modificar os testes de e-mail, e passou integralmente.
