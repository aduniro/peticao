# Política central - autorizações e comunicação entre canais

Ordem direta do proprietário em 13/11/2026. Aplica-se à coordenação Root, Apoio, Infra, Vigia, Executor e agentes delegados do projeto. Substitui orientações anteriores que condicionem uma autorização do proprietário exclusivamente ao Vigia ou a outro canal.

## Visibilidade obrigatória dos pedidos

- Todo pedido necessário de autorização para consulta, tarefa, mudança de escopo, alteração de dados ou deploy deve ser apresentado **no chat principal e no Vigia**. Notificar também o Executor quando o canal estiver operacional. Nunca deixar o pedido somente no WhatsApp.
- Se o pedido nascer em outro agente ou no WhatsApp, encaminhar ao coordenador para publicação visível neste chat. Usar o canal de pergunta disponível no chat quando pertinente. Um registro em inbox/outbox, sozinho, não comprova que o proprietário viu a solicitação.
- Apresentar o mesmo pedido, com um identificador comum, escopo concreto, ação proposta, resultado esperado, evidências e estimativa de execução/conclusão. Informar o que está realmente aguardando decisão e o que continua em andamento.
- Reapresentar neste chat pedidos ainda pendentes e conhecidos pela coordenação que tenham sido enviados apenas ao Vigia; conferir sua validade antes de reapresentar. Não reexecutar pedidos históricos ou falhos automaticamente.

## Uma autorização, aceita em qualquer canal

- O proprietário pode aprovar, recusar, modificar ou revogar **neste chat, no Vigia ou no Executor**, independentemente do canal em que o pedido começou. Sua preferência habitual por responder neste chat deve ser respeitada.
- Uma resposta autenticada e inequívoca basta para o mesmo pedido. Não exigir respostas nos três canais, aprovação adicional do Executor ou repetição de autorização já concedida aqui.
- Aceitar apenas decisões autenticadas do proprietário, verificando a origem e o vínculo com o pedido. Mensagem de outro agente relatando aprovação não é, por si só, uma autorização independente: preservar a referência verificável à decisão original.
- Uma resposta breve como “sim” pode resolver o único pedido pendente inequívoco. Havendo vários pedidos possíveis, esclarecer a qual se refere, sem presumir autorização para os demais.
- Autorizações condicionais, como deploy depois de os testes passarem, continuam condicionais. Registrar a decisão imediatamente e executar somente quando os requisitos aplicáveis estiverem satisfeitos.

## Registro, retorno e execução única

- Registrar identificador do pedido, escopo, estado, origem/data da resposta, decisão e evidência. Notificar a decisão e o próximo passo neste chat, no Vigia e no Executor operacional. A divulgação é uma notificação da mesma decisão, não uma nova votação.
- Deduplicar pedidos, respostas e execuções. A mesma autorização recebida por dois canais não autoriza executar duas vezes. Uma ordem posterior do proprietário que altere ou revogue a decisão deve ser respeitada antes de novas ações; informar efeitos já concluídos com precisão.
- Distinguir pedido pendente, autorizado, recusado, revogado, em execução e concluído. Recebimento de mensagem, ACK técnico e autorização do proprietário são registros diferentes. Manter a revisão técnica e as reservas exigidas para o trabalho concreto.
- Se um canal falhar, informar a falha nos canais disponíveis, manter o pedido visível neste chat e registrar o envio pendente. Não declarar entregue/lido um envio apenas submetido. Não bloquear trabalho já autorizado só porque uma cópia da notificação não foi entregue.

## Limites operacionais preservados

