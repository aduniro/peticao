# Política central de execução e prioridade

Determinada expressamente pelo responsável em 07/11/2026. Aplica-se ao trabalho neste projeto e ao contexto fornecido pelo Vigia aos agentes.

## Prioridade contínua do admin-v2

O desenvolvimento e a integração do **admin-v2 são a prioridade número 1 até a conclusão do escopo integral aprovado**. Uma entrega essencial ou intermediária não encerra essa prioridade.

Uma tarefa temporária pode interrompê-lo por solicitação do responsável ou necessidade operacional. Assim que essa tarefa terminar, **retomar imediatamente o admin-v2 do ponto registrado, sem esperar novo pedido nem solicitar autorização para iniciar cada etapa já aprovada**. Perguntas de status e pedidos breves não substituem o objetivo principal.

## Interrupção e retomada verificáveis

Antes de alternar de tarefa, registrar no histórico e no Vigia:

- Etapa e subetapa atuais, checkout/branch, último commit e alterações ainda não commitadas.
- Comandos realmente ativos, seus processos e caminhos dos logs.
- Resultado observado dos testes e próxima ação concreta de retomada.

Ao concluir a tarefa temporária, conferir esse checkpoint, retomar a próxima ação e atualizar o Vigia. Preservar a versão disponibilizada para avaliação; desenvolver as etapas seguintes em checkout separado quando necessário.

## Status fiel à execução

Não apresentar uma intenção, um serviço de prévia ligado ou um resultado antigo como desenvolvimento em execução. Distinguir agente trabalhando, comando/teste efetivamente rodando, espera de revisão e intervalo sem execução.

Testes demorados podem continuar em processo persistente, com logs e resultado verificáveis. A ausência de atualização não comprova atividade nem conclusão. Quando não houver execução, informar isso claramente e retomar o trabalho pendente. Nunca simular atividade por atualizações vazias.

## Aprovações e comunicação

A prioridade não autoriza deploy: **nenhuma publicação na VPS sem permissão explícita do responsável**. Enquanto uma publicação aguarda autorização, continuar as partes independentes do plano em ambiente isolado, preservando o candidato em avaliação. Manter as demais regras de aprovação de avisos e informações ao usuário.

Informar início, retomada, interrupção e conclusão, além de atualizações de andamento. Registrar evidências e estimativas condicionadas aos resultados. Enviar notificações e relatórios somente a operator-78ffa47eeb@example.invalid`, em HTML; consolidar andamento a cada30 minutos durante trabalho ativo. Aceite do provedor não comprova entrega.

## Referências operacionais

- Plano integral: `docs/PLANO-INTEGRACAO-ADMIN-VPS.md`.
- Checkpoints e resultados: `docs/ADMIN-V2-PROGRESSO-20261106.md`.
- Contexto dos agentes do Vigia: `tools/monitor/CONTEXTO.md`.
- `AGENTS.md`, aprovações existentes e as demais políticas continuam aplicáveis. Preservar assinaturas, hashes, datas, decisões locais, segredos e versões anteriores.
