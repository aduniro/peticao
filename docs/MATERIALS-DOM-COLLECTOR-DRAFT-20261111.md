# Coletor DOM de Materiais — preparação isolada

Base: `3e26c4cf2b6c46205a2734e84ca741ec35b2e311`. Worktree local: `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111`.

A função `collectMaterialLayout`, em `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111/site/src/lib/materials-dom-collector.ts`, é autocontida e serializável para `page.evaluate`. O único import é de tipos. Ela lê a folha, os painéis, os cinco blocos semânticos e a imagem de cada painel, dimensões client/scroll/rect, estilos de recorte/visibilidade, prontidão das fontes, viewport, DPR e relógio monotônico. Não escreve no DOM, não carrega imagens/fontes, não aguarda recursos e não acessa arquivos, rede ou banco.

A estrutura emitida pelo renderizador é verificada por quantidade, hierarquia, tag e classe. Texto solto fora dos blocos, elementos adicionais dentro dos blocos textuais e imagens estruturadas incorretamente são recusados. Um erro estrutural ou numérico lança código de máquina fixo. Recursos incompletos e problemas de estilo permanecem explícitos nas métricas. O filtro monocromático `grayscale(1)` do logo é permitido; outros efeitos de filtro não são considerados seguros por este coletor. As tolerâncias continuam exclusivamente no avaliador e não são configuráveis pelo chamador.

O retorno é uma única amostra compatível com `MaterialLayoutSample`. O executor confiável, ainda pendente, deverá fixar o documento/ambiente, obter duas leituras estáveis e verificar a proveniência de conteúdo, HTML, renderizador, imagens, fontes e navegador. O coletor não inventa hashes nem emite manifesto ou veredito de exportação. Dados recebidos de um cliente HTTP não constituem prova. O avaliador e o renderizador foram preservados byte a byte.

## Validação realizada

Doze testes puros com DOM simulado passaram; typecheck estrito terminou com zero diagnósticos, usando Node 20.19.2 e TypeScript 5.9.3 existentes. A serialização em VM demonstra ausência de dependência de imports em runtime e preservação dos dados do DOM simulado. Há casos de estrutura inválida, recorte, estilos ocultos, transformação, máscara, elipse, clamp, recursos incompletos, métricas não finitas e ambiente inválido. Métricas serializadas de cartaz e quatro recortes alimentaram o avaliador inalterado usando manifesto explicitamente fictício de teste; isso não equivale a um manifesto de artefato real.

Provas: `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111/.cache/materials-dom-collector-validation/result.json`, `stdout.log` e `diagnostics.txt`. A tentativa inicial com dois erros de tipos no próprio mock foi preservada em `attempt-1-*`; a segunda tentativa com nome incorreto de template na fixture foi preservada em `attempt-2-*`. Ambas foram corrigidas nos testes, sem alteração do avaliador ou renderizador.

## Limites e próxima etapa

Nenhum navegador, aplicação, PG, HTTP, PDF, UI ou deploy foi executado. Os mocks não provam valores reais de CSS computado em Chromium. Ainda é necessário qualificar o executor offline e fazer coleta real com duas amostras, inventário confiável e avaliação. O coletor não analisa toda possibilidade de pintura CSS, pseudo-elementos ou interseção de glifos; o contrato pressupõe HTML e stylesheet exatos do renderizador confiável. A qualificação deve rejeitar alteração desses artefatos. `fitPassed` continua diferente de `exportReady`; esta fatia não autoriza exportar nem conclui o módulo inteiro. Nenhuma atividade R16 foi retomada.
