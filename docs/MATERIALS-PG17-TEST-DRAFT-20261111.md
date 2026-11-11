# Materiais — nove testes PostgreSQL17 aprovados em fixture isolada

Teste: `/mnt/apps/peticao-final/_ops/drafts/materials-library-20261111/site/src/lib/materials-store.pg.test.ts`, commit `7b7bff946022ef54a0c0b808fe4418d5f6e7473d`. Backend `c02bfaca9def79d01d02ada4bbd5c9738bf443b9`, derivado de f555. Nenhuma fonte funcional foi alterada para fazer os testes passarem.

## Evidência atual

Os nove callbacks executaram e passaram, com zero skips, falhas ou cancelamentos, em PostgreSQL17.11 temporário e Node20.19.2. O typecheck transitivo incluindo o teste passou com zero diagnósticos e 507 entradas. A execução foi local; nenhuma instância de produção foi consultada ou modificada.

Recibo: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/materials-pg17-backend-20261111/attempt-1/receipt.json`, SHA256 `81bf94fdea78f03b9ca2d2cc34a34c34acf87b7189f4631ee83acc4440e12042`.

Run: `/mnt/apps/peticao-final/_ops/qa-materials-pg17-20261111/runs/8e04d376402e`. Perfil ativado `3e823003babd4c0af3a9757ffd604ae1a0087d7d`, manifesto `ab8b376dd44da8ee0e397139b416a2d9dd766499d20d3b2e24f49dfd7dd57a39`. Unidade `peticao-materials-pg17-qa-20261111.service`, invocation `bc98dd4483224801b6b106e3ccc325f1`, saída 0 capturada ainda retida por Root, revisor e Vigia antes de STOP intencional. A auditoria independente satisfez 20 verificações.

## O que os testes demonstraram

1. DDL aditivo reaplicado com dados existentes, preservando registros; roundtrip JSONB/hash/autoria e FK do head para a versão exata.
2. Dois atores disputando a mesma revisão: um sucesso e um conflito, sem duplicação de revisão ou auditoria.
3. Mesmo ator/pedido em duas sessões: uma admissão e um replay; conteúdo diferente gera conflito. Recuperação posterior retorna a versão original, sem apresentá-la como head atual. Pedidos são separados por ator.
4. Falha de auditoria reverte criação e revisão inteiras, sem head, versão ou recibo órfão. Sequências PostgreSQL não são alegadas imutáveis após rollback.
5. Permissões e identidade da sessão são revalidadas; rebaixamento, desativação, troca obrigatória de senha, expiração e exclusão da sessão impedem a escrita.
6. Arquivamento cria nova versão; versões/recibos antigos não admitem UPDATE/DELETE. Não é proteção contra superuser ou TRUNCATE.
7. Biblioteca com 51 ativos paginados em 50+1 e arquivados separados, sem repetição ou alteração por leitura.
8. Histórico com 51 revisões paginadas em 50+1, preservando o head.
9. Feature flag desligada recusa operações e preserva os dados.

Cada callback conferiu a cadeia real de auditoria e ausência de registros em e-mail, tentativas, spool, envios, lotes e assinaturas.

## Isolamento e limpeza

O teste exige opt-in exato, URL de fixture em 127.0.0.1:55496, nonce de 12 hex igual ao cluster_name, usuário/banco fixture_only, versão 170011 e data_directory interno esperado. Cada callback cria um schema novo; a remoção confere URL, nonce, owner, comentário e nome exatos. Não usar esse teste contra banco real ou via npm test global com as flags habilitadas.

A execução terminou com zero schemas remanescentes, spool vazio, guard instalado no PID correto e zero tentativas negadas. Fontes compiladas e dependências permaneceram estáveis. Processos e cgroup foram drenados; container/rede removidos e portas 55496/31396 fechadas. Logs brutos ficam privados no diretório do run; seus hashes constam no recibo.

## Histórico e limites

A preparação inicial observou nove skips e nenhum callback, antes da execução real. Essa evidência continua preservada em `/mnt/apps/peticao-final/_ops/drafts/materials-library-20261111/.cache/materials-pg17-preparation-20261111/`; ela não foi reclassificada como sucesso PG. O perfil e os registros de revisão permanecem separados.

O aceite é do backend isolado. Não houve teste HTTP da aplicação, editor, exportação, integração cumulativa, migração de produção, deploy ou execução de fluxo bloqueado. Esses passos continuam pendentes.
