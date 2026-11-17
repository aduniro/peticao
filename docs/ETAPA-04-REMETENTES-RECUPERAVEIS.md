# Etapa4 — remetentes com auditoria e remoção recuperável

08/11/2026, somente no candidato `candidate-stage02`. Cadastro já existente; não instala WAHA, não habilita transporte e não modifica os números reais configurados por ambiente no provedor.

## Alterações

- Criação, cifra vinculada ao ID, alteração e evento de auditoria usam a mesma transação. Falha de auditoria não deixa telefone parcialmente cadastrado nem estado sem evento.
- A conta Total ativa e seu e-mail são conferidos dentro da transação, após a trava7003 compartilhada com a gestão de contas. Página e rota exigem a confirmação extra existente. Autoria é identificada por conta; telefone completo e texto do rótulo não entram no evento.
- A trava também serializa o limite de20 remetentes não arquivados. Restaurar respeita o mesmo limite.
- Colunas aditivas `revision` (inteiro, padrão1) e `archived_at` (timestamp anulável). Registro existente começa na versão1 e não arquivado. Formulários enviam a versão lida; pedidos antigos não modificam o estado atual.
- “Remover” arquiva, preservando ID, cifra, rótulo, data e preferência anterior de ativo/pausado. Listas normais excluem arquivados; nada é apagado fisicamente. O catálogo não determina sozinho o número utilizado pelo transporte real.
- Biblioteca permite restaurar o mesmo registro, sob versão atual e auditoria. Enquanto AV-15 estiver pendente, a rota e a interface não expõem essa nova ação. Não declarar a interface de restauração concluída.

## Validação observada

Sete regressões passaram no PostgreSQL fictício: cifra e AAD, preservação/restauração, autoria revogada, rollback, capacidade concorrente, conflito da mesma versão e handler real com sessão/origem/confirmação extra. Assinatura fictícia preservada; nenhuma mensagem ou item de fila criado. Tipos passaram.

O ensaio de migração passou sobre a fixture antiga: definições anteriores, assinaturas, diagnósticos, históricos e cifras preservados; apenas as duas colunas declaradas do catálogo foram acrescentadas além das duas correlações de mensagens já previstas. Repetir o DDL e o bootstrap antigo conserva revisão, decisão de arquivar e microssegundos. Isso prova preservação do banco; um aplicativo antigo que não conhece `archived_at` pode voltar a listar o catálogo arquivado. Reversão operacional precisa preservar o filtro, e não pode ser declarada segura apenas pelo ensaio de DDL.

Suíte cumulativa, build e HTTP compilado/navegador estão em execução sequencial. Evidências privadas em `/home/barre/.cache/peticao-admin-mirror-qa/20261108/`: `stage02-senders-handler.log`, `stage02-senders-schema.log` e arquivos cumulativos datados. Não declarar os gates restantes aprovados antes de observar os resultados.

## Interface e continuidade

CSS e rótulos existentes preservados. A forma atual de conflito reutiliza “Remetente inválido.” até a aprovação do aviso específico AV-15. A confirmação extra redireciona para a tela existente; não cria outro texto de autenticação. A apresentação de arquivados/restauração e sua validação permanecem pendentes. Ainda não conclui a Etapa4 ou o painel completo. Nenhum deploy, merge ou escrita na VPS/revisão local de CPFs.

## Atualização posterior — AV15 aprovado e restauro consolidado

AV15 foi aprovado explicitamente, conforme `ADMIN-AVISOS-PARA-APROVACAO.md`.
O código herdado na cadeia local inclui rota/interface de Arquivados/Restaurar e
conflito aprovado. O ensaio atual deste candidato passou em390/1440px, no banco
fictício54349: arquivar, filtrar e restaurar o mesmo registro por formulário
nativo, preservando ID, cifra, data, estado e revisão. Também comprovou rollback,
confirmação extra/origem, versão obsoleta e conta revogada; zero exceções e nenhum
e-mail/WhatsApp criado. Relatório lido:
`/tmp/admin-consolidation-mt5_ik22/whatsapp-senders.json`. A migração estrita13
preservou catálogo e microssegundos. Nenhum WAHA ativado. Isso encerra este gate
de restauro do catálogo, não a Etapa4 inteira ou o admin-v2 completo.
