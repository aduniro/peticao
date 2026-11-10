# Recuperação após recusa de autenticação antes da reserva

Base preservada:0d68c021b5c45ac71d28a1af0ed4adeba65933bd.
Nova worktree:/mnt/apps/peticao-final/_ops/r0002-govbr-gates-recovery-20261110.
O candidato anterior continua congelado com sua limitação; esta correção não
o modifica nem implica merge, deploy ou homologação integral.

## Correção mínima

O transporte atual já distingue401/authentication_required e403/stepup_required.
O rate-limit atual responde429 com erro em português, normalizado pelo cliente
para request_rejected. O controlador agora permite persistir estes três pares
exatos como recibo. Não aceita403/forbidden,403/request_rejected ou outro429.

Esse recibo NÃO prova ausência de reserva. A liberação continua exigindo um GET
exato posterior, autenticado como o mesmo ator, que retorne404/not_found. Enquanto
GET retornar403,401,429, conflito, pendente ou resultado incerto, a intenção
permanece. POST perdido seguido apenas de404 também não libera. Nenhum POST
é repetido automaticamente; novas tentativas dependem de ação deliberada.

Backend, autenticação, step-up, autorização, migração, textos e layout permanecem
iguais à base. Somente o reconhecedor de recibos e sua regressão são modificados.

## Prova local sem banco ou rede

Regressão inicial sobre a implementação0d68:5testes novos,1pass/4fail. Falham os
três gates e a restauração do recibo step-up. Após a correção:17/17 no conjunto
de transporte/controlador, incluindo os cinco novos. A execução final usa
ambiente limpo, fetch explícito fictício e guard que nega TCP/IPC, listener,
DNS, TLS, UDP e fetch global. Nenhum banco, Docker, provedor ou certificado foi
acessado. A simulação de reserva é um journal fictício retornado pelo transporte,
não prova uma transação PostgreSQL nova.

Node20.19.2 fixo:
/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node.
Dependências somente lidas do overlay existente. A tentativa inicial de CLItsx
com guard foi recusada pelo listener IPC do próprio CLI antes dos testes; log
preservado. O runner final usa o loader tsx diretamente, mantendo o guard sem
relaxamento. Typecheck estrito direcionado ao teste/helper e dependências
transitivas passou, sem cache incremental; não é typecheck completo do app.

Evidências locais sob:
/mnt/apps/peticao-final/_ops/r0002-govbr-gates-recovery-20261110/.qa.
Manifesto/cópia congelada da entrega serão registrados em:
/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/r0002-govbr-gates-recovery.

## Próximo ensaio HTTP/PG17 planejado, não executado nesta fatia

Usar fixture isolada e nonce/lease próprios, identidade PG17 confirmada pelo
host e serviço. Reaproveitar a estrutura de testes HTTP existente, sem banco real.

1. Expirar step-up antes do POST; conferir403stepup, zero intents/tentativas e
   zero chamadas ao validador. GET ainda negado mantém intenção. Renovar step-up;
   GET exato404 libera apenas o recibo reconhecido, sem POST automático.
2. Expirar sessão antes do POST;401auth, zero reserva. Reautenticar como o mesmo
   ator e repetir somente GET. Outro ator/colisão não deve produzir liberação.
3. Esgotar apenas o bucket fictício de rate-limit antes do POST;429, zero reserva;
   avançar o relógio controlado/aguardar exclusivamente na fixture, depois GET404.
4. Iniciar reserva real fictícia, perder a resposta e revogar step-up; GET403 e,
   após renovar, GETpending conservam a intenção e o mesmo attemptId. Uma chamada
   ao validador sintético no máximo por requestId; sem replay de mensagem externa.

Preservar as provas PG17 da base como evidência histórica, sem atribuir esses
novos cenários de gate a uma execução que ainda não ocorreu. Browser interativo,
build integrado e validação criptográfica real continuam fora desta entrega.
