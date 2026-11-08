# Continuidade supervisionada das tarefas

Autorizada pelo proprietário em 08/11/2026. Integra o Vigia existente, sem publicar
código ou alterar serviços da petição na VPS.

## Regras operacionais

1. **Fila persistente:** plano imutável no SQLite privado; etapas possuem instrução,
   critério, dependências, checkpoint e IDs de execução. Um novo processo lê o
   mesmo estado. Instalar um plano exige validação integral antes da transação.
2. **Executor:** o coletor local executa a fila com bloqueio de instância e uma
   execução por tarefa. O serviço systemd reinicia após falha. O Codex CLI utiliza
   o login existente e threads próprias, sem ligação automática com este chat.
3. **Detector independente:** temporizador a cada minuto; cinco minutos sem
   atualização declarada ou saída vinculada tornam a tarefa `interrupted` e geram
   um único alerta por incidente. Um processo silencioso pode estar trabalhando:
   não é encerrado nem duplicado. O detector não fabrica pulsos de progresso.
4. **Falhas e retomada:** falhas de transporte permitem duas retomadas, após 30/60s,
   no histórico existente. Queda do executor permite retomada somente quando o PID
   anterior registrado já não existe. Comando shell interrompido não é repetido.
   Falhas de verificação podem abrir até duas investigações, se autorizadas no
   plano; não são tratadas como falhas transitórias. Créditos, autenticação,
   aprovações, erros desconhecidos ou orçamento de retomadas esgotado exigem aviso
   e estado de espera, preservando os registros.
5. **Conclusão verificável:** fim do turno não basta. Planos reais exigem relatório
   estruturado e verificações independentes com código zero. Continuação exige
   ferramentas executadas e checkpoint; há limite de 20 continuações por etapa,
   seguido de aviso, para impedir ciclos sem controle. Conclusão refere-se apenas
   ao plano instalado, nunca a todo o projeto por associação.

Notificações exclusivamente ao proprietário, em HTML pela Ponte. Aceite do
provedor não prova entrega. Resultado inconclusivo de envio não é reenviado
automaticamente. O temporizador também pode escoar um alerta com o coletor parado.
O monitor completo e o simples consultam o mesmo estado das tarefas supervisionadas.

Pedidos do sandbox para o helper local `verify_admin_candidate.py` podem usar a
autorização de QA já concedida: somente comando exato, cinco modos conhecidos,
candidato específico, checksum fixo do helper e execução vinculada ao plano ativo.
Cada decisão é auditada; tarefa pausada, helper alterado, comandos compostos,
outros caminhos, publicação ou mudança de permissões não recebem essa liberação.
Isso não concede autorização geral ao agente nem aceita pedidos de alteração de
arquivo ou de ações na VPS.

## Comandos

```sh
/mnt/dev/peticao/vigia supervisionar admin-v2-stage02
/mnt/dev/peticao/vigia supervisionar tarefa --plano /caminho/absoluto/plano.json
/mnt/dev/peticao/vigia execucao ID
/usr/bin/systemctl --user status peticao-monitor-watchdog.timer
```

O plano é uma lista JSON de objetos com `id`, `title`, `body`, `criteria`, `checks`
(lista de comandos argv, sem interpolação), `dependencies` (IDs anteriores),
`require_report: true` e `max_repairs` (0–2). A instalação autoriza somente o escopo
registrado; o agente continua sujeito às aprovações do Codex e às políticas locais.
Um plano instalado não pode ser substituído silenciosamente. Para suspender a
execução, pausar a tarefa; `--desativar` desliga sua supervisão. Não confundir isso
com pausa de um subprocesso já iniciado, controlado pela aba de execuções.

`vigia retomar TAREFA ETAPA --contexto 'Decisão ou diagnóstico autorizado'` retoma
explicitamente uma etapa em espera, preservando as execuções anteriores.
Com plano instalado, o percentual conta seus checkpoints de peso igual; não soma
etapas históricas e não estima esforço ou horas restantes. O plano integral do
admin-v2 está em `tools/monitor/plans/admin-v2-continuity.json`.

## Limites

Nenhum serviço funciona com a máquina desligada. A supervisão não cria créditos,
não supera indisponibilidade e não autoriza deploy ou merge com a VPS. Restrições
de escopo dadas ao agente são instruções; não constituem isolamento de segredos
contra a própria conta Linux. Alterações ambíguas e aprovações pendentes não são
resolvidas automaticamente. O detector observa este chat apenas por atualizações
registradas, sem acesso ao raciocínio interno nem poder de acordá-lo.

