# Prévia do presidente por canvas — decisões de10/11/2026

## Decisão de arquitetura e dependência

A prévia nativa foi testada isoladamente: sandbox vazio e sandbox allow-scripts sem allow-same-origin bloqueiam o leitor Chrome, inclusive para Blob. Remover sandbox não foi adotado. Download não conta como prévia concluída.

Consulta ao catálogo oficial npm encontrou pdfjs-dist6.5.438 como latest, com engines Node>=22.13. A última versão com engines compatíveis com Node20.19 é5.6.205, mas o advisory oficial GHSA-hq66-cqwq-w95j declara a linha>=5.6.83 afetada e6.2.108 corrigida. Não se escolheu versão vulnerável/antiga por conveniência.

Decisão expressa do agente principal:6.5.438 exclusivamente como ESM/worker/assets do navegador, auto-hospedados. Nenhum import de PDF.js em Node/SSR, nenhuma troca de Node20.19.2, nenhuma instalação no node_modules compartilhado e nenhuma dependência nova no package-lock. Node20 executa somente o preparador de arquivos, validado separadamente. A restrição engines do pacote para uso Node não é anunciada como atendida.

Fontes primárias consultadas:

- https://registry.npmjs.org/pdfjs-dist/latest
- https://registry.npmjs.org/pdfjs-dist/6.5.438
- https://registry.npmjs.org/pdfjs-dist/5.6.205
- https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j
- https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq
- https://mozilla.github.io/pdf.js/examples/
- https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html

## Perguntas consideradas e escolhas reversíveis

- Como distribuir a biblioteca? Script Node20 com download HTTPS sem redirects, limites de30s/32MB, SRIsha512 do arquivo npm e SHA256/tamanho de cada arquivo. Extrator tar mínimo não executa npm/scripts, não extrai links e só grava whitelist fixa. Atualizações exigem atualizar versão/lock deliberadamente.
- Como manter QA sem rede? --offline exige cache já presente e válido. Cache ausente/corrompido falha antes de fetch/extrair. Testes usam armadilha de fetch para comprovar ausência de requisições.
- Quais arquivos?201assets: core/worker, fontes padrão/CMaps/ICC e decodificadores de imagem locais, com licenças. QuickJS e scripts de avaliação de PDF não são distribuídos. Destino gerado public/vendor/pdfjs/6.5.438 deve ser ignorado no Git; script/lock e licença de proveniência são registrados. O runtime fica fora dos commits, conforme política do projeto.
- Como carregar? dynamic import webpackIgnore dentro do useEffect, somente no navegador, validando versão exata. Worker ESModule real explícito, sem fallback de parsing para main thread. Todos os URLs são caminhos locais fixos.
- Como restringir capacidades? Somente getDocument/data e page.render/canvas, annotationMode0. Não se cria AnnotationLayer, TextLayer, scripting manager, iframe, embed ou object. isEvalSupported/enableScripting/enableXfa false; nenhum URL do próprio PDF é usado para requests. CMaps/fontes/WASM/ICC usam somente o prefixo local. Isso não é homologação de certificado nem antivírus geral.
- Como preservar bytes? Copiar Uint8Array antes da transferência ao worker. O download e o hash anteriores continuam correspondendo aos bytes verificados.
- Como limitar trabalho? Uma página por vez, fila que espera cancelamentos anteriores antes de reutilizar canvas, paginação1..1000, fitwidth, DPR<=2 e máximo8milhões de pixels. ResizeObserver ajusta largura. Ao trocar arquivo/fechar, cancelar render, destruir task/worker e ignorar respostas antigas. Há limites de45s para carga/render.
- Quais textos novos? “Página anterior”, “Próxima página”, “Página X de Y”, “Carregando prévia…”, “Prévia carregada.” e “Prévia indisponível. Você pode baixar o PDF conferido.” Reversíveis no componente; autorização do Goal permite decisões registradas. Fontes, cores e classes existentes, sem mudar CSS global ou a página pública.

## Integração pendente do agente principal

1. Copiar scripts/prepare-pdfjs-assets.mjs e scripts/pdfjs-assets.lock.json ao site; adicionar comando prepare:pdfjs ao package.json. Patch sugerido preserva dependências e package-lock.
2. Ignorar site/public/vendor/pdfjs no Git. Preparar uma vez online; build/runner QA devem executar preparador --offline e registrar/verificar SHA do manifesto de todos os runtimeassets. Nunca confiar só no fato de serem ignorados pelo Git.
3. Copiar helper/testes e PresidentPdfPreview.tsx. No portal, guardar os bytes já verificados em estado estável e renderizar o componente; limpar bytes junto ao Blob URL em forgetPdf. O iframe antigo só sai quando essa integração estiver testada.
4. Repetir build/QA compilado do aplicativo. O fixture aprova o componente real em React/esbuild, não substitui Next/API/PG nem valida o certificado.

## Evidências do rascunho

browser-fixture/result.json: Chromium real, componente compilado, PDF fictício existente de3páginas,6larguras sem overflow, pixels visíveis, anterior/próxima/contador, erro de arquivo inválido, reabertura, cancelamento e4workers terminados. CSP do fixture recusa eval/frames/objects; nenhuma requisição externa/POST, nenhum QuickJS/scripting fetch. Screenshots320 e1280 inspecionados visualmente.

checks-result.json registra tipos/testes, fontes e SHA de201assets. Os resultados representam este rascunho isolado. Não houve alteração no candidato, VPS ou node_modules compartilhado.

## Port local e prova do runtime

Canvas portado ao portal, sem iframe/plugin e sem alteração do formulário público. Node20 e package-lock preservados. Buildnpm prepara assets; QA prepara somente offline a partir do cache fixado.201assets+assets-version.json verificados contra lock/SRI, fora do Git; runner congela runtime-assets-manifest.json junto das fontes e confere novamente no navegador. Campos de código/CPF/nascimento continuam somente em memória. Também corrigido rótulo do apêndice: batchId é Identificador do lote, não número sequencial do ofício. Nenhum PDF histórico foi alterado.
