# A6 — registro durável da Central de Ações

Implementação local, ainda não liberada. Não altera o journal/protocolo de comandos do Terminal, que continua independente.

## Contrato implementado

- Modos aceitos explicitamente: `simular` e `executar`. A palavra de confirmação existente continua obrigatória para ações de escrita; a rota mantém Total + confirmação extra.
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

Ainda faltam a integração do resultado indeterminado na interface, após aprovação do AV-5, e o vínculo único entre simulação/intenção e execução, incluindo repetição de POST depois de perda da resposta HTTP. A trava e o identificador de admissão não substituem essa idempotência no cliente/servidor. **O mecanismo controlado de conciliação de pedidos externos e a exposição do histórico ao administrador ainda precisam ser concluídos**; neste checkpoint uma ação externa indeterminada permanece bloqueada. Não fornecer edição SQL ou limpeza de histórico como atalho para desbloquear.

Os avisos anteriores e as Etapas 2–7 permanecem no escopo. Este documento não autoriza publicação nem declara a integração concluída.


`central_fim` representa encerramento/classificação do registro local; não é o horário de conclusão de uma publicação externa. A primeira rodada específica encontrou disputa de trava entre esquemas de teste independentes; a trava passou a incluir o esquema. Os testes de ações concorrentes no mesmo esquema continuam exigindo exclusão mútua. A notificação pós-commit do Terminal permanece de melhor esforço, sem prometer entrega nem exatamente um e-mail após falha de processo.
