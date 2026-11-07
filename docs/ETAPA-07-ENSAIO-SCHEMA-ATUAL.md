# Etapa 7 — ensaio atualizado do esquema

07/11/2026. Executado apenas no PostgreSQL fictício de loopback, porta 54341, em esquema temporário próprio. Nenhuma operação na VPS.

## Achado e correção

O roteiro `deploy/test/admin-schema-upgrade.mjs` ainda esperava nove tabelas administrativas adicionais. A execução contra o candidato atual falhou porque a tabela `mail_message_events` já é a décima. A suíte de aplicação não inclui esse roteiro; seu sucesso isolado não provava este gate de migração.

A lista exata foi atualizada, sem relaxar as verificações de colunas, esquema anterior, assinantes ou filas. Acrescentou-se um ensaio da fundação instalada antes de escopos de conta/eventos individuais: recibo antigo aceita a coluna nova como `NULL`, sem inferir conta nem fabricar entrega. Identidade, estado e horários com microssegundos são preservados. Depois, um evento vinculado fictício é preservado integralmente na reaplicação do DDL atual e do bootstrap anterior; os três índices de correlação existem após a atualização.

Continuam verificados o startup real sobre esquema antigo, reexecução do DDL, exatamente dez tabelas aditivas e duas colunas de correlação anuláveis nas tabelas antigas, preservação das definições anteriores, configurações, assinantes, fila, histórico de contatos/ações e mensagem da fundação sem Reply-To conhecido.

## Evidências e limites

Execução anterior com falha: `stage07-schema-current-before.log`. Primeira correção aprovada: `stage07-schema-current-after.log`. Rodada final, incluindo bootstrap anterior com eventos existentes: `stage07-schema-current-final.log`. Todos sob `.cache/admin-audit-20261106/`, fora do Git. O esquema temporário foi removido pelo roteiro.

Mudança restrita ao ensaio e documentação. Não altera DDL/aplicação, não repete build nem a suíte de 414 testes que já passaram sobre o mesmo código aplicativo. Não prova instalação root, compatibilidade com mudanças futuras na VPS, rollback de todos os módulos ou conclusão da integração. Nova conferência da produção e autorização final de deploy permanecem obrigatórias.