Antes de reiniciar o coletor, conferir execuções ativas e salvar backup SQLite.
Validar com os testes em `tools/monitor/tests/test_supervision.py`, a regressão
`test_monitor.py` e `test_simples.py`; usar somente dados fictícios nos ensaios.

## Validação inicial — 08/11/2026

- 37 testes Python aprovados (18 de supervisão e19 de regressão), mais oito do
  monitor simples; testes de concorrência, perda de executor, PID ainda vivo,
  repetição limitada, pausa, conclusão antecipada, relatórios, argv literal,
  verificador real e envio único/inconclusivo.
- Ensaio com o Codex CLI autenticado: thread própria executou uma ferramenta,
  produziu relatório estruturado e verificador independente confirmou o marcador.
  A tarefa de ensaio foi concluída somente depois do verificador, sem alterar app.
- Helper do candidato:15 testes direcionados, typecheck e migração estrita das13
  tabelas aprovados em Postgres local isolado, porta54349, dados fictícios.
- Unidades systemd verificadas; timer ativo, linger local já habilitado. Cópia de
  segurança do SQLite preservada antes da ativação em seu diretório privado.

Esses resultados validam o mecanismo inicial; não concluem o admin-v2 nem provam
recuperação de todo tipo de falha. Estado do plano e atividade devem continuar
sendo acompanhados; alterações posteriores exigem regressão correspondente.

No ensaio operacional, o sandbox pediu autorização para o QA local já aprovado.
Foi acrescentada a regra restrita por checksum/candidato/comando, coberta por três
testes adicionais (40 testes Python distintos, mais oito do monitor simples).
A ativação ocorreu pelo detector independente, sem reiniciar o executor admin-v2.
Comandos fora dessa regra continuam sujeitos às aprovações normais.

Na retomada de08/11, a execução avançou para documentos, mas voltou a aguardar
liberação técnica de QA já autorizado. A regra restrita agora reconhece também
`tools/admin-qa/consolidation.py` no candidato exclusivo, pelo SHA-256 revisado
`ef34e668c92144ce0a0503660a50688341badb253e40a45c14d084626de1c0a9`.
Aceita somente uma seleção dirigida conhecida ou contratos HTTP nomeados e
revisados, sem redirecionamento, encadeamento ou argumentos livres. Alterar o
roteiro, usar symlink, outro checkout ou contrato desconhecido exige nova revisão.
Pausa explícita continua impedindo a liberação. Isso não aprova commits, SSH,
envios reais, avisos pendentes, deploy ou merge com a VPS.

Revisão seguinte: contrato `batch-control` conferido para 3033/54349, contas e
documentos fictícios, nenhuma chamada de transporte. Checksum vigente do roteiro:
`7b2ad95fb99d9a160b8aa2690e0b5664b6ae981ec1e9d4f19dfc11067c66734f`.
A revisão anterior fica registrada acima; a regra não aceita roteiros alterados.

Após revisar as regressões de cancelamento, aprovação concorrente e reserva de
documentos, o grupo dirigido inclui `batch-mutation-atomicity.test.ts` e
`batch-document-reservation.test.ts`. Nenhum parâmetro de execução foi ampliado.
Checksum vigente após essa revisão:
`2609b70607a572ad6c14b0c43e08dd69b144dbd912f5b44af67051d6a02530d5`.

O contrato compilado `batch-reservation` foi revisado com porta 3033/banco 54349,
schema exclusivo, destinatários `.test`, mail dev e assinatura fictícia habilitada
somente no processo de QA. A lista fechada passa a incluí-lo. Checksum vigente:
`b4ba9dca7f32842f9f289d9ad4e2e50ae1ec2855b817d1006a207c3a3a7110dd`.

O contrato `batch-reconciliation` foi revisado para conciliar metadados de aceite
com documentos e provedores fictícios, sem reenvio. Os contratos usam caixas dev
individuais. Checksum vigente do roteiro Python:
`8a31d4c02cd11e19d555ac7b4f07134d9976bf25411a49bfc80ea82867cc7930`.

O grupo dirigido de documentos inclui agora as regressões revisadas de rejeição
conclusiva e de atribuição somente à lista capturada, com banco fictício/mail dev.
Checksum vigente:
`5436a65ee6844106e1896311cf0acfc45c8ddc57e61624add6586b274b5282a0`.