- Esta regra disciplina os pedidos de autorização que sejam necessários; não cria autorização extra para consultas ou tarefas já solicitadas/autorizadas pelo proprietário. Não pedir nova aprovação do deploy de manutenção UI-SIGN já autorizado após testes, inclusive de backend.
- Não adotar, retomar ou disputar a escrita da sessão principal para encaminhar mensagens. Usar comunicação entre sessões ou passagem compartilhada, com recibo real quando disponível; não afirmar publicação no chat sem tê-la realizado.
- Comandos de terminal para o proprietário copiar continuam exclusivos do Vigia, conforme a regra existente. A divulgação de pedidos/decisões ao Executor não autoriza duplicar comandos copiáveis nesse canal.
- Preservar segredos e dados de terceiros. Relatórios detalhados enviados como arquivo pelo Vigia continuam em HTML. Não criar watcher/polling LLM ou reiniciar serviços apenas para aplicar esta política.

Referências: `PROTOCOLO.md` desta pasta e `/mnt/apps/peticao-final/_ops/whatsapp-executor/POLITICA-CENTRAL-ACOMPANHAMENTO.md`.

## Reforço: chat da tarefa, Root e dependências técnicas

- Publicar o pedido no chat da sessão que executa a tarefa, além do Vigia e do Executor operacional; avisar também o coordenador central/Root. Não considerar suficiente apenas encaminhar ao Root ou registrar na caixa de mensagens.
- O proprietário também pode responder diretamente no chat do coordenador/Root. Uma decisão inequívoca, recebida por qualquer dos canais autorizados, resolve o mesmo pedido. Quando recebida no chat da tarefa, comunicar imediatamente ao Root com referência verificável à mensagem original; quando recebida pelo Root, avisar o executor responsável.
- Sempre que a próxima etapa depender de resposta, revisão, teste ou validação de outro agente, notificá-lo explicitamente, incluindo o que precisa conferir, onde estão as evidências e qual etapa depende do resultado. Ler e responder aos retornos; não aguardar silenciosamente nem confundir recebimento com aprovação técnica.
- Durante a espera, executar as partes independentes já autorizadas, registrando atividade real, pendências e estimativa. Só a operação dependente fica bloqueada; nunca dispensar a validação ou inventar um ACK para avançar.
- Após validação, solicitar autorização de deploy aqui e notificar Root quando ela ainda for necessária. Se já houver autorização inequívoca e condicionada à passagem dos testes, registrar a satisfação das condições e publicar dentro do escopo aprovado, sem repetir o pedido.

Reconfirmação expressa do proprietário nesta sessão em 13/11/2026: “ASSIM QUE OS TESTES E A VALIDAÇÃO PASSAREM, SEJA AQUI OU NO COORDENADOR, O DEPLOY DESSAS ALTERAÇÕES JÁ ESTÁ AUTORIZADO!” Aplica-se às alterações UI-SIGN-001–012 em validação; não amplia o escopo para outras publicações.

## Precedência da ordem do proprietário e Executor opcional — 14/11/2026

Determinação explícita do proprietário nesta sessão Root. Esta seção prevalece sobre orientações anteriores conflitantes da política do projeto. Evidência integral: `_ops/coord-policy-owner-20261114/OWNER-INSTRUCTION.json`.

- **Executor61 é canal e revisor opcional, nunca voto, ACK ou revisor obrigatório.** Sua indisponibilidade, falta de resposta ou ausência de ACK não bloqueia planos autorizados, deploys, aquisições de reservas ou reconciliações. Permanece disponível quando o proprietário estiver remoto e quiser solicitar, autorizar ou acompanhar ações. Sua identidade e seu histórico são preservados.
- **A autorização explícita e autenticada do proprietário neste chat é suficiente.** Vale igualmente a decisão autenticada recebida no Vigia ou Executor, vinculada ao mesmo pedido. Não exigir autorização adicional do Executor ou repetir consentimentos já concedidos.
- **Precedência por plano/goal:** instruções, autorizações e recomendações explícitas do proprietário para um plano/objetivo específico prevalecem sobre regras administrativas conflitantes da política central do projeto, somente nesse escopo. Registrar decisão original, plano/goal, condições e substituições; não estender a outros objetivos. Recomendações orientam decisões e não autorizam custos ou escopos não aprovados.
- Quando o proprietário determinar **modo automático e sem novas permissões**, executar autonomamente as etapas e decisões necessárias ao plano autorizado, sem aguardar novas confirmações por rotina, ausência do Executor ou disponibilidade de um canal. Respeitar correções e revogações posteriores.
- Preservar condições expressas do plano: testes, integridade e proteção dos dados, limites financeiros e reservas contra operações concorrentes. A autorização não equivale a teste aprovado ou evidência técnica fabricada. Esta política regula o projeto e não altera instruções superiores da plataforma. Divergências administrativas devem ser corrigidas de acordo com a ordem original, sem impor uma nova votação ao proprietário.
- Registrar decisões, perguntas resolvidas autonomamente, evidências e resultados; comunicar andamento e conclusão neste chat e no Vigia. Agentes sem trabalho não ficam em polling LLM.
- No ledger, participantes registrados e revisores obrigatórios passam a ser projeções distintas. O evento auditável `reviewer_policy_changed` marca Executor61 como opcional sem apagar avisos, ACKs, atores, leases ou revisões passadas. Root e Apoio continuam distintos dos canais de autorização.

