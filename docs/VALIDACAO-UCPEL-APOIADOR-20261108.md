# UCPel reconhecida no Apoiador

Pedido autorizado em08/11/2026. A regra anterior do candidato já permitia domínio
acadêmico não federal no Apoiador. Acrescentado reconhecimento explícito de
`ucpel.edu.br` e `sou.ucpel.edu.br`, sem sugerir substituir pela UFPel e sem promover
esses domínios a IFES ou alterar a tabela de produção.

Validação após a alteração:196/196 testes cumulativos aprovados, build e tipos
aprovados, quatro cenários de navegador com backend compilado/banco real local e
provedores simulados. O caso Apoiador usou endereço fictício @ucpel.edu.br,
verificou ausência de sugestão @ufpel.edu.br e concluiu identidade/assinatura.
O caso Servidor continuou recusando UCPel com uma única janela no envio. Testes
adicionais cobrem os dois domínios, caixa alta, sintaxe inválida, imitações de
domínio, domínio sem MX e recusa no Servidor. Nenhum transporte externo ou CPF real.

Artefatos privados em `/home/barre/.cache/peticao-honeypot-qa-20261108/`:
`all-ucpel.log`, `build.log`, `browser-results.json` e `browser.log`.

Recomparação somente leitura da VPS:680 arquivos; nenhum drift desde a primeira
captura. A base61edd21 não tem diferenças de código de execução em relação ao
publicado; sete testes diferem. A cópia inclui o admin atualmente publicado, não
o admin-v2 novo. Banco, configuração e segredos de produção não foram copiados.

Alteração apenas local, no candidato isolado. Sem deploy. Integrar o checkpoint
localmente ao candidato completo do admin-v2 em etapa própria, com nova regressão.
