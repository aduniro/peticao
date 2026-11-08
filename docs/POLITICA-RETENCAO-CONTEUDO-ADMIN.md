# Retenção de conteúdo do admin-v2

Decisão explícita do responsável em 08/11/2026: “Aprovo os textos e escolho 30 dias”, após pergunta sobre conteúdo de e-mails, anexos e rascunhos do admin-v2. Os 30 dias dizem respeito a esse conteúdo; metadados de auditoria são separados. Não é aprovação de textos públicos ou de deploy.

## Política aprovada

Conteúdo e anexos de e-mail e rascunhos administrativos devem ser protegidos, ficar indisponíveis após30dias e ter suas cópias operacionais excluídas pelo expurgo. Repetir um pedido, reabrir um rascunho ou reenviar não pode renovar silenciosamente a validade da mesma versão. Uma edição nova é outra versão identificada, com autoria e prazo próprios.

Preservar metadados necessários à auditoria, vínculo de mensagens e resultados do provedor, sem fabricar entrega ou repetir envio. O expurgo não remove assinaturas, CPF em hash, datas, inscrições, PDFs originais de lotes nem decisões da revisão local. Apagar uma cópia de anexo de e-mail não autoriza apagar o documento original da petição.

## Implementação e gates

A implementação em desenvolvimento limita o arquivo cifrado a 30 dias, inclusive chamadas internas antigas sem prazo. A leitura aplica também o limite por data de criação a registros antigos. Configurações de 90 dias ou permanentes são recusadas; ausência da variável continua gerando somente metadados. Para ativar o arquivo no deploy autorizado, configurar `MAIL_ARCHIVE_RETENTION=30`, conforme `deploy/admin-v2-runtime.example.conf`. Não alegar que o arquivo já está habilitado na VPS.

O agendador de fila chama o expurgo antes dos workers. Arquivo cifrado e cópias de corpo/anexos em `mail_outbox.payload` e `contact_replies.payload` são limpos na mesma transação com auditoria. Filas vencidas deixam de ser elegíveis para envio mesmo se a limpeza falhar. Uma confirmação externa iniciada antes do prazo pode concluir depois: registrar o resultado sem restaurar o corpo eliminado. Retenção não é só limpeza de `mail_messages`.

Destinatário, assunto já registrado no histórico de contato, autoria, IDs, datas, resultados e vínculos de auditoria permanecem como metadados. O contato original recebido pelo formulário não é uma cópia do e-mail enviado e não é alterado por este expurgo. Documentos originais da petição também são preservados. O expurgo remove os campos ativos no banco; não gerencia cópias de segurança nem o armazenamento do provedor externo. O conteúdo em envio de contato é reconciliado antes de se tornar elegível à limpeza em rodada posterior; a leitura do arquivo expirado é recusada desde o prazo.

Cinco regressões específicas, total de 35 direcionados e tipos passaram após corrigir a fixture de PDF para informar o tipo obrigatório de lote. A falha inicial está preservada em `content-retention-targeted.log`; repetição em `content-retention-targeted-retry.log`, na pasta privada de QA. Cobrem expiração, anexos, preservação de metadados/originais, bloqueio de transporte, resultado em andamento, idempotência e rollback completo. Nenhum DDL foi acrescentado neste bloco; o esquema de remetentes é o já ensaiado.

Minutas persistentes ainda precisam ser implementadas com o mesmo limite, versão e autoria. Cumulativa, build e teste do cron compilado serão conferidos antes de fechar este bloco; não declarar a retenção inteira concluída somente porque os testes de biblioteca passaram.

Somente ambientes fictícios podem habilitar o recurso durante o desenvolvimento. Preparar a configuração de produção para a publicação autorizada; não alterar `/etc/peticao/app.env` nem outros arquivos da VPS agora. As aprovações de AV-15 e retenção não aprovam os demais AVs.

## Consolidação observada no candidato de domínios —08/11

O contrato compilado de cron/prévia passou neste candidato, com fixture de tipo
`confirmacao` e apenas dados fictícios. Relatório atual lido:
`/tmp/admin-consolidation-mt5_ik22/content-retention.json`, saída0 no runner.
Comprovados autenticação, indisponibilidade lógica antes da limpeza, remoção de
corpos/anexos nas cópias operacionais, preservação de originais/metadados,
idempotência do expurgo e ausência de envio. Os cinco testes de biblioteca também
passaram na primeira cumulativa, que falhou em outros nove testes de ambiente;
a repetição cumulativa corrigida está em execução, sem presumir seu resultado.
Build/tipos deste candidato já passaram. Minutas persistentes/AV16 e tratamento
de backups/provedores permanecem fora desta comprovação. Detalhes e falhas
históricas preservados em `ETAPA-CONSOLIDACAO-CHECKPOINT-20261108.md`.
