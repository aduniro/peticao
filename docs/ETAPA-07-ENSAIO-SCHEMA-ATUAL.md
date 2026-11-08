# Etapa 7 — ensaio atualizado do esquema

07/11/2026. Executado apenas no PostgreSQL fictício de loopback, porta 54341, em esquema temporário próprio. Nenhuma operação na VPS.

## Achado e correção

O roteiro `deploy/test/admin-schema-upgrade.mjs` ainda esperava nove tabelas administrativas adicionais. A execução contra o candidato atual falhou porque a tabela `mail_message_events` já é a décima. A suíte de aplicação não inclui esse roteiro; seu sucesso isolado não provava este gate de migração.

A lista exata foi atualizada, sem relaxar as verificações de colunas, esquema anterior, assinantes ou filas. Acrescentou-se um ensaio da fundação instalada antes de escopos de conta/eventos individuais: recibo antigo aceita a coluna nova como `NULL`, sem inferir conta nem fabricar entrega. Identidade, estado e horários com microssegundos são preservados. Depois, um evento vinculado fictício é preservado integralmente na reaplicação do DDL atual e do bootstrap anterior; os três índices de correlação existem após a atualização.

Continuam verificados o startup real sobre esquema antigo, reexecução do DDL, exatamente dez tabelas aditivas e duas colunas de correlação anuláveis nas tabelas antigas, preservação das definições anteriores, configurações, assinantes, fila, histórico de contatos/ações e mensagem da fundação sem Reply-To conhecido.

## Evidências e limites

Execução anterior com falha: `stage07-schema-current-before.log`. Primeira correção aprovada: `stage07-schema-current-after.log`. Rodada final, incluindo bootstrap anterior com eventos existentes: `stage07-schema-current-final.log`. Todos sob `.cache/admin-audit-20261106/`, fora do Git. O esquema temporário foi removido pelo roteiro.

Mudança restrita ao ensaio e documentação. Não altera DDL/aplicação, não repete build nem a suíte de 414 testes que já passaram sobre o mesmo código aplicativo. Não prova instalação root, compatibilidade com mudanças futuras na VPS, rollback de todos os módulos ou conclusão da integração. Nova conferência da produção e autorização final de deploy permanecem obrigatórias.

## Complemento posterior — curadoria de campus

O bloco descrito em `ETAPA-02-CURADORIA-CAMPUS.md` acrescenta `contact_campus_reviews`: o esquema atual passa a **11 tabelas aditivas**. O mesmo roteiro foi atualizado e passou novamente em `stage02-campus-schema.log`, preservando todas as exigências anteriores. Agora também cria duas decisões fictícias encadeadas e comprova preservação integral de propostas, autoria, vínculo anterior e horários com microssegundos após repetir DDL atual e bootstrap anterior. Não alterou assinaturas ou journal de mensagens. O resultado histórico de dez tabelas acima corresponde ao checkpoint 72ec622, não ao esquema acrescido posteriormente.

## Complemento posterior — quota durável de IA

O executor descrito em `ETAPA-05-EXECUTOR.md` acrescenta `admin_ai_requests`: agora são **12 tabelas aditivas**. O roteiro atualizado passou em `stage05-executor-schema.log`. Uma tentativa fictícia incerta conserva UUID, conta, reserva de quota, estado e horários com microssegundos após reaplicar DDL atual e bootstrap anterior. Nenhuma geração é disparada pelo ensaio. Permanecem as verificações de assinantes, journal, curadoria e definições anteriores. Não prova publicação na VPS ou consumo de um provedor real.

## Complemento08/11 — intenção de indicação

`admin_referral_requests` é a13ª tabela aditiva. No candidato
`candidate-stage02-domains`, o comando independente
`/usr/bin/python3 /mnt/dev/peticao/tools/monitor/verify_admin_candidate.py schema`
passou nesta continuidade, com saída0. Preserva conta, UUID, fingerprint, referência
do código e timestamp com microssegundos após DDL atual e bootstrap anterior.
A lista exata de13 tabelas continua estrita; não foi substituída por contagem mínima.

Também passaram as provas anteriores de diagnósticos, journal, quota, curadoria,
histórico e originais. O catálogo de remetentes mantém cifra, identidade, estado
pausado, revisão e decisão de arquivar; só as duas colunas aditivas declaradas
(`revision`, `archived_at`) são admitidas além das correlações já previstas.
Restauro na aplicação exige sua própria prova HTTP/navegador; reaplicar DDL antigo
não prova que o aplicativo antigo respeita o filtro de arquivados.
Somente PostgreSQL fictício54349; nenhuma leitura ou escrita na VPS.
