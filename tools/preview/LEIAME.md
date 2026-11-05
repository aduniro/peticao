# Pré-visualização isolada da petição (para a ADUNIR revisar)

## O que é
O site e o Postgres rodam dentro de um **sandbox (bubblewrap)**: sem rede, sem acesso ao seu `$HOME`, a `/mnt`, `/media` ou a
qualquer outro disco; sistema somente leitura; limites de memória/CPU. A única saída é um **socket Unix**. À frente de tudo
(páginas, API, arquivos) há uma **página de senha**. Dados fictícios; e-mails só aparecem em `/dev/outbox`; nada é enviado.

## 0. Acesso aberto (padrão atual)
Por padrão a pré-visualização NÃO tem mais página de senha (`PREVIEW_PUBLIC=1`): quem tiver o link da internet (Funnel) entra. O sandbox continua sem rede e sem acesso ao computador (`preview.sh check`). A caixa de e-mails de teste `/dev/*` só abre localmente (404 para quem vem da internet). Para voltar à senha: `PREVIEW_PUBLIC=0 preview.sh stop && PREVIEW_PUBLIC=0 preview.sh start`.

## 1. Registrar a senha de acesso (só se usar `PREVIEW_PUBLIC=0`) (uma vez; rode você mesmo, num terminal)
    cd /mnt/dev/peticao/site && npm run preview:senha
A senha é digitada sem aparecer na tela e **não é guardada**: só um hash scrypt com sal aleatório em
`/mnt/dev/peticao/preview-state/gate/password.scrypt` (permissão 600). Para trocar, rode de novo (isso derruba as sessões abertas).
Sem tamanho mínimo e sem regra de formato: pode ser só letras, uma palavra, uma frase com espaços e acentos, símbolos ou emoji.

## 1b. Janela de identidade na pré-visualização
O sandbox já traz um CPF **fictício** para testar a janela de identidade sem consumir a API real:
CPF `529.982.247-25` · nascimento `15/08/1985` · nome da mãe `Ana Maria da Conceição` (arquivo `preview-state/cpf-mock.json`, usado só enquanto não houver chave real na pré-visualização).
Para usar a chave real no preview: `cd /mnt/dev/peticao/site && npm run chave:cpf -- --preview` e reinicie (`preview.sh stop` e `start`). Com chave real gravada, o mock é ignorado.

## 2. Subir / parar / conferir
    /mnt/dev/peticao/tools/preview/preview.sh start     # sobe (compila na primeira vez)
    /mnt/dev/peticao/tools/preview/preview.sh status
    /mnt/dev/peticao/tools/preview/preview.sh check     # prova o isolamento (deve terminar com "ISOLAMENTO OK")
    /mnt/dev/peticao/tools/preview/preview.sh logs
    /mnt/dev/peticao/tools/preview/preview.sh admin-senha   # senha do painel /admin (aleatória, diferente da de acesso)
    /mnt/dev/peticao/tools/preview/preview.sh stop
Localmente: http://127.0.0.1:3100 (muda com PREVIEW_PORT).

## 3. Abrir na internet (Tailscale Funnel, já instalado; não abre porta no roteador)
Pré-requisito, uma vez, no painel https://login.tailscale.com/admin : habilitar **HTTPS Certificates** (aba DNS) e permitir
**Funnel** para este computador (aba Access controls, atributo `funnel`). Depois:

    sudo tailscale set --operator=$USER                       # só se o comando abaixo reclamar de permissão
    tailscale funnel --bg unix:/mnt/dev/peticao/preview-state/run/app.sock
    tailscale funnel status                                    # mostra a URL pública https://dell3576-zorin.tail1a6d71.ts.net

Para que os links dos e-mails de teste apontem para a URL pública, reinicie com ela:

    /mnt/dev/peticao/tools/preview/preview.sh stop
    PREVIEW_URL=https://dell3576-zorin.tail1a6d71.ts.net /mnt/dev/peticao/tools/preview/preview.sh start

**Fechar a porta:** `tailscale funnel reset` (e `preview.sh stop`).
A URL contém o nome deste computador. Quem não tiver a senha só vê a página de senha.

## O que o sandbox NÃO impede
- Quem tiver a senha pode usar o site de teste (assinar com dados fictícios, ver `/dev/outbox`). Não use dados reais nele.
- Um bug do próprio `bwrap`/kernel poderia, em tese, permitir escape; por isso a pré-visualização é só de dados fictícios,
  sem chaves nem certificados, e deve ficar no ar apenas durante a revisão.
