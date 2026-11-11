# Prévia estruturada de Materiais — draft independente

Checkout: `/mnt/apps/peticao-final/_ops/drafts/materials-renderer-20261111`; branch `feat/materials-renderer-preview-20261111`; base `73c501e48b936d3898ff4b6804bb331f0e355c7d` da fundação de Materiais. Não integrado ao candidato, não publicado e sem alteração da página pública.

## Implementação

`/mnt/apps/peticao-final/_ops/drafts/materials-renderer-20261111/site/src/lib/materials-render.ts` renderiza os três templates estruturados em HTML: A4 colorido, quatro panfletos monocromáticos recortáveis por A4 e peça quadrada de 1080×1080px. Usa apenas texto validado pelo contrato de Materiais e os três logos fixos existentes. Não recebe HTML, CSS, caminhos, links ou scripts arbitrários. O HTML não contém JavaScript nem formulários; a CSP permite o CSS pelo hash dos bytes exatos e imagens da mesma origem.

As fontes e cores pertencem somente a estes novos templates. A interface e os estilos da página de assinaturas não foram alterados. Não há textos novos de interface ou conteúdo oficial de campanha semeado; os exemplos são fictícios.

`exportReady=false` é intencional: a implementação é de prévia, não exportação. O conteúdo permanece completo e visível; não há truncamento ou redução automática para esconder excesso. O futuro exportador deverá medir cada painel, seus filhos, imagens, transbordamento e sobreposições antes de admitir o arquivo. A política retornada pelo renderizador não implementa essa verificação na aplicação.

`contentSha256` identifica os dados estruturados, não a imagem final: não cobre os bytes dos logos, a fonte instalada, a versão do Chromium ou o HTML/CSS do renderizador. Uma exportação reproduzível deverá registrar esses recursos e suas versões separadamente. Os logos ficam em caminhos relativos da mesma origem; abrir o HTML isolado por `file://` não equivale a uma prévia corretamente servida com seus recursos.

## Verificações realizadas

- Quatro testes puros e typecheck estrito com zero diagnósticos: preservação/escape de texto, recusa de marcação executável/caminhos/getters, folha monocromática de quatro cópias e contrato de excesso sem truncamento.
- Chromium145 com sandbox habilitado, JavaScript da página desabilitado e respostas HTML/PNG fornecidas por rotas de teste locais, sem encaminhar requisições de conteúdo à rede. Três amostras curtas renderizaram com imagens carregadas e sem transbordamento; uma amostra de 6000 bytes foi detectada como excedente.
- Root inspecionou as três imagens de amostra. São testes técnicos de legibilidade e organização, não aprovação gráfica do responsável nem prova de que todo texto aceito pelo contrato caberá.
- Unidade delimitada `peticao-materials-render-preview-20261111.service`, invocation `e9911d38a5fc4b418aad11b170cc81d9`, saída0 retida antes de STOP intencional. Diretório temporário do Chromium removido e cgroup próprio liberado. A primeira checagem de limpeza interpretou incorretamente `ControlGroup` vazio como cgroup raiz; a prova foi corrigida consultando o caminho exato da unidade. Nenhum teste foi repetido para esconder esse erro de observação.

Provas em `/mnt/apps/peticao-final/_ops/drafts/materials-renderer-20261111/.cache/materials-render-validation/`: `result.json`, `browser-result.json`, `retained-unit.txt`, `cleanup-proof.json` e imagens/HTML em `previews/`. Esses arquivos são artefatos locais ignorados pelo Git.

## Pendências

Revisão independente final; integração coordenada com a biblioteca versionada; editor e prévia na interface administrativa; controle de excesso real no exportador; PDF/PNG para download com recursos incorporados e manifesto completo; paginação/impressão real; aprovação gráfica e de textos; autorização de uma versão para deploy. Nenhuma conexão com banco, chamada de IA, disparo de mensagens, alteração de produção ou retomada de fluxos bloqueados foi feita por este draft.
