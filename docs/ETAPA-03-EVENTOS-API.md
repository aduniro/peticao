# Etapa 3 — eventos das APIs por mensagem

07/11/2026. Complementa `ETAPA-03-EVENTOS.md`; implementação no candidato, sem publicação ou nova interface. A integração completa do admin-v2 continua em andamento.

## Coleta e identidade

Brevo conecta os filtros autenticados de entrega/abertura/clique e devolução/bloqueio/reclamação ao journal. A identidade usa o `messageId` recebido e o escopo derivado da credencial efetivamente usada na consulta. MailerSend exige `email.message_id`; o `id` da atividade não é substituto. Preserva destinatário e data original, com fuso explícito. Não converte datas sem fuso segundo o relógio do servidor.

Mailrelay consulta as duas contas configuradas pelo mesmo contrato. O ID numérico do registro SMTP corresponde ao recibo do envio; `message_id` de cabeçalho não é usado como substituto. `delivered_at`, `bounced_at` e `soft_bounced_at` viram fatos separados. `processed_at`, `updated_at` e o booleano de spam não provam horário de entrega ou reclamação. Não ativamos coleta adicional de links/imagens para obter rastreamento.

O SendPulse conserva o agregado anterior por endereço. A lista SMTP documenta `send_date` como data do envio, não da entrega/devolução; não fabricamos um evento individual a partir dela, do horário da coleta ou apenas do código SMTP. O webhook por conta e a confirmação de seus campos ainda precisam de integração própria.

Dados sem ID, destinatário ou data inequívocos não entram no journal individual. Não forçamos vínculo por endereço/horário nem reconstruímos recibos antigos. Troca de chave altera o escopo, deixando eventos sem vínculo em vez de atribuí-los a outra conta. Isso pode reduzir cobertura após rotação de credenciais; não é prova de ausência de entrega.

## Páginas, falhas e preservação

Cada página grava primeiro seus agregados anteriores e a supressão; depois grava fatos mínimos em transações de até cem eventos. Falha de uma página/provedor não desfaz páginas anteriores nem interrompe os outros provedores. A próxima execução repete a janela e deduplica os fatos. Não há alteração de fila, política de reenvio, recibo, assinatura, inscrição ou confirmação.

Chamadas diretas dos coletores continuam devolvendo o mesmo array legado; o callback opcional é interno. O relatório existente mantém seu contrato. O journal não armazena corpo, link, IP, user-agent ou credenciais. As regras de associação e a auditoria atômica são as mesmas do primeiro fluxo SES.

## Diagnóstico somente leitura

Um diagnóstico pelas ferramentas existentes consultou apenas a estrutura dos retornos reais. Relatório privado: `.cache/admin-audit-20261106/provider-shapes-2026-11-07T04-29-18-251Z.json`. Ele registra flags/formato de datas/status; não guarda valores de mensagens, destinatários, IDs ou segredos. Não houve envio de e-mails ou alteração de contas.

Na amostra, Brevo e Mailrelay presidente tinham os campos necessários; MailerSend não expunha `email.message_id`; SendPulse não tinha data de entrega; Mailrelay integral estava sem registros. Uma amostra não prova cobertura de toda conta/histórico. Não extrapolamos um ID ausente nem consideramos a integração dos webhooks pronta.

## Validação e pendências

Nove regressões novas cobrem identidade/projeção, separação das contas, preservação de retorno, falha de página, deduplicação, falha de journal mantendo supressão/agregado, troca de chave e transações limitadas. A primeira rodada detectou um nome incorreto de tabela na fixture (`mail_queue` em vez de `mail_outbox`); foi corrigido. O teste de falha passou a usar o campo real `audit_log.event`. Logs iniciais preservados. Resultado final: **372/372 cumulativos**, nove novos (17 direcionados), build e tipos após build aprovados. O roteiro HTTP compilado confirmou autorização, eventos por mensagem, microdatas, repetição sem duplicação e preservação de uma assinatura confirmada e de um item de fila fictícios com dados anteriores. São fontes de API injetadas; o relatório não as apresenta como consultas reais. A primeira tentativa parou no guard de `DATABASE_URL` com `localhost`; a configuração de QA foi corrigida para `127.0.0.1`, mantendo a exigência. Relatórios/logs preservados em `stage03-api-events-*` e `runtime-mail-api-events/mail-api-events.json`. Sessão revogada, temporário 3032 encerrado e prévia 3031 retomada com banco e configuração fictícia anteriores. Nenhuma modificação de schema, estilos, avisos, produção ou revisão de CPFs.

Continuam no escopo: webhooks autenticados por conta, cobertura do MailerSend/SendPulse sem inferir IDs/datas, retenção de todas as cópias, recuperação operacional, conversas/editor, interface e Etapas 2–7. Nenhum aviso pendente foi considerado aprovado.

## Fontes primárias

- [Brevo — SMTP events](https://developers.brevo.com/reference/get-email-event-report)
- [MailerSend — activity](https://developers.mailersend.com/api/v1/email/activity)
- [Mailrelay — SMTP emails](https://apidocs.mailrelay.com/tag/smtp-emails/GET/smtp_emails)
- [SendPulse — SMTP API](https://sendpulse.com/integrations/api/smtp) e [OpenAPI público](https://api.sendpulse.com/.well-known/openapi/smtp.yaml)


Atualização posterior: o backend dos webhooks autenticados por conta está descrito em `ETAPA-03-EVENTOS-WEBHOOK.md`. Isso não comprova ativação real, equivalência de IDs entre transportes ou cobertura de todo o histórico. Mantêm-se os gates operacionais e as outras pendências acima.