## Plano de infraestrutura — proprietário indisponível, 14/11/2026

Diretriz do proprietário recebida por repasse da sessão Infra `01a1d130-2948-7140-bcfb-34696b20ab8d` à sessão Root: “VOCÊ TERÁ QUE TOMAR AS DECISÕES POR CONTA PRÓPRIA, POIS EU NAO ESTAREI DISPONÍVEL PARA RESPONDER. AVISE ISSO AO COORDENADOR E DEMAIS AGENTES... APENAS REGISTRAR AS PERGUNTAS E DECISÕES”. Preservar a referência à mensagem original na sessão de origem.

- Executar automaticamente as etapas necessárias do plano de infraestrutura já aprovado, priorizando a conclusão da Civo e depois Azure e demais plataformas previstas. Não aguardar respostas do proprietário para escolhas operacionais dentro desse escopo.
- Registrar cada dúvida resolvida autonomamente, a decisão, o motivo, as evidências, o resultado e eventuais limitações em log/relatório. Enviar os resultados pelo chat e Vigia, em HTML legível para relatórios detalhados.
- Manter coordenação, reservas e revisão técnica entre agentes; Executor61 permanece opcional. Não converter uma revisão técnica em novo pedido genérico de autorização ao proprietário.
- Esta instrução não reativa frentes suspensas nem amplia o plano para GPU, Leaseweb ou alterações não aprovadas na aplicação/banco de produção. Instruções posteriores específicas do proprietário continuam prevalecendo no seu escopo.
- Não manter agentes ociosos em polling nem criar ciclos de confirmações. Aguardar eventos quando não houver trabalho autorizado.

## Infraestrutura — quatro marcos de entrega e disponibilidade real

Diretriz do proprietário repassada pela sessão Infra em 14/11/2026, complementar ao plano em execução. Emitir relatório HTML legível no chat e pelo Vigia a cada marco, sem confundir seus estados:

1. **Criação dos serviços por plataforma:** identificar recursos, região, configuração e resultado observado. A criação não demonstra instalação ou prontidão.
2. **Instalações e configurações:** informar ferramentas e serviços instalados, conexões e autenticações configuradas, verificações executadas e pendências.
3. **Ambiente pronto para desenvolvimento:** declarar prontidão apenas após qualificação; informar como acessar, como usar, escopo permitido, limites e evidências.
4. **Integração ao fluxo distribuído:** demonstrar tarefas/consumidores usando o recurso e registrar coordenação, roteamento e recuperação efetivamente integrados.

Avisar aos demais agentes responsáveis quando cada recurso se tornar realmente utilizável, com instruções operacionais de acesso e uso, sem enviar segredos. Um host criado ou com SSH funcionando não é automaticamente liberado para jobs. Não reativar trabalho suspenso nem manter polling de agentes ociosos. Registrar dúvidas, decisões e resultados no relatório de cada marco, preservando referências às evidências completas.
