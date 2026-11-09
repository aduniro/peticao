# Catálogo administrativo recuperável de domínios

Marco backend aprovado pelo principal em09/11/2026UTC, em worktree isolada
`candidate-referral-management-20261109`, sobre a base16tabelas de `ccaaa8a`.
Não altera frontend/textos, regras públicas, decisões efetivas, cache, selos,
assinaturas ou VPS. Não habilita envio, IA, URLfetch ou serviço externo.

## Contrato entregue

Módulo `admin-domain-catalog.ts` e API nova `/api/admin/dominios/catalogo`.
O catálogo possui overlay administrativo separado com `label` e `evidenceUrl`.
Os campos efetivos `institution`, `evidence_url`, `kind`, `status`, `source`,
`decided_by` e datas originais não são editados por esta API. GET apresenta
`metadata` administrativo e `effective` em objetos distintos, com versão, estado
arquivado e paginação por domínio para ativos/arquivados/todos. Chaves ainda
UNKNOWN no overlay são preservadas; null explícito não é substituído por dado
inventado ou pela fonte efetiva. Domínios inexistentes não são criados.

Arquivar organiza somente a lista administrativa nova. Não revoga aprovação,
rejeição ou exceções de subdomínio e não retira registro de `approvedDomains`.
Restaurar não altera decisão efetiva. A versão monotônica pertence só ao overlay;
contadores, sementes e decisões antigas continuam independentes e não resetam
esse estado. Não atribuir essa versão às decisões antigas: a migração da edição/
aprovação efetiva para intenção/versionamento continua outro marco.

Cada mutação exige UUIDv4, versão e operação explícita. Ledger próprio vincula
ator, domínio, entrada canônica e resultado JSON original. Repetição retorna o
resultado original mesmo após edição posterior; entrada divergente ou CAS antigo
retorna409. Rótulo/evidência são campos fixos: evidência http/https é validada
sintaticamente, sem consulta remota; esquemas executáveis/credenciais embutidas
são recusados. Não há editor genérico, alteração de domínio-chave ou DELETE.

Edição exige Edição ou superior; arquivo/restauro exigem Exclusão ou Total e
confirmação extra vigente. Conta, identidade, sessão e permissões são revalidadas
na transação. Travas de conta e linha, auditoria antes/depois, versão e ledger
são atômicos. A rota exige origem válida, aplica limite de taxa, limita corpo a
4096bytes e rejeita campos efetivos/arbitrários. Falhas não sobrescrevem o estado.

## Esquema isolado e integração necessária

Três colunas aditivas em `institutional_domains`: `admin_catalog` JSONB com padrão
objeto vazio, `admin_catalog_version` BIGINT padrão1, `admin_archived_at` nullable.
A tabela própria `admin_domain_catalog_requests` guarda intenção e resultado.
Nesta worktree ela é a17ªtabela aditiva, pois sua base tem16. O adapter do portal
é desenvolvido em paralelo pelo principal; a consolidação deverá combinar os
dois blocos e conferir explicitamente18tabelas, sem descartar provas anteriores.
O patch não inventa nem inclui o esquema do adapter nesta cópia.

## Provas

**25/25 testes passaram**, zero falhas/cancelados/ignorados: sete casos novos,
gestão de indicações, gestão/autoria de configurações/domínios e regressão de
classificação institucional. Cobrem ciclooverlay/arquivo/restauro, chaveUNKNOWN,
null efetivo, identidade e selo preservados, cache não invalidado, precedência de
rejeição mantida, CAS concorrente, replay exato, autorização atual/stepup, rollback
de auditoria, escritores antigos preservando overlay, campos/URL/HTTP/paginação.

Ensaio estrito do esquema: código0,17tabelas aditivas nesta base, nenhuma definição
antiga alterada; versões, datas com microsegundos, chavesUNKNOWN, políticas efetivas
e resultados dos dois ledgers sobrevivem DDL repetido e bootstrap antigo.
Tipos da árvore isolada: código0. Nenhum build ou navegador foi necessário neste
marco backend. Ambiente novo, PostgreSQL54356, maildev, dependências preview-v1 e
configuração vazia; nenhum segredo real ou arquivo de ambiente.

Evidência original `/tmp/admin-domain-catalog-inlmlr1f/`; cópia/checksums privados
`.cache/qa-domain-catalog-20261109/`. Os fontes relevantes permaneceram iguais
durante a rodada. O PostgreSQL próprio encerrou e54356ficou livre.

Pendente: consolidar os dois esquemas e rodar o checker18; interface do catálogo;
edição/decisão efetiva versionada/por intenção em marco separado. Não considerar
esta entrega conclusão de entidades ou autorização para deploy.
