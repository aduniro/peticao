# Materiais — medição real de tela qualificada

Fonte executada: `49b158d73ef9dc5c75b7c378dfdafca44dcf62bc`, em `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111`. O aceite é de fixtures offline de tela; editor, exportação e integração continuam pendentes.

## Resultado

Nove combinações de três templates com três logos passaram no Chromium145. O décimo caso, com texto excessivo, foi recusado por `scroll_overflow` e `bounds_overflow`, com fontes/imagens prontas e sem causas alternativas. Cada caso teve duas amostras reais; nenhuma métrica foi substituída por dados simulados para aprovar o ensaio.

Recibo: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/materials-layout-browser-20261111/attempt-2/receipt.json`, SHA256 `9f989732515c9dcaf17bf6a598f4ecb2286134ef855a269ad339889d486c8d86`.

Perfil: `/mnt/apps/peticao-final/_ops/qa-materials-layout-browser-v2-20261111`, commit `94042d802e297d700be5478774674cf5d78424f3`, manifesto `a8fc29998bf838cd30501ea0efed935308105bccc3dd2b0e24b98005154f3a18`. A unidade `peticao-materials-layout-browser-v2-20261111.service`, invocation `f9becaac29934272a3083500b62ca46e`, foi capturada retida com saída0 por Root, revisor e Vigia antes de STOP intencional. O Chromium fechou e seu temporário foi removido; a lease de execução foi concluída/liberada.

As dez capturas PNG são byte a byte idênticas às correspondentes da primeira tentativa. O renderer, seus estilos e o avaliador não foram modificados pela correção. Root inspecionou as amostras0,2,3 e7, cobrindo formatos e logos distintos. Isso não equivale à aprovação gráfica ou textual da campanha pelo responsável.

## Falha preservada e correção

A tentativa anterior teve zero casos qualificados: o coletor interpretava `overflow: clip` padrão do elemento substituído IMG como recorte indevido, mesmo com `object-fit: contain`. Vinte amostras mostraram exatamente `image_clipping`. O excesso também apresentava motivos geométricos, mas não foi contado como aprovado por essa causa alternativa.

Recibo da falha preservada: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/materials-layout-browser-20261111/attempt-1/receipt.json`, SHA256 `e3e9be666a1e7978465b57baf7d63d3b34af92b789233b5650f49c7e2d0fef4f`.

O patch permite somente `visible`/`clip` em IMG da estrutura esperada com `object-fit: contain`. Outros fits, overflow hidden/auto/scroll, recortes de texto/ancestrais, máscaras, clip-path e efeitos continuam recusados. A regressão nominal falha no coletor anterior e passa no corrigido;17 testes simulados e typecheck estrito passaram. A segunda execução usa perfil próprio vinculado ao recibo, marcador, unidade retida e artefatos da primeira, sem retry genérico ou apagamento da falha.

## Proveniência e limites

Conteúdo/HTML/renderer/logos/Chromium foram identificados por hash. O CDP informou fontes utilizadas, e Fontconfig identificou arquivos de nomes PostScript correspondentes cujos bytes foram hashados no momento da observação. Isso não é inventário global de fontes congelado antes/depois nem aprovação de licenças. Os logos permaneceram estáveis e nenhuma requisição de conteúdo foi encaminhada à rede; não é uma afirmação de isolamento de rede do sistema operacional.

Os IDs de versão eram fixtures e não foram resolvidos na biblioteca PostgreSQL. O resultado cobre mídia screen, viewports/DPR definidos e estes dez casos. Não comprova todos os textos possíveis, impressão física, incorporação de fontes, geração de PDF/PNG para download ou prontidão da aplicação publicada. `exportReady` continua false.

Nenhum app HTTP, banco, migração de produção, deploy ou fluxo R16 foi executado por estes ensaios. Os manifestos anteriores continuam preservados como snapshots de preparação; este documento acrescenta o estado comprovado posterior.
