# Etapa 3 — recuperação operacional de filas com aceite

Implementação somente no candidato, sem nova interface ou deploy. Complementa o guard de rollback com uma ação normal autenticada, por item, sem chamar transporte.

## Contrato

`GET /api/admin/emails/recuperacao?id=<id>` diagnostica a elegibilidade em transação somente leitura. `POST` recebe apenas `{ "id": 123 }`. Ambos exigem Total e confirmação extra; a escrita confere novamente usuário ativo, nível e identidade no banco. O autor vem da sessão, nunca do corpo. A resposta não devolve destinatário, corpo, fingerprint, segredo ou payload.

A conclusão exige vínculo com a mesma mensagem, categoria transacional, tipo, destinatário, fingerprint do envelope/conteúdo e Reply-To congelado. Mensagem precisa estar aceita e ter tentativa finalizada com aceite; tentativa ainda aberta impede a ação. Evento de entrega ao principal não prova aceite do envelope inteiro, incluindo cópias, e não libera um resultado indeterminado. Ausência de registro ou tempo decorrido também não são prova.

A ação muda somente status da fila para `sent`, limpa seu erro e preenche `sent_at` ausente com o horário original da tentativa aceita, preservando microssegundos. Não muda payload, ID, mensagem vinculada, contagem de tentativas, criação, agendamento, recibos, eventos, assinatura ou seus horários. Item já concluído não é regravado. Filas legadas sem vínculo ou conteúdo divergente permanecem inalteradas. Não existe ação de reenvio, liberação de incerteza ou veredito manual neste endpoint.

## Concorrência e auditoria

Ordem de trava: usuário, mensagem e fila. Finalização/transporte não segura a fila durante chamada externa. O worker agora só atualiza itens ainda pendentes: sucesso/falha atrasados não sobrescrevem uma conclusão feita em paralelo. Isso preserva a política anterior de backoff/idade/failover dos itens que continuam pendentes.

Conclusão e auditoria do autor/prova são atômicas; falha da auditoria reverte a alteração. Operação não marca mensagem como entregue e não incrementa tentativa, pois não ocorreu envio. Um resultado HTTP perdido pode ser consultado/repetido sem reaplicar a mudança.

## Validação

Seis testes novos cobrem prova, preservação de dados, microdatas, concorrência, rollback de auditoria, worker atrasado, autorização/origem e entrega individual insuficiente. Primeira rodada: 17/18; falha no cabeçalho Host da fixture de requisição, corrigido sem relaxar o gate. Logs iniciais preservados. A versão final passou **389/389 cumulativos**, seis regressões novas, build, tipos após build e HTTP compilado. O roteiro compilado exigiu Total/stepup, comprovou data original com microssegundos, idempotência, autoria, preservação de payload/tentativas/mensagens/assinatura e ausência de conteúdo na resposta. Nenhum transporte ou provedor real foi chamado. Evidências em `stage03-mail-recovery-*` e `runtime-mail-recovery/mail-recovery.json`, sob `/mnt/dev/peticao/.cache/admin-audit-20261106/`. Sessão fictícia revogada, temporário 3032 encerrado, banco de QA novo preservado separadamente e prévia 3031 retomada com seu banco/configuração anteriores (/admin 200). Nenhuma alteração de schema, interface ou produção.

## Pendências e interface

O diagnóstico não resolve automaticamente tentativas interrompidas sem prova, conteúdo perdido ou cópias incertas. Retenção, conversas/editor, interface da recuperação e demais Etapas 2–7 continuam no objetivo. Não houve alteração da revisão local de CPFs ou da VPS. AV-10 foi submetido ao dono antes de ativar botão/aviso, conforme sua regra, e aprovado explicitamente em 07/11/2026 (“Aprovar estes textos”). Apenas esses dois textos foram aprovados; a interface ainda precisa ser integrada e validada. Retenção e avisos anteriores continuam pendentes.

## Complemento08/11 — repetição após retenção e limites HTTP

Corrigida a consulta/repetição de fila já `sent` após o payload ter sido apagado
pelo expurgo30dias. Identidade ainda é conferida; reconhecer conclusão existente
não restaura corpo, não escreve outro evento nem cria prova de entrega. Filas
pendentes/failed sem conteúdo exato continuam sem elegibilidade. POST limitado a
256bytes antes do JSON; GET indisponível retorna503 sem detalhes internos.
45 direcionados, build/tipos e HTTP compilado com expurgo real/repetição
concorrente aprovados. Contrato, logs, hashes e limites em
`ETAPA-03-CENTRAL-CONTINUIDADE-20261108.md`. AV11/AV12 ainda não aprovados;
interface não conectada, sem envio ou VPS.
