# Etapa 2 — mensagens individuais na triagem

07/11/2026. Implementação no candidato local, sem alterar interface, produção ou revisão de CPFs.

## Fontes e limites

A coleta consistente agora inclui metadados de até 20 mensagens transacionais de confirmação/reenvio criadas nos últimos 14 dias, 200 tentativas e 100 eventos vinculados. Uma linha adicional detecta truncamento; fonte ausente ou qualquer limite excedido mantém o diagnóstico inconclusivo. Usa os índices existentes, a mesma transação somente leitura, timeout e savepoint. Não há migração nova.

Não lê/descriptografa assunto, corpo, anexos ou payload. Não arquiva destinatário, remetente, recibo do provedor, escopo de conta, impressão do conteúdo ou erro livre. O vínculo ao contato é pelo endereço; isso não prova qual link/token está ativo, identidade ou confirmação da assinatura.

Eventos exigem associação `linked` e correspondência entre mensagem, tentativa finalizada aceita/indeterminada, provedor, conta, recibo e destinatário. Evento sem vínculo ou ambíguo não entra como evidência individual. Reconciliar um recibo ambíguo retira seu vínculo; a leitura seguinte reflete isso. Eventos antigos por endereço continuam separados.

## Diagnóstico e atualização

Aceite, entrega, abertura, clique, falha permanente, transiente e tentativa incerta têm códigos internos distintos. Abertura/clique não inventam entrega ou identidade. Entrega não confirma assinatura nem resolve automaticamente o contato. Entrega e falha da mesma mensagem exigem revisão; evento futuro/anterior à tentativa gera indicação de inconsistência temporal, sem alegar entrega. Essa checagem é conservadora diante de relógios divergentes; preserva o evento nos metadados para conferência.

O rodízio compara também a análise calculada com a análise arquivada: mudanças efetivas de contexto temporal ou da base pública de campus podem gerar revisão mesmo se os metadados forem idênticos. Revisões antigas sem a nova fonte são renovadas pelo mesmo fluxo. Mantém o motor atual e a atualização aditiva; não apaga versões anteriores, decisões humanas ou trabalho esgotado/de outro motor. Polling sem mudança continua estável.

## Escopo preservado

Novas evidências invalidam a prova de sugestão desatualizada. Nenhuma operação envia mensagens, consulta CPF-Brasil ou escreve assinaturas. Minutas humanas persistentes, curadoria, informes operacionais duráveis, conversas/editor, interfaces e demais etapas continuam no plano completo. AV-10 está aprovado; outros avisos pendentes não foram considerados aprovados. Deploy final depende de autorização.

## Verificação

Regressões cobrem projeção permitida, filtros, associação por conta/recibo/destinatário, ambiguidade, estados independentes, limites/fonte indisponível, novas revisões, prova desatualizada, preservação humana e transição temporal efetiva. O QA compilado percorre o cron e as APIs com mensagens fictícias, sem transporte externo. Resultados efetivamente executados constam no histórico do checkpoint.

Executado: 37/37 testes direcionados na primeira rodada; versão final com nove casos novos passou 414/414 cumulativos, build e typecheck serial. HTTP compilado comprovou projeção do journal, exclusão de evento de outra conta, invalidação da sugestão e nova revisão pelo cron com anterior preservada e polling estável. O contato da fixture HTTP não tem assinatura: não se alegou resolução por entrega; os testes de integração com assinatura fictícia cobrem permanência do estado pendente. Sessões de QA revogadas; nenhum transporte/provedor externo acionado. Logs `stage02-outbound-*.log` e `runtime-triage-outbound/triage.json` na cache de auditoria, fora do Git.
