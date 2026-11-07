# Etapa 2 — sugestão vinculada à triagem

07/11/2026. Backend local, sem publicação ou conexão com a interface.

## Contrato

`GET /api/admin/contato/minuta?contato=<id>` exige Edição e gera assunto/corpo por regras (`contact-reply-rules-v1`). Não usa LLM, não salva minuta, não escolhe retenção e não envia e-mail. A resposta indica revisão humana obrigatória; dúvida e erro exigem complementação. Saudação e assinatura continuam a cargo do compositor existente.

`POST /api/admin/contato/minuta` recebe exclusivamente `{contato, proof}` e confere novamente o contexto. Não recebe texto editado ou comando de envio. Ambas as operações usam transação consistente somente leitura, limite de tempo e resposta sem cache. O POST também limita o corpo a 1.024 bytes.

## Atualidade e separação de permissões

Só a revisão mais recente, concluída no motor atual, pode originar sugestão. Entrada, evidências e análise precisam corresponder à coleta atual; contexto alterado, pendente ou incompatível é recusado. Confirmação futura inconsistente também é recusada. A prova opaca vincula contato, revisão, motores e impressões HMAC; restaurar o texto antigo depois de outra revisão não revalida a prova anterior.

Essa prova não autentica o solicitante, não confirma identidade, não valida texto editado e não substitui o selo de envio. O fluxo existente de resposta conserva Total, confirmação extra, prévia do mesmo texto e reserva durável. O endpoint novo não altera esse fluxo.

## Limites e continuidade

A sugestão é derivada das fontes atuais da triagem, sem promessa de que uma ação foi executada ou mensagem entregue. Rascunhos humanos persistentes, editor, novas fontes individuais, curadoria e interface continuam pendentes. Nenhum texto novo foi ativado na interface. AV-10 foi aprovado expressamente; demais avisos pendentes e autorização final de deploy continuam separados.

## Verificação

Casos de regressão cobrem categorias, leitura sem escrita, revisões novas, evidências e análise alteradas, contato diferente, motor incompatível, parâmetros, autorização e separação do envio. O roteiro compilado também verifica que restaurar a entrada não revive prova antiga e que nem uma conta Total com confirmação extra pode usar essa prova como selo de envio. Resultados efetivamente executados são registrados no histórico do checkpoint.

Executado: 405/405 testes cumulativos, build, typecheck serial e HTTP compilado aprovados. O QA usou banco isolado e dados fictícios, revogou as sessões e não gravou assinaturas nem enviou mensagens a participantes. Evidências locais: `.cache/admin-audit-20261106/stage02-suggestion-*.log` e `runtime-triage-suggestion/triage.json` (fora do Git). Não equivale a validação de interface ou publicação.
