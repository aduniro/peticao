# Etapa 3 — associação de eventos e primeiro fluxo SES

07/11/2026. Implementação somente no candidato. Não conclui a integração do admin-v2 e não está publicada.

## Identidade e fatos

Adicionados `mail_message_attempts.account_scope` opcional e a tabela `mail_message_events`, chegando a dez tabelas administrativas aditivas. O escopo usa HMAC em domínio próprio; não armazena a credencial. Nos transportes de API ele identifica a credencial efetivamente usada; Mailrelay inclui host, SendPulse inclui ID/segredo. Troca de credencial muda o escopo: não atribui automaticamente eventos novos aos envios anteriores. O cache OAuth do SendPulse agora acompanha essa identidade e autentica novamente ao trocar credenciais.

SES usa tópico SNS autorizado + conta remetente. O evento exige `mail.sendingAccountId` e `mail.messageId`; não usa Message-ID de headers. O envio considera a conta do tópico como padrão ou `SES_SENDING_ACCOUNT_ID`, quando configurado para envio entre contas. Divergências ficam sem vínculo; não são corrigidas por proximidade de horário/endereço. Nenhuma configuração real foi lida ou modificada para isso.

Cada fato guarda apenas provedor, escopo, ID do provedor, destinatário, tipo, data original, data de recebimento e origem. Não copia payload, cabeçalhos, links clicados, IP, user-agent, CPF ou credenciais. A deduplicação usa tupla canônica com precisão de microssegundos. Não pretende contar toda interação humana: abertura/clique é sinal técnico.

A associação exige exatamente uma tentativa finalizada aceita/indeterminada com provedor, escopo, ID e destinatário iguais. Falta de identidade é ignorada pelo journal novo; zero candidatos deixa o fato sem vínculo e mais de um o torna ambíguo. Uma colisão posterior retira vínculos anteriores em vez de escolher o primeiro/último registro. Não altera nome, CPF, status, inscrição ou datas de assinatura, nem transforma entrega em confirmação.

## Concorrência, auditoria e falhas

Recepção e finalização com recibo compartilham trava transacional por schema. Fato pode chegar antes do resultado: fica sem vínculo e é conciliado na transação que grava o recibo. Datas/fatos originais não são reescritos. Associação e resultado são auditados atomicamente; falha de auditoria reverte ambos. As operações novas têm limite de espera/execução; falha após aceite continua conservando a incerteza anterior, sem liberar reenvio por tempo decorrido.

`handleSns` verifica tópico esperado e assinatura antes do journal. Supressão por devolução permanente/reclamação mantém o fluxo anterior. Se o journal novo falhar, a exceção chega ao HTTP 500 já existente para permitir retry do SNS; não desfaz um bloqueio já aplicado. A repetição não duplica o fato.

## Destinatário correto

Delivery usa os destinatários de `delivery.recipients`, conferidos no envelope. Entregar só à cópia não marca o principal como entregue. Open/Click com vários destinatários não identifica quem interagiu: não é atribuído a todos. O agregado legado foi ajustado para esse caso; conserva compatibilidade de Delivery antigo sem a lista específica, enquanto o journal novo exige dados completos. Nada reclassifica/apaga os agregados históricos por endereço.

O GET administrativo de metadados mostra até cem eventos vinculados da mensagem, com truncamento explícito e transação somente leitura. Não expõe escopo/fingerprint/payload. Ainda não há novos controles ou avisos de interface.

## Limites e gates restantes

Atualização posterior: a conexão das APIs está em `ETAPA-03-EVENTOS-API.md`. O parágrafo seguinte registra o limite do checkpoint b0ab46e.

Apenas SES/SNS está conectado ao journal nesta etapa. Coletores de API/webhooks dos demais provedores continuam com seus agregados anteriores; os respectivos envios já capturam escopo/ID para a conexão seguinte. Não fabricar vínculo com logs antigos sem identidade.

Antes de qualquer deploy, conferir configuração real do tópico/conta e a política SNS/IAM que restringe publicação ao SES esperado: assinatura do SNS prova publicação pelo SNS, não substitui a política de quem pode publicar no tópico. Não criar/confirmar assinaturas SNS ou publicar testes na AWS automaticamente. Recebimento de conversas, recuperação operacional, retenção, interfaces/editor e demais Etapas 2–7 continuam pendentes. AV-1–AV-9 permanecem sem aprovação inferida.

## Validação e fontes

Doze testes novos cobrem escopos, microdatas, duplicação concorrente, recibo tardio, colisões, conta/provedor/destinatário, falhas/rollback, autenticação, pipeline de envio SES e migração com fila/assinatura fictícia preservadas. A primeira falha foi uma comparação json/jsonb na fixture, corrigida sem relaxar os critérios. Vinte e oito testes direcionados incluem também recibos/rollback/SNS anteriores.

`tools/admin-qa/mail-events.mjs` exercita leitura/autorização no HTTP compilado e rejeição de envelopes não confiáveis. O caso positivo usa a chave/certificado fictícios pela dependência de teste do helper de origem; não é notificação real da AWS nem bypass no servidor HTTP. Os logs ficam em `/mnt/dev/peticao/.cache/admin-audit-20261106/stage03-events-*` e relatório em `runtime-mail-events/mail-events.json`.

Fontes primárias dos campos/destinatários: [eventos SES/SNS](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html) e [notificações SES](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html).

## Resultado do checkpoint

**363/363 cumulativos**, doze novos (28 direcionados), build, tipos após build e roteiro HTTP compilado aprovados. A migração recriou os objetos novos sobre a família anterior, mantendo a assinatura fictícia (ID/inscrição/hash/consentimento/datas), fila/payload/data, mensagens, tentativas e auditoria; escopos anteriores permanecem nulos, sem atribuição retroativa de conta. Os testes do rollback antigo foram adaptados só para remover a tabela dependente ao montar o schema legado/fragmentado da fixture; o guard não foi relaxado.

O relatório `runtime-mail-events/mail-events.json` distingue explicitamente rejeições HTTP compiladas do caso positivo com certificado fictício pelo helper. Nenhuma notificação real foi publicada na AWS e nenhuma credencial real foi consultada manualmente. A sessão de QA foi revogada, o servidor temporário 3032 encerrado e o banco de QA separado preservado em `candidate-events-preview-db`. Prévia 3031 retomada com o banco anterior. Não houve deploy, alteração de textos/interfaces, produção ou revisão local de CPFs.
