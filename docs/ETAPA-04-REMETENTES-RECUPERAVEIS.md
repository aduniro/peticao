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

Passaram **491/491 cumulativos**, build, tipos após build e HTTP compilado/navegador em390/1440px. O formulário nativo enviou a versão atual, pausou e arquivou sem apagar o registro. Verificados rollback de auditoria, operador rebaixado, sessão/origem/confirmação extra, conflito antigo, ausência de transbordamento/exceções e preservação de assinaturas, filas e ausência de transporte WhatsApp. O roteiro anterior de gestão de contas também passou nesse mesmo build.

Evidências privadas em `/home/barre/.cache/peticao-admin-mirror-qa/20261108/`: `stage02-senders-handler.log`, `stage02-senders-schema.log`, `stage02-tests-20261108T081600Z.log`, `stage02-senders-final-status.json` e `runtime-stage02-senders/whatsapp-senders.json`. Código `2135700`; runtime3033/54346 encerrado, prévia3031/Tailnet preservada. A restauração foi validada na biblioteca, mas ainda não tem interface ativa: AV-15 continua pendente.

## Interface e continuidade

CSS e rótulos existentes preservados. A forma atual de conflito reutiliza “Remetente inválido.” até a aprovação do aviso específico AV-15. A confirmação extra redireciona para a tela existente; não cria outro texto de autenticação. A apresentação de arquivados/restauração e sua validação permanecem pendentes. Ainda não conclui a Etapa4 ou o painel completo. Nenhum deploy, merge ou escrita na VPS/revisão local de CPFs.
