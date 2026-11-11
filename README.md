# Medição offline de Materiais — diagnóstico inicial

Diretório: /mnt/apps/peticao-final/_ops/qa-materials-layout-browser-20261111.

Fonte congelada3f96a06a8e3557099c94df19e1b95a3496496bfe do coletor, avaliador e renderer. Quatro módulos são transpilados estaticamente com TypeScript5.9.3 e pinados; nenhuma fonte da aplicação, banco ou worker é inicializada.

Dez casos fixos: três templates × três logos e um cartaz de texto excessivo. Cada página usa Chromium145 sandbox, JavaScript de conteúdo desabilitado, origem fictícia fixa e HTML/PNG fornecidos pela automação a partir de bytes locais. Nenhuma requisição de conteúdo é encaminhada para rede. Isso não é isolamento de rede em nível de sistema operacional.

São coletadas duas amostras reais, estilos de imagem, fontes efetivamente informadas pelo CDP e arquivos correspondentes identificados pelo Fontconfig. Caminhos de fonte ficam restritos a /usr/share/fonts, nome PostScript precisa coincidir e os bytes são hashados. O manifesto identifica conteúdo, HTML, renderer, logos, fontes e Chromium. Não são inventados hashes substitutos para recursos desconhecidos: erro de proveniência faz o caso falhar. Esses dados não são aprovação de licença, exportação ou identidade binária futura de arquivos.

O primeiro diagnóstico não altera regras para aprovar resultados. A hipótese de IMG overflow clip será observada como dado real, preservando qualquer rejeição inesperada. Caso nominal rejeitado não pode ser contado como sucesso. O excesso precisa ser recusado. Não há geração de PDF, app HTTP, banco, integração ou deploy; R16 permanece intocado.

Execução única por marcador exclusivo, Node20 pinado, unidade systemd delimitada e temporário Chromium curto. Capturar unidade retida antes de STOP, conferir fechamento do browser, remoção do temporário e artefatos/hashes. A próxima versão depende de causa concreta e novo registro, não de retry automático.


Revisão pré-execução: o caso de excesso agora exige motivo geométrico/scroll, imagens/fontes prontas, ausência de erros e nenhuma regra de clipping como causa alternativa. O diretório temporário é registrado antes do launch; falha/fechamento incerto mantém o diretório e o diagnóstico, sem limpeza cega. A primeira versão2492 não foi executada. A captura de fontes identifica recursos observados naquele momento; não prova um inventário global congelado antes/depois.
