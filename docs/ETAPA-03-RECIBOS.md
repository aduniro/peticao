# Etapa 3 — identificadores de aceite dos provedores

Implementação no candidato, sem deploy. Conecta os recibos disponíveis ao campo opcional já existente `mail_message_attempts.provider_id`. Não cria tabelas, muda mensagens históricas, ativa arquivo de conteúdo ou altera avisos/interfaces.

## O que é capturado

| Transporte | Fonte do ID | Guarda |
|---|---|---|
| Brevo | JSON `messageId` após HTTP aceito | Campo textual validado; não arquiva resposta inteira. |
| MailerSend | Header `x-message-id` | Não tenta ler corpo em resposta 202. |
| SendPulse | JSON `id` | Mantém a checagem anterior de `result=false`; ID não transforma recusa em sucesso. |
| Mailrelay e presidente | ID inteiro do único item com e-mail igual ao destinatário principal | Conta/provedor atuais permanecem separados; ID da cópia não vira ID do principal. |
| SES por SMTP | Resposta `250 Ok <id>` de endpoint SMTP AWS | Apenas transporte `ses`; não usa Message-ID gerado localmente pelo Nodemailer. |
| SMTP genérico/dev | Nenhum | Não inventa ID a partir do nome do arquivo local ou de resposta sem contrato conhecido. |

O ID só identifica uma aceitação no transporte. Não prova entrega à caixa, leitura, clique ou confirmação da assinatura. Os eventos atuais por endereço continuam independentes: não são atribuídos a uma mensagem só por proximidade de horário/endereço.

## Comportamento de envio preservado

O sender pode continuar retornando void. Um recibo opcional, inclusive callback do principal antes da cópia separada do Mailrelay, acompanha o resultado da tentativa na mesma transação/auditoria já existente. Recibos conflitantes são descartados em vez de escolher um ID arbitrário.

Ausência, formato inválido, leitura quebrada, corpo excessivo ou prazo do metadado não disparam novo envio depois de HTTP aceito. O leitor de recibos Brevo/Mailrelay limita corpo a 16 KiB e um segundo; a checagem de resultado SendPulse conserva o fluxo anterior. Remetentes, guards, rodízio, canal de marketing, fila, singleAttempt e retorno público sent/queued são preservados.

Mailrelay continua enviando BCC separadamente. Se o principal foi aceito e a cópia falhou, conserva o ID conhecido do principal, mas o resultado do conjunto permanece indeterminado: não o promove a sucesso nem presume ausência de entrega. A política anterior de failover/retry público permanece; contato conserva tentativa única. Este checkpoint não resolve entrega parcial por destinatário nem promete exatamente uma entrega.

## Limites de correlação e recuperação

Novos recibos não recuperam IDs antigos ausentes. Se o processo cair antes de persistir o resultado, a tentativa preparada continua bloqueando repetição; o ID só visto em memória pode se perder. A recuperação operacional ainda precisa de evidência durável externa, sem liberar por tempo decorrido.

O próximo vínculo de eventos exige provedor, conta/escopo autenticado, destinatário e ID comprovados, recusando ambiguidades. Não assumir unicidade global de IDs numéricos entre contas, nem reutilizar eventos de uma credencial/conta diferente após mudança de configuração sem prova. Abrir/clicar é sinal técnico, não prova humana. Ainda faltam esquema/coletores de eventos individuais, consulta/interface, recuperação e demais etapas do plano.

## Fontes primárias

[Brevo](https://developers.brevo.com/reference/send-transac-email), [MailerSend](https://developers.mailersend.com/api/v1/email), [SendPulse](https://sendpulse.com/integrations/api/smtp), [Mailrelay](https://apidocs.mailrelay.com/tag/send-emails/POST/send_emails) e [respostas SMTP SES](https://docs.aws.amazon.com/ses/latest/dg/troubleshoot-smtp.html).

## Validação

Os testes usam os adapters reais com fetch/SMTP fictícios: campos/canais, IDs persistidos, metadado inválido após aceite, recusa SendPulse, falha parcial BCC, conflitos, legado void, fila/rodízio e ausência de cópia de credenciais/respostas completas pelos novos recibos. A primeira execução encontrou remetente de marketing ausente na fixture: foi acrescentado remetente fictício, preservando a guarda do app. Não houve chamada a provedor real ou leitura manual de chaves.

O HTTP compilado é exercitado com transporte dev, sem inventar ID externo; os formatos de provedores são verificados por documentação e mocks, não por envios reais. Logs em `/mnt/dev/peticao/.cache/admin-audit-20261106/stage03-receipts-*`. A integração integral, autorização de avisos/retenção e deploy continuam pendentes.

## Resultado final

**351/351 cumulativos**, oito testes novos (23 direcionados junto às regressões de cadeia/fila/adapters), build, tipos após build, sintaxe do roteiro e HTTP compilado aprovados. O HTTP usou um banco de QA novo em `candidate-receipt-preview-db`, preservando o banco da prévia anterior. Duas mensagens exclusivamente dev/fictícias, uma tentativa por mensagem, resposta duplicada recusada, IDs externos nulos em dev e assinaturas preservadas. Relatório `runtime-mail-receipts/mail-transport.json`.

Sessão de QA revogada, servidor temporário 3032 encerrado, prévia 3031 retomada com seu banco anterior; nenhum dado dessa prévia foi substituído pelo banco de QA. Não houve mudança de schema, interface/avisos, revisão de CPFs ou VPS. Isto certifica a captura de recibos no candidato; não a correlação completa de eventos nem envios reais por cada conta.


## Associação posterior inicial

`ETAPA-03-EVENTOS.md` descreve o escopo de conta e o primeiro journal ligado ao SES/SNS. O campo account_scope foi adicionado à tentativa; dados anteriores continuam nulos. A associação dos outros provedores ainda está pendente, apesar de os seus envios já capturarem escopo. Não reinterpretar o checkpoint de recibos como prova de entrega.
