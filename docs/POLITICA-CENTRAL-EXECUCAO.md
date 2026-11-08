# Política central de execução e prioridade

Determinada expressamente pelo responsável em 07/11/2026. Aplica-se ao trabalho neste projeto e ao contexto fornecido pelo Vigia aos agentes.

## Prioridade contínua do admin-v2

Regra expressamente reforçada pelo responsável em 08/11/2026:

> NUNCA PARAR UMA TAREFA DADA COMO PRIORITÁRIA, A NÃO SER QUE SEJA SOLICITADA A INTERRUPÇÃO.

Manter foco total na prioridade até concluir o escopo aprovado. Não interromper por iniciativa própria para responder perguntas, atender pedidos de status ou executar tarefas secundárias. Quando solicitadas em segundo plano, essas tarefas devem permanecer separadas e não substituir a execução prioritária. Não encerrar o trabalho ao concluir apenas uma etapa intermediária.

O desenvolvimento e a integração do **admin-v2 são a prioridade número 1 até a conclusão do escopo integral aprovado**. Uma entrega essencial ou intermediária não encerra essa prioridade.

Uma tarefa temporária só pode interrompê-lo quando o responsável solicitar a interrupção. Assim que essa tarefa terminar, **retomar imediatamente o admin-v2 do ponto registrado, sem esperar novo pedido nem solicitar autorização para iniciar cada etapa já aprovada**. Perguntas de status e pedidos breves não substituem o objetivo principal. A prévia isolada somente leitura com dados da VPS está concluída; o escopo prioritário atual é concluir o admin-v2 completo, preservando a prévia para avaliação.

Reforço de08/11: mostrar no chat os patches/diffs e os comandos/resultados efetivamente executados, sem imprimir credenciais ou dados pessoais. Atualizar etapas e atividade real no Vigia; não manter uma tarefa como execução ativa quando só houver espera ou serviços de prévia ligados. Não substituir o desenvolvimento por notificações de andamento.

## Interrupção e retomada verificáveis

Antes de alternar de tarefa, registrar no histórico e no Vigia:

- Etapa e subetapa atuais, checkout/branch, último commit e alterações ainda não commitadas.
- Comandos realmente ativos, seus processos e caminhos dos logs.
- Resultado observado dos testes e próxima ação concreta de retomada.

Ao concluir a tarefa temporária, conferir esse checkpoint, retomar a próxima ação e atualizar o Vigia. Preservar a versão disponibilizada para avaliação; desenvolver as etapas seguintes em checkout separado quando necessário.

## Status fiel à execução

Não apresentar uma intenção, um serviço de prévia ligado ou um resultado antigo como desenvolvimento em execução. Distinguir agente trabalhando, comando/teste efetivamente rodando, espera de revisão e intervalo sem execução.

Testes demorados podem continuar em processo persistente, com logs e resultado verificáveis. A ausência de atualização não comprova atividade nem conclusão. Quando não houver execução, informar isso claramente e retomar o trabalho pendente. Nunca simular atividade por atualizações vazias.

Interrupções externas (queda, limite de uso ou encerramento da sessão) e impedimentos técnicos não podem ser ocultados. Registrar o último estado verificável, o motivo e a próxima ação; notificar quando o canal estiver disponível e retomar no primeiro momento em que a execução for possível. Enquanto um passo depender de autorização ou recurso indisponível, continuar os passos independentes já autorizados. Não alegar que existe um agente ou processo autônomo sem verificar sua execução.

## Aprovações e comunicação

A prioridade não autoriza deploy ou merge: **nenhuma publicação, merge ou integração/sincronização de código com a VPS, em qualquer direção, sem permissão explícita do responsável**. Inspeções somente leitura não autorizam incorporar as fontes inspecionadas. Enquanto uma publicação aguarda autorização, continuar as partes independentes do plano em ambiente isolado, preservando o candidato em avaliação. Manter as demais regras de aprovação de avisos e informações ao usuário.

Informar início, retomada, interrupção e conclusão, além de atualizações de andamento. Registrar evidências e estimativas condicionadas aos resultados. Enviar notificações e relatórios somente a operator-78ffa47eeb@example.invalid`, em HTML; consolidar andamento a cada30 minutos durante trabalho ativo. Aceite do provedor não comprova entrega.

## Referências operacionais

Decisão de 08/11/2026: o dono respondeu “Aprovo os textos e escolho 30 dias” às perguntas específicas sobre AV-15 (arquivados, restauração e aviso de conflito de remetentes) e retenção do conteúdo de e-mails, anexos e rascunhos administrativos. Aprovação restrita a esses itens; não se estende aos demais avisos ou ao deploy. Política de conteúdo em `docs/POLITICA-RETENCAO-CONTEUDO-ADMIN.md`. Preservar metadados de auditoria, assinaturas, hashes, datas, decisões e documentos originais.

- Plano integral: `docs/PLANO-INTEGRACAO-ADMIN-VPS.md`.
- Checkpoints e resultados: `docs/ADMIN-V2-PROGRESSO-20261106.md`.
- Contexto dos agentes do Vigia: `tools/monitor/CONTEXTO.md`.
- `AGENTS.md`, aprovações existentes e as demais políticas continuam aplicáveis. Preservar assinaturas, hashes, datas, decisões locais, segredos e versões anteriores.
