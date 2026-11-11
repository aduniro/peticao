# Materiais — avaliador puro de métricas

Estado: código isolado, sem integração. Checkout `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111`, branch `feat/materials-layout-assessment-20261111`, base `12224c3f5654f6a4d727d2ee5aa4a0e794060067` da prévia de Materiais. O renderer e os arquivos anteriores não foram alterados.

## Contrato

`/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111/site/src/lib/materials-layout.ts` recebe dois valores unknown: manifesto e exatamente duas amostras. Não lê DOM, arquivo, banco, configuração ou rede. Apenas valida e compara dados fornecidos.

O manifesto fechado v1 liga ID da versão do material, template e hashes de conteúdo, HTML, renderer, conjunto de assets, conjunto de fontes e Chromium. Aceita somente os três templates conhecidos, mídia screen, DPR 1 e viewports já usados no ensaio offline: 850×1200 para A4 e 1080×1080 para social. Não recebe tolerância, URL, CSS ou caminho configurável.

Cada amostra tem horário monotônico relativo, viewport/DPR, prontidão de fontes, códigos de erro e medidas da folha e dos painéis. Cada painel contém exatamente os cinco irmãos verticais brand/title/body/action/footer, caixas de client/scroll, flag de clipping e uma imagem com dimensões naturais/retângulo. IDs, contagens, tipos, números finitos, limites, campos exatos e arrays densos são verificados; getters, símbolos, protótipos diferentes e extras são recusados sem interpretar seus valores como código.

## Regras

- Duas amostras, com tempo crescente e geometria/flags estáveis. Diferença numérica máxima de 0,25 px entre amostras; tempo em si não entra nessa comparação.
- Dimensões A4 em CSSpx calculadas a 96 dpi e quadrado 1080 px, origem da folha, viewport, número de painéis e grade 1×1/2×2 precisam corresponder ao template.
- Tolerância fixa de 1 CSS px para arredondamento nas comparações de ajuste. O cliente não pode aumentá-la. Essa tolerância ainda precisa ser exercitada pelo futuro coletor real.
- Folha, painéis e blocos não podem ter excesso de scroll, dimensões client incompatíveis ou caixas fora dos limites. A imagem deve estar pronta, ter dimensões naturais positivas e caber no bloco da marca.
- Os cinco blocos devem manter a ordem vertical sem sobreposição entre irmãos. Blocos obrigatórios precisam ter área; rodapé vazio com altura 0 é permitido. Clipping declarado e erros de página/recursos recusam o ajuste.
- Fontes/imagens não prontas, instabilidade ou qualquer painel rejeitado recusam a folha inteira. Não há truncamento, redução automática de fonte ou alteração de conteúdo.

A resposta contém motivos de máquina, hashes canônicos do manifesto/amostras e `fitPassed`. **`exportReady` permanece false em todos os caminhos.** Passar nessas regras não produz arquivo, não autoriza exportação nem publica material.

## Evidência e limites

17 testes puros passaram, com typecheck estrito sem emissão e zero diagnósticos usando TypeScript 5.9.3 / Node 20.19.2 já disponíveis. Cobrem três nominais, manifesto fechado, amostras/contagens/ordem, NaN/infinito/coerção/limites, getter/sparse array, recursos, erros, estabilidade, dimensões/grade, excesso de filhos, imagem, sobreposição, clipping, rodapé vazio e hashes. A rodada anterior de 16 testes foi preservada; a última acrescentou recusa de métricas impossíveis de client/scroll zerados em caixa visível.

Provas: `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111/.cache/materials-layout-validation/`. Não houve browser, DB, HTTP, PDF, build, instalação de dependências, UI ou integração.

O avaliador **não autentica quem produziu as métricas**, não verifica existência dos arquivos de hash e não comprova prontidão de fontes/imagens por conta própria. A flag clipped é um dado do futuro coletor. O chamador confiável deverá ligar métricas reais ao HTML/recursos exatos, ler estilos relevantes, aguardar recursos e capturar duas amostras. Não há detector genérico de todos os glifos/efeitos, impressão, fonte incorporada ou visualização real nesta entrega. O resultado vale para os cinco blocos desses templates, não para HTML arbitrário.

Próximas etapas: revisão independente; coletor offline do DOM ligado a esse contrato, com casos reais e recursos pinados; validação de linhas/estilos onde necessária; somente depois geração e verificação de arquivos e integração com biblioteca/UI autenticada. O módulo completo e o deploy continuam pendentes. Nenhum fluxo bloqueado foi retomado.

O incidente anterior à lease válida foi registrado sem apagar a árvore/ref em `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111/docs/MATERIALS-LAYOUT-COORDINATION-INCIDENT-20261111.md`.
