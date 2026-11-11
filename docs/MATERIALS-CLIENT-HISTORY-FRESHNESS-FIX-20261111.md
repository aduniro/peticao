# Materiais — leitura iniciada após conflito

Checkout: `/mnt/apps/peticao-final/_ops/drafts/materials-client-20261111`; correção sobre o helper congelado em `dba5e83f995d158a242cb9aeba63873174075beb`. Nenhuma interface ou integração foi criada.

A revisão independente encontrou uma corrida: um GET de histórico podia começar antes do conflito do POST e terminar depois. Como o contador antigo avançava na conclusão, essa resposta antiga satisfazia a exigência de uma leitura nova. O backend continuava protegendo a gravação por CAS; o problema estava na promessa de revisão explícita do helper.

O gate agora usa a sequência de início dos pedidos de histórico. Ao receber um conflito, exige uma sequência maior que todas as leituras já iniciadas; somente uma leitura posterior concluída com sucesso satisfaz o gate. Contexto, UUID do pedido, texto local, CAS e separação entre recibo e head continuam preservados.

## Evidência

A nova regressão iniciou um GET antigo e um POST, resolveu o POST como conflito e só então liberou o GET antigo. No código anterior, os 27 testes existentes passaram e a nova regressão falhou. Com a correção, os 28 passaram, incluindo uma consulta nova que falha e não libera a revisão, outra consulta posterior bem-sucedida e uma nova ação explícita com revisão correta. Não há repost automático.

Typecheck estrito transitivo: 162 entradas, zero diagnósticos, sem imports Node ou Buffer no JavaScript cliente. O guard dos testes registrou zero tentativas de rede ou criação de processos. Não houve app, HTTP ou PostgreSQL real.

Provas preservadas em `/mnt/apps/peticao-final/_ops/drafts/materials-client-20261111/.cache/materials-client-history-freshness-fix-20261111/`: `red-result.json`, `red-stdout.log`, `red-network-proof.json`, `green-result.json`, `green-stdout.log`, `green-network-proof.json` e `typecheck.json`. As provas originais de preparação continuam separadas e não são atribuídas silenciosamente à fonte alterada.

Revisão que motivou a correção: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/materials-client-ro-20261111/REVIEW.md`.

## Limites

Falta revisão independente do patch, UI e transporte autenticado real. A pendência fica apenas em memória; reload perde esse estado. A resolução explícita de uma colisão de requestId na criação sem material selecionado continua pendente para o fluxo da futura interface. Nenhuma destas verificações é aceite da UI ou da aplicação integrada. Backend, renderer, HTML/CSS e fluxos bloqueados não foram alterados.
