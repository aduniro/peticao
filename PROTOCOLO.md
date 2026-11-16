# Coordenação dupla — contrato operacional único

## Regra vigente de autoridade e revisão — 14/11/2026

**Executor61 é opcional e não integra o quorum obrigatório.** Autorização explícita do proprietário neste chat vale sem aprovação adicional desse canal. Para cada plano/goal, a ordem explícita do proprietário de execução automática e sem novas permissões prevalece sobre travas administrativas conflitantes desta política, apenas naquele escopo. Registrar origem/escopo/condições e executar autonomamente, preservando testes, dados, limites e exclusividade operacional. Não criar ACKs fictícios.

Fonte normativa: `POLITICA-CENTRAL-AUTORIZACOES.md`, seção de14/11/2026; evidência integral: `_ops/coord-policy-owner-20261114/OWNER-INSTRUCTION.json`. Referências históricas a todos os atores devem ser lidas como todos os **revisores obrigatórios**, excluindo Executor61; seu registro, histórico e canal permanecem ativos.

Base compartilhada local: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/`. Não é um checkout compartilhado para edição de código. Dados e histórico operacional ficam privados em `/mnt/apps/peticao-final/_ops/coordenacao-dupla/state/coord.sqlite`; banco e snapshots não devem ser commitados.

## Participantes e fontes

- apoio: sessão01a1c0b3-f069-75a0-a2e9-e691094c9bab, responsável pelo frontend público em `/mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109`, infraestrutura, acompanhamento e único fluxo de e-mail.
- admin: sessão01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7, iniciada em `/mnt/dev/peticao`; desenvolvimento atual em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109`. Mantém contratos administrativos, banco/journal/mail/assinaturas e seus drafts independentes.
- Subagente historico_comum herdou o contexto desta conversa para construir o ledger e recebeu os dados autorizados da outra sessão. Não é um terceiro coordenador de publicação nem um processo LLM permanente. Os dois coordenadores dão os ACKs; subagentes usam os mesmos recursos pela autoridade de seu coordenador.

## Estimativa obrigatória de execução e conclusão

Ordem direta do responsável em 13/11/2026: **sempre que o responsável solicitar uma tarefa, informar uma estimativa de tempo para executá-la e finalizá-la**, antes de iniciar o trabalho operacional. Vale também para tarefas recebidas pelo Vigia/Executor, subtarefas solicitadas durante um trabalho em andamento e retomadas com escopo novo.

- Informar uma duração aproximada ou uma faixa realista; distinguir o tempo da nova solicitação do tempo restante da tarefa principal quando houver trabalho paralelo ou em fila.
- Explicitar dependências que afetem a previsão. Se a inspeção inicial for necessária, dar uma estimativa preliminar e refiná-la após essa inspeção, sem inventar precisão.
- Atualizar a estimativa quando houver mudança de escopo, impedimento ou evidência de que a previsão anterior não será cumprida. Não esperar cobrança do responsável.
- Uma estimativa não substitui autorização, não é garantia de prazo e não exige pedir aprovação novamente para trabalho já autorizado. Preservar a execução da tarefa principal ao atender esclarecimentos ou ajustes breves.

## Autorizações visíveis e válidas entre canais

Ordem direta do responsável em 13/11/2026: **todo pedido necessário de autorização deve aparecer neste chat principal e no Vigia, com notificação ao Executor operacional; a decisão pode ser dada pelo proprietário em qualquer um dos três canais e vale para o mesmo pedido.** Nunca aguardar uma resposta apenas no celular sem tornar o pedido visível aqui.

Aplicar `/mnt/apps/peticao-final/_ops/coordenacao-dupla/POLITICA-CENTRAL-AUTORIZACOES.md`: identificador comum, escopo e estimativa claros, decisão única autenticada, divulgação do resultado, deduplicação e falhas de entrega explícitas. Não exigir confirmação em todos os canais nem repetir aprovações já existentes. ACK técnico e autorização do proprietário continuam distintos.

## Comunicação obrigatória entre agentes

Ordem direta do responsável em 13/11/2026: **toda mensagem recebida de outro agente deve ser lida e respondida**, inclusive confirmações e avisos de conclusão, independentemente de ser coordenador, par, subagente ou outra sessão do projeto.

