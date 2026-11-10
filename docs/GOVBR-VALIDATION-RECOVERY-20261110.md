# Recuperação exata da validação gov.br — fatia isolada

Base: 0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f. Branch/worktree privados: r0001-govbr-recovery-20261110, /mnt/apps/peticao-final/_ops/r0001-govbr-recovery-20261110.

## Contrato

POST /api/admin/documentos/base/[id]/validar agora exige `{requestId,expectedSha256}`. Um requestId identifica uma tentativa e seu ator/contexto. Repetição da identidade original retorna a mesma tentativa, pendente ou terminada, sem chamar o validador novamente. Contexto ou payload incompatível não autoriza outra chamada. GET da mesma rota exige exatamente requestId e expectedSha256 e recupera `{requestId,attemptId,artifactId,sha256,state,validationId,isCurrent}`. Estados são pending/valid/rejected/unavailable. method e usableInPackage=false continuam explícitos. GET não valida, seleciona, aprova ou envia.

O cliente registra a identidade antes do POST e a recupera por GET após resposta perdida/recarga. Pending mantém a intenção e os controles bloqueados; Atualizar faz apenas leitura. Resultado terminal libera a intenção; sucesso obsoleto e falha continuam com aviso. Nenhuma tentativa incerta é repetida automaticamente. Não foram alterados textos aprovados, fontes ou classes visuais.

## Persistência/migração

Tabela nova append-only petition_base_validation_intents liga request_id globalmente único à tentativa e ao ator. O lock transacional já existente serializa a reserva; commit ocorre antes do I/O do validador. Tentativas e resultados legados não são reescritos. A ordem original de início continua determinando a evidência efetiva. Alterações de perfil/política e autorização são verificadas na recuperação e na conclusão.

DDL aditivo canônico em /mnt/apps/peticao-final/_ops/r0001-govbr-recovery-20261110/site/src/lib/petition-base-schema.ts. Migração isolada em /mnt/apps/peticao-final/_ops/r0001-govbr-recovery-20261110/site/migrations/20261110-govbr-validation-intents.sql, pré-requisito schema de petição-base existente. Não executada em banco real; não há rollback destrutivo automático.

## Provas locais

- 27/27 testes dirigidos: transporte, serialização/recuperação de intenção, HTTP/store com banco fictício próprio. Inclui duas requisições concorrentes/uma chamada ao validador falso, descarte da resposta e GET do mesmo attemptId, conflito, perfil alterado, stepup revogado, diário imutável e DDL repetível.
- 2/2 testes SSR do componente real: textos/classes existentes e ausência de POST nativo preservados.
- TypeScript --noEmit --incremental false: exit 0. Dependências em overlay privado, sem alterar caches compartilhados.
- git diff --check: exit 0.

Logs em /mnt/apps/peticao-final/_ops/r0001-govbr-recovery-20261110/.qa/final-directed.log, /mnt/apps/peticao-final/_ops/r0001-govbr-recovery-20261110/.qa/control-ssr.log e /mnt/apps/peticao-final/_ops/r0001-govbr-recovery-20261110/.qa/typecheck.log. Runner Node20.19.2 /home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node. SELECT version()/server_version_num comprovou PostgreSQL18.4 (180004), em /mnt/apps/peticao-final/_ops/r0001-govbr-recovery-20261110/.qa/postgres-version.json. O ensaio desta migração em PostgreSQL17 é pendente obrigatório antes de integração homologada conforme REV2; os resultados18.4 não o substituem. DB fictício postgres://peticao:peticao@127.0.0.1:55484/peticao, datadir /mnt/apps/peticao-final/_ops/r0001-govbr-recovery-20261110/.qa/pg20. A tentativa inicial com Node18 falhou por File ausente e foi substituída; não é prova final.

## Limites

Sem validador/certificado/provedor real, sem envio, deploy, merge, migração real ou alteração de serviços. Não reabre unsigned ou contatos/IA. Não houve teste interativo em navegador nesta fatia: provas UI são SSR, estado serializável e contrato HTTP, sem alegar homologação visual ou criptográfica real. Um processo que cai após reserva e antes de concluir permanece pending; GET mostra a mesma tentativa e não inventa resultado nem autoriza replay externo. A recuperação não resolve o fato externo incerto por repetição.

Peer review e integração permanecem a cargo do coordenador. O código integrado atual foi preservado.
