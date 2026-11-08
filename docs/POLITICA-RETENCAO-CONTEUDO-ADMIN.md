# Retenção de conteúdo do admin-v2

Decisão explícita do responsável em08/11/2026: “Aprovo os textos e escolho30dias”, após pergunta sobre conteúdo de e-mails, anexos e rascunhos do admin-v2. Os30dias dizem respeito a esse conteúdo; metadados de auditoria são separados. Não é aprovação de textos públicos ou de deploy.

## Política aprovada

Conteúdo e anexos de e-mail e rascunhos administrativos devem ser protegidos, ficar indisponíveis após30dias e ter suas cópias operacionais excluídas pelo expurgo. Repetir um pedido, reabrir um rascunho ou reenviar não pode renovar silenciosamente a validade da mesma versão. Uma edição nova é outra versão identificada, com autoria e prazo próprios.

Preservar metadados necessários à auditoria, vínculo de mensagens e resultados do provedor, sem fabricar entrega ou repetir envio. O expurgo não remove assinaturas, CPF em hash, datas, inscrições, PDFs originais de lotes nem decisões da revisão local. Apagar uma cópia de anexo de e-mail não autoriza apagar o documento original da petição.

## Implementação e gates

A fundação já aceita retenção explícita de30dias e recusa leitura de conteúdo expirado. Ainda é necessário ligar o expurgo ao agendador e cobrir as cópias de conteúdo em filas/respostas; a retenção não se resume à limpeza de `mail_messages`. Minutas persistentes devem usar o mesmo limite, com versão e autoria. Testar expiração, preservação de metadados, bloqueio de transporte de conteúdo expirado, ausência de renovação por retry, rollback e migração.

Somente ambientes fictícios podem habilitar o recurso durante o desenvolvimento. Preparar a configuração de produção para a publicação autorizada; não alterar `/etc/peticao/app.env` nem outros arquivos da VPS agora. As aprovações de AV-15 e retenção não aprovam os demais AVs.
