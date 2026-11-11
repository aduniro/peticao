# UI de Materiais — rascunho isolado

Worktree: `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111`.
Branch: `feat/materials-ui-draft-20261111`.
Base: `e08c3cfb34ae0fd7132eebecfa18eec91cd15d7a`.

Este incremento cria componentes de rascunho, não uma página publicada. Não monta rota, menu ou feature flag, não integra candidato e não contém deploy. Nenhuma API, renderizador ou snapshot de outro branch foi transplantado. O helper cliente e08 permanece byte-idêntico.

## Arquivos e funcionamento

- `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111/site/src/components/admin/MateriaisBiblioteca.tsx`: coordenador React, filtro ativo/arquivado, páginas por UUID, seleção de material e permissão derivada do nível leitura/edição. Recebe `{actorId, actorScope, nivel}` de futuro SSR autorizado, nunca cookie/token.
- `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111/site/src/components/admin/MateriaisFormulario.tsx`: campos estruturados controlados, create/revise/archive, consulta do pedido incerto e revisão explícita. Texto parcialmente inválido fica local; não sobrescreve o conteúdo válido do helper. Arquivar fica indisponível enquanto há texto não salvo.
- `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111/site/src/components/admin/MateriaisHistorico.tsx`: consulta e páginas por ordinal, separando head de versão selecionada. Datas usam o helper existente de Brasília.
- `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111/site/src/components/admin/MateriaisPrevia.tsx`: link de mesma origem para a versão salva exata, sem HTML bruto ou iframe. O contrato esperado é `/api/admin/materiais/{materialId}/previa?versionId={id}&revision={revision}` do upstream140ce; essa API não foi copiada para este branch.
- `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111/site/src/lib/materials-ui.ts`: funções de draft/intent/URL e um adaptador pequeno de ciclo de vida. Não é um editor nem um event bus; cada montagem possui um cliente novo, e cleanup/contexto invalidam conclusões antigas.
- `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111/site/src/lib/materials-ui.test.ts`: nove testes puros novos.
- `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111/site/src/lib/materials-ui-copy.ts`: textos novos centralizados com comentário `MUDAR AQUI — RASCUNHO`. Os rótulos de modelos/identidades têm o mesmo aviso no formulário. Todos aguardam aprovação futura e não foram integrados/publicados.

Após create confirmado, Novo e Descartar em contexto sem material usam um cliente fresco de forma explícita e somente sem pedido pendente/operação ativa. Isso elimina o recibo e needsReview antigos sem fabricar um material intermediário. Novo continua exigindo ausência de texto não salvo. Um pedido incerto nunca é descartado por esse reset.

Save usa requestId novo por intenção, revisão conhecida e o helper e08. Resultado incerto oferece GET do mesmo pedido; não há novo POST automático. Conflito preserva o texto local e exige histórico iniciado depois do conflito e revisão explícita. Recibo/replay não promove a versão recebida a head. Alterações de ator/nível remontam o componente; troca de material protege o rascunho e invalida respostas antigas.

## Estética e escopo

Foram usadas somente classes existentes `v2-pagina`, `v2-secao`, `v2-aviso`, `adm-btn`, `fim`, `small` e `table-scroll`. Não há CSS novo, style inline, alteração de fonte/tamanho, homepage, menu ou layout existente. Esse fato não equivale a uma avaliação visual no navegador, que ainda está pendente.

A UI não contém rich text, uploads, HTML livre, IA, Contatos, envio ou assinatura. Não oferece PDF/PNG inexistentes. O pedido e o texto são transitórios nesta aba; não há promessa de recuperação após reload/fechamento. O aviso nativo de saída protege a intenção/texto presentes, sem persistir dados.

## Validação feita

Prova temporária e logs: `/mnt/apps/peticao-final/_ops/drafts/materials-ui-20261111/.cache/materials-ui-validation`.

- Strict typecheck transitivo: sete raízes novas, 175 arquivos de entrada, zero diagnósticos e zero drift. Nove pacotes existentes coincidem com o lock, sem instalação.
- Nove testes puros: draft parcial; CAS/revisão; URL exata; navegação após recibo; cleanup/remontagem com cliente novo; resposta antiga após troca de contexto; recuperação GET sem novo POST; create confirmado→Novo→nova intenção válida; pedido incerto não pode ser resetado.
- Cinco verificações SSR: leitura sem botões de escrita; campos escapados e classes existentes; URL histórica exata/rel seguro; distinção head/histórico e data de Brasília; biblioteca isolada sem efeito de consulta durante SSR.
- Guard de processo: zero tentativas reais de rede, listener, DNS, TLS, UDP, fetch ou subprocesso. Módulos cliente emitidos sem import de PG/crypto/Buffer/contrato Node em runtime.

Os testes de lifecycle exercitam o adaptador puro, não um navegador React StrictMode real. SSR não valida cliques, foco, acessibilidade completa, layout visual ou CSS aplicado. Nenhum PostgreSQL, build Next, HTTP real ou navegador foi executado por este incremento.

## Pendências antes de integração

Revisão Root/peer e aprovação dos textos; integração coordenada do helper e08 e APIs/renderizador/prévia140ce na base cumulativa; migração aditiva e SSR/menu com flag desligada; typecheck/build dessa união; browser real com fixture para permissões, Novo/Discard, trocas rápidas, double click, perda de resposta/GET, conflito/histórico, preview e acessibilidade. Essa implementação isolada não altera percentuais de UI homologada nem autoriza deploy.
