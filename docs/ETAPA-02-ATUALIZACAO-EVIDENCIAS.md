# Etapa 2 — atualização de diagnósticos por evidência

07/11/2026. Implementação somente no candidato. Resolve a atualização de revisões diante de mudanças nas fontes já coletadas; não conclui minutas, curadoria de campus, interfaces ou o plano inteiro.

## Comparação e limites

O coletor existente mantém o snapshot consistente e os campos permitidos. O comparador usa HMAC em domínio próprio, com chaves JSON ordenadas: a ordem de propriedades do JSONB não vira mudança. Não copia texto livre do contato. A hora da coleta é ignorada; a transição efetiva de expiração de link de um cadastro pendente é considerada. Link antigo de cadastro confirmado não dispara revisão apenas por vencer.

O processo compara o input do contato e as evidências permitidas do último diagnóstico concluído. Mudanças no cadastro, log de envio, eventos negativos por endereço, supressão ou contagem da fila podem gerar nova revisão. A consulta continua limitada às fontes/janelas do coletor atual. Novos eventos individuais positivos e mudanças nas bases estáticas de campus precisam de integração própria; não afirmar que todas as fontes possíveis já são observadas.

Não há consulta à API CPF-Brasil, SSH, busca externa ou envio. CPF/hash do CPF, nascimento, mãe, sexo, token de confirmação e payload de e-mail não são acrescentados aos snapshots.

## Agendamento e preservação

O cron autenticado mantém a descoberta/processamento atuais e usa o orçamento restante, verificado entre itens, para conferir até dois diagnósticos em rodízio. Não é promessa de atualização instantânea de todo o backlog. A chamada usa os timeouts de banco do coletor; um item em andamento pode consumir seu timeout antes da próxima verificação do orçamento.

O cursor operacional fica em `settings.contact_triage_refresh_cursor`, sem alterar preferências do painel. É reservado em transação curta; queda após avançar pode adiar uma leitura até a próxima volta, sem apagar revisão. Falhas de coleta incrementam um contador seguro, sem persistir a exceção livre. Uma fonte explicitamente indisponível continua evidência incompleta, não prova de ausência de problema.

Só se reabre a última revisão concluída do motor atual. Trabalho ativo, esgotado ou de outro motor não é reiniciado automaticamente. Antes de enfileirar, trava-se o contato e confere-se novamente input e ID/status da última revisão: reanálise manual/concorrente mais recente vence a leitura antiga. Há uma única revisão ativa por contato. A nova revisão identifica `system:evidence-refresh`; revisão anterior e decisões/respostas humanas permanecem intactas.

Reserva e auditoria são atômicas. Falha de auditoria reverte o novo pedido; o próximo ciclo pode tentar novamente. O worker continua coletando dados atuais antes de produzir a análise. Alteração durante essa coleta segue o contrato anterior de input/lease; eventos concorrentes posteriores ao snapshot são percebidos em rodada futura. Não se afirma que um resultado seja eternamente atual.

## Verificação atual

Sete testes novos cobrem comparação canônica, relógio/expiração, polling sem mudança, evento novo, confirmação posterior, concorrência/manual, falha/auditoria e rodízio sem reabrir esgotados. A primeira rodada direcionada passou 22/22. A versão final passou **398/398 cumulativos**, incluindo o caso que verifica explicitamente a proteção contra um pedido manual mais recente. Build, tipos após build e HTTP compilado também passaram. No HTTP, evento fictício disparou nova revisão pelo cron autenticado; a versão anterior foi preservada e rodada sem mudança não criou revisão extra. Sessão de QA revogada, temporário 3032 encerrado, banco de QA novo preservado separadamente e prévia 3031 retomada com banco/configuração anteriores (/admin 200). Logs `stage02-refresh-*` e relatório `runtime-triage-refresh/triage.json` sob `/mnt/dev/peticao/.cache/admin-audit-20261106/`. Nenhum schema, interface, VPS ou revisão local de CPFs alterado.

O roteiro `tools/admin-qa/triage.mjs` foi ampliado para exigir cache CPF vazio no banco fictício, injetar evento de metadados, atravessar o cron autenticado e verificar revisão nova/preservação da anterior e estabilidade da rodada seguinte. Não usa transporte, dados reais ou revisão SQLite local.

## Pendências preservadas

Minutas humanas, vínculo de minuta à revisão atual, curadoria de campus, informe operacional durável ao dono e integração visual AV-8 continuam pendentes. Também faltam retenção, conversas/editor, demais interfaces e Etapas 3–7. AV-10 está aprovado; AV-11/AV-12 e avisos anteriores não tiveram aprovação inferida. Nenhuma interface nova foi ativada neste bloco; deploy final depende da autorização do dono.
