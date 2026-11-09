# Etapa 6 — recuperação de rejeições conclusivas

Estado: **continue**, código implementado e em validação integrada.
Base de conciliação/AV17 `f549418`; preparo/auditoria corrigidos pelo principal em
`fdc77b2`. Não interpretar estes commits como conclusão do módulo integral.

## Contrato implementado

Um novo código humano pode recuperar somente destinatários comprovadamente não
enviados do mesmo documento já congelado. Não substituir aprovação original,
documento, lista, hashes, primeiro aceite ou suas datas. Destinatários vêm da
auditoria original, nunca da configuração posteriormente alterada.

A conferência transacional exige a nova reserva, uma auditoria original compatível,
rodada finalizada/auditada e identidade/fingerprint exatos no journal. Tentativa
ativa, resultado incerto, divergência ou lote legado sem prova bloqueiam tudo.
Aceite anterior será sempre excluído dos alvos de recuperação. Rejeição exige
tentativas finalizadas exclusivamente rejeitadas; falta de admissão só pode ser
aceita quando o protocolo novo prova que nenhum transporte chegou a ser iniciado.

O novo código é consumido com auditoria e latch de rodada em transação curta,
sem manter banco aberto durante transporte. A mesma identidade de mensagem e
`singleAttempt:true` preservam tentativas anteriores e expiração do conteúdo.
Nova rodada não significa que incerteza esteja autorizada para reenvio. Sem schema
aditivo neste bloco; nenhum banco de produção alterado.

Reserva de retry muda somente status/código, conservando approved_by/approved_at
originais; seu evento é `batch_retry_approved`, separado de `batch_approved`.
Status `prepared` com aprovação existente bloqueia outra admissão enquanto a
rodada está em aberto. O sender conserva Reply-To observado, inclusive ausência,
mesmo após mudar o default. A opção interna de envelope congelado não remove
guardas de origem, destinatário, supressão, provedor dev ou journal.

## Evidências anteriores preservadas

Preparo: nova regressão em `batches.test.ts` reproduziu `prepared` após falha de
auditoria em `/tmp/admin-consolidation-hviz2j6p/validation.log`: 22/23, uma falha.
Correção é do principal; seu relatório e commit têm evidências específicas.

Conciliação sem transporte/AV17 passou 22 testes, build/tipos e HTTP em `f549418`.
Os testes novos deste bloco usam apenas documentos fictícios, códigos gerados por
mail dev e journal com rejeição fictícia explícita, sem contato com provedor real.
`--document-tests`: **27/27**, saída0 em
`/tmp/admin-consolidation-6of9k7h8/validation.log`; com rollback/revogação da nova
admissão: **28/28**, saída0 em `/tmp/admin-consolidation-z_qvvcrb/validation.log`.
Após preservar Reply-To original: **28/28**, saída0 em
`/tmp/admin-consolidation-b74pusm7/validation.log`. Cópias dos logs em
`.cache/qa-batch-rejection-20261108/`, fora Git.

Os casos conferem duas aprovações concorrentes, mesma identidade de mensagem com
tentativas rejeitada/aceita preservadas, novo código obrigatório, conservação de
aprovação/documento original, exclusão de aceite anterior, ignorar destinatário
novo da configuração, bloqueio de incerteza, rollback de auditoria/revogação e
retry depois de expurgo real sem renovar conteúdo/prazo. Nenhum transporte real.

Uma sessão de tipos (`42192`) ficou sem saída/término observado. Principal e pgrep
externo confirmaram ausência de helper/tsc ativo; não foi considerada aprovação.
Repetição de tipos saída0. Seleção integrada com o teste ICP estrito do principal
(`2ee972f`, evidência `2225603`): **30/30**, saída0 em
`/tmp/admin-consolidation-4gpg92jx/validation.log`, copiado como `30-tests.log`.
Build saída0 (helper `verify_admin_candidate.py build`, sessão38139); captura em
`.cache/qa-batch-rejection-20261108/build.log`. Tipos pós-build saída0.
HTTP compilado `--contracts batch-reservation batch-reconciliation` saída0 em
`/tmp/admin-consolidation-ofnlt1hy/validation.log`, ambos JSON positivos.
O contrato adicional comprova uma rejeição fictícia explícita no journal,
exige novo código humano, concorre dois POST com um único aceite dev, conserva
aprovação original e identidade/tentativas, sem repetir o aceite anterior.

Ensaio de schema pelo principal saída0 em
`/tmp/admin-root-schema-bef4gtli/validation.log`: fixtures dos schemas06/11 e
diagnósticos07/11, preservando assinaturas/logs/filas/configuração. Cópia do log
em `.cache/qa-batch-rejection-20261108/schema.log`. Nenhum schema aditivo neste bloco.
Logs/JSON HTTP copiados no mesmo diretório. Commit identificado no checkpoint seguinte.

Próxima lacuna independente: autoria da criação manual pela rota `criar`; manter
o caminho do agendador distinto e revalidar o Total real transacionalmente.
Persistência de snapshot/recuperação de preparo interrompido ainda não concluída.

Cumulativa **534/534** se refere exclusivamente ao snapshot `8436fa2`, conforme
`f5e16c8`; três falhas iniciais por geo-data ausente na cópia foram preservadas e
resolvidas com dependência pública. Não atribuir essa cumulativa a este código.

AV9/11/12/16 continuam pendentes; AV17 é o único aviso novo aprovado. Nenhum envio
real, publicação nominal, promoção de decisões locais, CPF, outro worktree ou VPS.