Ao receber a mensagem, no primeiro ponto de controle disponível, conferir a atividade atual e o planejamento antes de prosseguir. Responder ao remetente com **recebimento + atividade real atual + fila/próxima ação**. Se estiver aguardando ou sem pendências, informar isso explicitamente. Conferir mensagens também na retomada, após ferramentas e antes da próxima etapa; não depender de cobrança do responsável.

Modelo: **“Recebi [mensagem/resultado]. Agora: [atividade real ou aguardando]. Na fila/próximo passo: [ação ou nenhuma pendência].”**

Uma resposta por mensagem, sem repetir reconhecimentos por polling. Reconhecimento de recebimento não substitui revisão técnica, ACK do ledger nem autorização de publicação. Registrar falhas de comunicação e responder quando o canal voltar; não apresentar uma sessão desligada ou sem execução como vigilância contínua.

### Entrega automática à sessão Infra — ordem do proprietário em 14/11/2026

O responsável autorizou que notificações reais de agentes sejam entregues automaticamente à conversa permanente de Infra, iniciando sua leitura no próximo ponto de controle. O watcher determinístico pode usar `codex queue --thread 01a1d130-2948-7140-bcfb-34696b20ab8d --message ... --resume`, preservando o escritor existente. Hooks locais do Codex podem fornecer o conteúdo ao contexto em SessionStart/UserPromptSubmit/PostToolUse após a revisão de confiança exigida pelo próprio Codex. Não forjar confiança de hook nem contornar escritor ativo. Essa autorização substitui a proibição anterior de turnos automáticos apenas para entrega/leitura de mensagens; não autoriza execução de infraestrutura por texto recebido.

Monitorar inbox/outbox de Infra e handoffs compartilhados explicitamente destinados a Infra. Deduplicar por origem/hash, proteger segredos, limitar contexto e preservar o arquivo completo como fonte. Separar captura, enfileiramento, entrega ao contexto e leitura confirmada; registrar falhas de retomada mesmo quando a fila retorna sucesso. Registrar recibo real somente após leitura pelo agente. Recibos terminais encerram a comunicação e não criam ciclos de ACK. Não realizar polling LLM nem reproduzir histórico inteiro para gerar novos turnos. Nenhum quarto ator ou voto é criado.

Regra também registrada em `/mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/docs/POLITICA-CENTRAL-EXECUCAO.md`.

## Antes de editar

Ler status e eventos novos pelo CLI `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py`. Reservar os paths antes de alterar fontes compartilhadas; arquivos de branches distintos que representam o mesmo código têm o mesmo recurso canônico. Cada coordenador renova o próprio lease, preservando token/fence, e nunca usa o token do outro. Tokens ficam em arquivos privados, não em mensagens ou e-mails. Trabalho em drafts independentes pode continuar enquanto outro recurso estiver reservado.

