# Etapa 3 — eventos por webhook autenticado e conta

07/11/2026. Implementação no candidato; não ativa/muda webhooks de provedores nem publica na VPS. Complementa os contratos SES/SNS e APIs. Não conclui a integração inteira.

## Autenticação e vínculo de conta

A guarda anterior `MAIL_WEBHOOK_SECRET` na URL continua obrigatória. O journal individual exige também autenticação própria e um escopo estático configurado no servidor:

| Provedor | Autenticação específica | Escopo configurado |
|---|---|---|
| Brevo | `BREVO_WEBHOOK_TOKEN`, header `Authorization: Bearer ...` | `BREVO_WEBHOOK_ACCOUNT_SCOPE` |
| MailerSend | `MAILERSEND_WEBHOOK_SIGNING_SECRET`, HMAC-SHA256 hexadecimal do corpo em `Signature` | `MAILERSEND_WEBHOOK_ACCOUNT_SCOPE` |
| SendPulse | `SENDPULSE_WEBHOOK_SIGNING_SECRET`, HMAC-SHA256 do corpo em `X-Signature: sha256=...` | `SENDPULSE_WEBHOOK_ACCOUNT_SCOPE` |

O escopo é o fingerprint HMAC da conta/credencial do envio, não a chave de API, um número de conta ou uma propriedade do payload. Não é calculado automaticamente a partir da chave atual: essa chave pode ter mudado de conta desde a configuração do webhook. Antes da ativação, o operador precisa confirmar a conta do webhook e obter o escopo dentro do processo autorizado no servidor, sem imprimir a credencial. Nenhuma leitura manual de segredos foi feita nesta etapa.

Sem escopo, mantêm-se os agregados anteriores, sem associação inventada a mensagens. Segredo específico configurado é sempre verificado. Escopo presente exige segredo de pelo menos 32 caracteres, distinto do segredo global; configuração incompleta/inválida responde 503 e não grava eventos. Escopo errado mas bem formado deixa fatos sem vínculo; nunca escolhe mensagens pelo endereço/horário. Rotação/troca de conta exige reconferir o vínculo, sem reatribuição retroativa.

## Formatos e datas

MailerSend v2 usa `data.message_id`, `data.recipient` e `created_at` da raiz; os IDs da atividade e do e-mail individual são diferentes. Os agregados continuam aceitando o formato anterior. Abertura/clique únicos recebem o mesmo tipo técnico correspondente, sem prometer contagem de pessoas.

Brevo usa `message-id`, `email` e `ts_event` em segundos UTC; não considera a data local sem fuso ou `ts_epoch` de envio como substitutos. SendPulse aceita os campos SMTP documentados `message_id`, `recipient`, `event` e `timestamp` em segundos. IDs numéricos seguros são representados em decimal. Sem ID/data/destinatário inequívocos, o journal ignora o evento. Comparação de IDs permanece exata: equivalência de representações/IDs diferentes entre transportes não é inventada e requer verificação própria antes de afirmar cobertura real.

Corpo é limitado a 200.000 bytes antes de analisar JSON; UTF-8 inválido, lote acima de 500 itens e itens que não sejam objetos são recusados. Destinatário ausente/malformado é ignorado sem gravar agregado, supressão ou journal. A assinatura cobre o corpo original, sem reserialização. Não se grava payload, links, IP, user-agent, assunto ou segredo no journal.

O ping de validação MailerSend pode usar a chave pública de teste documentada, exclusivamente para devolver confirmação inerte de `webhook.test`. Essa chave nunca autentica atividades, arrays com eventos ou mensagens. A guarda da URL continua exigida. Ping aprovado não prova configuração da conta ou entrega real de eventos.

## Falha e preservação

Em modo vinculado, falha do agregado ou journal devolve 503 para permitir repetição. Supressão já aplicada e fatos anteriores permanecem; a repetição não duplica o fato. O modo legado conserva seu tratamento anterior de agregados. Nenhum evento confirma uma assinatura nem altera fila, tentativas, IDs, inscrição ou datas do participante. Metadados administrativos continuam exigindo Edição e não expõem escopo/payload.

## Verificação e pendências

Onze regressões novas cobrem autenticação, bytes/UTF-8, parsers/datas/IDs, MailerSend v2 e compatibilidade, ping inerte, distinção de destinatário/conta, falha de auditoria/agregado, supressão e preservação de assinatura/fila fictícias. A primeira rodada de 25 verificações passou, assim como a primeira suíte cumulativa de 382 e o HTTP compilado. Na revisão posterior, o caso herdado de destinatário ausente/malformado foi corrigido antes do commit: esses itens não gravam agregado, supressão ou journal. Acrescentada a regressão específica e repetida a validação do código final; resultados abaixo.

Não há nova interface ou texto ativado. Ainda faltam configuração real e prova de conta/IDs, recuperação/retenção, conversas/editor e demais Etapas 2–7. Avisos e retenção pendentes não foram considerados aprovados.

## Fontes primárias

- [Brevo — formatos e tempos](https://developers.brevo.com/docs/transactional-webhooks) e [autenticação do webhook](https://developers.brevo.com/docs/secured-webhooks).
- [MailerSend — formatos v2, HMAC e ping](https://developers.mailersend.com/api/v1/account/webhooks).
- [SendPulse — assinatura do corpo](https://sendpulse.com/knowledge-base/app-directory/outgoing-webhooks) e [campos SMTP](https://sendpulse.com/knowledge-base/smtp/smtp-webhooks).


## Resultado final

**383/383 cumulativos**, onze regressões novas, build e tipos após build aprovados. O roteiro HTTP compilado exercitou Bearer/HMAC dos três provedores, MailerSend v2, corpo adulterado, ping inerte, destinatário da cópia, duplicação, descarte de destinatário inválido e leitura autorizada dos eventos. Uma assinatura confirmada e um item de fila fictícios, com IDs/hashes/datas/payload anteriores, permaneceram intactos. Nenhuma chamada a provedor real ou envio de e-mail nos testes.

Logs em `/mnt/dev/peticao/.cache/admin-audit-20261106/stage03-webhook-events-*`; relatório `runtime-mail-webhook-events/mail-webhook-events.json`. A primeira rodada de 382/build/HTTP está preservada com sufixo `before-recipient`; a rodada final inclui a correção do destinatário e a regressão nova. Usado banco de QA novo separado do primeiro ensaio e da prévia anterior, sem apagar nenhum deles. Sessão de QA revogada, temporário 3032 encerrado e prévia 3031 retomada com banco/configuração anteriores, /admin 200. Não houve alteração de schema, estilos, avisos, produção ou revisão local de CPFs. A configuração real das contas/IDs continua um gate explícito; estes testes não são prova de eventos emitidos por provedores reais.
