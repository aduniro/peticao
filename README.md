# R0003 — revisão disjunta TERM durante cleanup + SWC256MiB

Raiz: /mnt/apps/peticao-final/_ops/r0003-cleanup-term-fix-20261111. Originais preservados: harness58cb9ce6d90cfb5f8b7fe456810948a4c99bb6f9 e adaptador938cd5667f307b7ac47950e1d493f19ff64feebb. Root autorizou esta correção e dono do harness confirmou ausência de alterações concorrentes. Lease própria fence33/seq714, sem token no artefato.

Problema: stop da unidade envia TERM a wrapper+harness; o wrapper reenvia TERM ao harness durante limpeza. Handlers anteriores levantavam exceções inclusive em pg.stop/export.

A revisão registra o estado de limpeza antes de drenar recursos. Primeiro sinal durante execução ainda cancela; sinais durante cleanup são contados sem interromper stop/socket/recibos, dentro do grace120s existente. Wrapper restaura handlers com finally e publica resultado negativo se recebeu cancelamento; harness retorna exit1 mesmo se o sinal chegar durante export. Identidade/ownership continuam obrigatórios e erros de limpeza não viram sucesso. Não há retry/replay ou novo executor.

Correção SWC expressamente solicitada: limite por membro de staging e digest da árvore staged passa128→256MiB. SHA e tamanho exatos de cada entrada continuam conferidos; o arquivo tar total conserva512MiB e pin integral. Os três testes do root foram copiados de /mnt/dev/.peticao-r0003-local-pg17-qa-20261111/attempt-2/test_staging_size.py, adaptando somente import frozen.staging→staging. Stream156809432B é hashado em blocos sem escrever bytes compilados; mismatch de tamanho e >256MiB seguem recusados.

Novos hashes são distintos dos originais58cb/c606: harness/harness-manifest.json e adapter/contract.json/core module estão repinados. FonteQA93557 e backendf555, registry e5inputs de fonte/deps/runtime não mudaram. Guards DNS/node/policy, NativePG, recursos e contratos RPC não mudaram.

Provas:33 fixtures do adaptador (31originais+2sinais) e46Python do harness (incluindo2sinais+3SWC) passaram. O bootstrap Node usa somente builtins dummy e nunca conecta; sua cópia tinha um require absoluto do dns_guard original, fazendo comparar WeakSets de instâncias distintas. Ajuste da fixture faz require do ROOTcopiado; nenhum guard foi relaxado. A primeira falha de relocalização foi preservada em evidence/tests-harness-initial-relocation-failure.log.

Comandos locais, diretório /mnt/apps/peticao-final/_ops/r0003-cleanup-term-fix-20261111:

```bash
/usr/bin/env PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/mnt/apps/peticao-final/_ops/r0003-cleanup-term-fix-20261111/harness /usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/r0003-cleanup-term-fix-20261111/adapter/tests -v
/usr/bin/env PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/mnt/apps/peticao-final/_ops/r0003-cleanup-term-fix-20261111/harness /usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/r0003-cleanup-term-fix-20261111/harness -v
```

Nenhum PG real, aplicativo, Docker, SSH, upload, instalação, integração ou deploy executado nesta revisão. AppReleaseReady=false. Os testes reais PG/rotas do root continuam separados e não são atribuídos aos novos pins. Instalação requer revisão/manifesto/ACK/lease existente.