Manual completo e comandos: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/README.md`.

## Integração, migração e publicação

1. Avisar a outra sessão e registrar um manifesto de `announce`: commit completo40hex, lista completa de arquivos, contratos de API (ou sem alteração), mudança de banco (ou sem alteração), testes/comandos/resultados e destino inequívoco. Referenciar pedido do responsável que autorizou a publicação concreta.
2. O outro coordenador confere o diff/contratos/evidências e registra ACK do evento. ACK não é autorização de deploy do admin-v2, nem aprovação automática de uma versão de produção não inspecionada.
3. Adquirir lease crítico com `--operation deploy|merge|migration --manifest-event SEQ`. Essas operações também reservam toda fonte e impedem edição concorrente por participantes que respeitam o protocolo. Checar validade e fence imediatamente antes da ação; renovar durante a operação. Sem manifesto/ACK ou com operação incerta, não prosseguir.
4. Conferir a release efetiva na VPS antes de compor a próxima. Atualizar frontend não autoriza substituir implicitamente o backend atual por um checkout público antigo. Manter package.json/lockfile, schema, emissor de e-mail, journal, tokens, WhatsApp e cron compatíveis. O patch público b9e8ae2 já existe no admin como0e362245; não reaplicar por data/merge cego.
5. Executar os testes adequados em ambiente fictício, registrar a composição final validada e publicar somente o escopo autorizado. Página principal: quando o responsável pedir a alteração acompanhada de deploy. Admin-v2: autorização específica obrigatória. Nenhuma publicação foi solicitada ou feita para implantar este protocolo.
6. Registrar resultado observado: commit realmente publicado, versão/build/hash, ambiente, testes de fumaça e eventual rollback. Avisar ambos, obter reconhecimento e encerrar o lease. Falha incerta não é tratada como operação abortada sem conferir estado remoto.

Expiração não transfere autoridade automaticamente. Leases expirados viram uncertain e continuam bloqueando o recurso até reconciliação pelos dois coordenadores. Falta de ACK bloqueia apenas a operação dependente; continuar tarefas independentes autorizadas. O ledger é um controle cooperativo: não intercepta sozinho edições ou comandos manuais fora do protocolo. Ambos os coordenadores concordaram em utilizá-lo antes das operações; nenhum script antigo ganha autorização por existir.

## Histórico e relatórios

Observador `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/watch_sessions.py`, timer `/home/barre/.config/systemd/user/coord-sessions-watch.timer`, a cada30s. Lê somente metadados incrementais das duas conversas autorizadas e alterações versionadas do código. Não copia mensagens brutas, argumentos/outputs de ferramentas, dados pessoais, CSVs privados ou segredos. Registro de coleta não prova agente ativo; a última atividade é o timestamp da conversa, com estado desconhecido/stale quando aplicável. Git/telemetria não dão ACK de compatibilidade.

Relatório único: `/home/barre/.config/systemd/user/peticao-relatorio-andamento.timer`, a cada1h, America/Porto_Velho. Programa `/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/report.mjs`; destinatário único operator-1608598f41@example.invalid. Inclui ambas sessões, subagentes registrados no Vigia, árvore do admin, checkpoints, testes, eventos e ACKs pendentes. Guarda por período e ausência de retry foram preservadas; não repetir slots antigos ou resultado incerto. Nenhum envio manual é necessário para habilitar a cadência.

O observador e o timer de relatório são serviços locais de usuário que persistem após logout (linger já habilitado); não executam decisões LLM, não assumem o controle de outra sessão e não trabalham quando este computador estiver desligado. Fila de Santiago e acompanhamento privado continuam independentes; o resumo local ficará antigo se a máquina local cair. Página privada: http://100.80.18.81:8766/.

Autorizações e limites: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/AUTORIZACAO-RESPONSAVEL-20261110.md`. Checklist de compatibilidade: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/admin-compat-20261110.md`.

## Localização do banco de assinaturas — decisão do proprietário em 14/11/2026

O banco de produção que atende às assinaturas permanece na VPS de São Paulo, onde já opera. Configurar acesso ao Neon, skills ou MCP não autoriza copiar, migrar, substituir ou apontar a aplicação para outro banco de assinaturas. Neon pode ser avaliado para funções independentes (coordenação de agentes, desenvolvimento/testes e integrações futuras), com escopo próprio. Uma eventual mudança do banco de assinaturas exigirá nova instrução explícita do proprietário; não faz parte dos planos atuais de infraestrutura distribuída nem da continuação do admin-v2. Esta decisão prevalece sobre sugestões anteriores de alocação desse banco.

## Finalidade do Neon — infraestrutura interna e escopos dos agentes

Determinação do proprietário em14/11/2026: Neon será utilizado apenas para infraestrutura interna do projeto, workers, fila de tarefas, manutenção e ajustes pendentes; eventualmente assistentes de comunicação WAHA/e-mail, após definir seus escopos. Antes de implementar bancos ou novos fluxos de agentes/comunicação, apresentar a divisão de responsabilidades de Root, Infra, desenvolvimento admin-v2, Apoio, Vigia e Executor. Não interpretar a disponibilidade de serviços Neon ou autenticação administrativa como autorização para novas finalidades, migração do banco das assinaturas ou ativação de todos os produtos. A localização de produção das assinaturas continua na VPS de São Paulo. As definições propostas em `_ops/agentes-escopos-20261114` não alteram por si mesmas serviços, permissões, quorum ou políticas operacionais existentes.
