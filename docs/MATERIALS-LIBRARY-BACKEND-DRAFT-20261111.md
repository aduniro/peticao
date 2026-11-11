# Campanha / Materiais — biblioteca estruturada (draft isolado)

Estado: PREPARAÇÃO/CÓDIGO ISOLADO. Não integrado, não aplicado, não publicado. Nenhuma porcentagem de módulo foi atribuída. Documentos continuam na frente prioritária do root.

Checkout: `/mnt/apps/peticao-final/_ops/drafts/materials-library-20261111`, branch `feat/materials-library-backend-20261111`, base `f55595cd348c23ffe559dba2de9150259db9f1e7`. Origem cumulativa, runtimeR6 e homepage não foram editados.

## Entrega desta fatia

- `/mnt/apps/peticao-final/_ops/drafts/materials-library-20261111/site/src/lib/materials-contract.ts`: templates/chaves de logos existentes, textos planos limitados por bytes, validação de campos exatos, UUID, revisão CAS, hash e projeção segura de versões. Não aceita HTML, CSS, JS executável, caminhos, URLs, arquivos binários, autoria ou estado de publicação do cliente. Valores textuais são preservados; futuros renderizadores deverão usar text nodes/escape e assets confiáveis.
- `/mnt/apps/peticao-final/_ops/drafts/materials-library-20261111/site/src/lib/materials-schema.ts`: DDL aditivo para três tabelas novas. Head aponta por FK deferrable para uma versão exata/ordinal/estado; versões e recibos de pedido são imutáveis. Arquivamento é lógico/versionado, não exclusão. O DDL NÃO foi registrado em db.init nem aplicado a qualquer banco.
- `/mnt/apps/peticao-final/_ops/drafts/materials-library-20261111/site/src/lib/materials-store.ts`: revalida conta/sessão/nível atuais, serializa pedidos por ator, trava um head, confere expectedRevision, insere versão/recibo/audit e move head na mesma transação. Repetir requestId com conteúdo distinto dá request_conflict; repetir exatamente retorna a versão admitida anteriormente, que não é alegada como head mais recente. Recuperação por GET é exclusiva do ator e nunca repete POST. Histórico trava head para manter leitura consistente. Usuários leitores consultam; edição ou nível superior altera. Conta legada/sem sessão persistida não autoriza gravação.

Os três templates são identificadores de dados para A4, panfleto PB recortável e social quadrado; nenhum layout/renderizador foi criado e não há garantia de que um texto máximo caiba visualmente. Chaves adunir/adunir-andes/andes referem-se aos PNGs já existentes; aprovação gráfica/exportação ainda virá. Não se semeia conteúdo de campanha nem se cria texto visível ao usuário.

## Contrato API proposto

Tudo abaixo usa `exigirNivel`, `quemAge`, origem/rate limit existentes e `Cache-Control:no-store`. Respostas próprias usam somente códigos de máquina. `MATERIALS_LIBRARY_ENABLED` fica desligado por padrão; não o habilitar antes da integração/DDL/testes correspondentes.

- `GET /api/admin/materiais?archived=0|1&before=UUID`: até50heads, cursor estável por UUID (não é ordenação de recência). Próxima UI poderá definir ordenação apropriada sem alegar cronologia desse cursor.
- `GET /api/admin/materiais/UUID?before=ORDINAL`: head e até50versões anteriores. Preserva conteúdo, autoria, timestamp e hash; não altera material.
- `POST /api/admin/materiais`: intent create `{operation,requestId,content}`; revise `{operation,requestId,materialId,expectedRevision,content}`; archive `{operation,requestId,materialId,expectedRevision}`. Content tem exatamente template/assetKey/title/body/callToAction/footer. Actor/time/head/version IDs vêm do servidor. Arquivado não pode ser editado/restaurado nesta fatia.
- `GET /api/admin/materiais/pedidos/UUID`: confere resultado do próprio pedido; nunca novo envio. Retorna versão gravada, não afirma que ela é a atual.

Status:200 sucesso/replay,400parâmetros,401/403autenticação/permissão,404nãoencontrado,409disabled/CAS/request_conflict/archived,503falha indisponível. Falha de audit/insert deve abortar a transação; isso ainda precisa de prova PG17, não foi simulado como sucesso.

## Validação observada

12testes puros de contrato/mapeamento passaram: Unicode/newlines, limites em bytes, chaves/templates/assets, recusa de getters/protótipos/símbolos/código/caminhos, intents/CAS, hashes canônicos, integridade de versões/projeção e filtros. TypeScript5.9.3/Node20.19.2 existentes foram usados somente leitura: strict typecheck de contrato/schema/testes sem emissão teve0diagnósticos; store/rotas passaram checagem sintática por transpile, que NÃO equivale a typecheck transitivo/build.

Provas locais ignoradas por Git: `/mnt/apps/peticao-final/_ops/drafts/materials-library-20261111/.cache/materials-library-validation/`. Sem npmci, instalação, PG, aplicação, HTTP, render/exportação, IA, contatos, disparos, assinatura, provider ou dados reais. DDL SQL e transações ainda não foram executados.

## Próximas provas e integração (pendentes)

1. Revisão independente do contrato/DDL/store; typecheck transitivo com dependências da versão integrada.
2. PG17 sintético exclusivo autorizado: aplicar DDL duas vezes; create/revise/archive reais; versões antigas imutáveis; FK head/ordinal/state; CAS concorrente com dois atores; requestId igual idempotente e distinto conflitante; mudança/revogação de sessão/nível; audit failure rollback sem head órfão; leitura entre edições; paginação. Não chamar banco real.
3. Ensaiar rotas reais401/403/origin/rateLimit/campos/body limits e recuperação após perda de resposta, sem auto-POST.
4. Só depois integrar registro aditivo em db.init/migração e featureflag/rotas na base cumulativa; preservar objetos e dados antigos, manter flag desligada como retorno funcional. Não usar DROP de tabelas para rollback.
5. UI de criar/editar, prévias, renderizadores e exportação PDF/PNG, biblioteca/arquivamento, revisão visual, segurança de QR/links e acesso apropriado; composição personalizada por instituição é etapa posterior coordenada com homepage. Upload/armazenamento de arquivos exportados também permanece pendente.

O módulo completo continua pendente: criar/editar → prévia/exportar → biblioteca. Esta fatia é somente fundação backend isolada, não release pronta para deploy.
