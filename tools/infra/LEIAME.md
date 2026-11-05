# Infraestrutura: chaves de API e ISO Linux no Vultr

Ferramentas **fora do app** (o site não usa estas chaves). Nada aqui imprime a chave.

## 1. Gravar a chave do Vultr (você digita, ninguém vê)
Antes, no painel: **my.vultr.com → Account → API**: ative o acesso, gere a chave e, em **Access Control**, permita o **seu IP público** (ou deixe "Any IPv4" só durante a configuração; se restringir sem o seu IP, a chave não funciona).

Num terminal comum:

    node /mnt/dev/peticao/tools/infra/chave.mjs vultr

Cole a chave (não aparece na tela) e tecle Enter. O script grava em `~/.config/peticao-infra/keys.env` (pasta 700, arquivo 600), com o comentário `# CHAVE API PARA VULTR (...)` acima da chave, e testa a conexão com o Vultr. Resultado esperado: `Conexão OK com o Vultr. Conta: …`.

- Ver o que está gravado (só nomes e comentários): `node /mnt/dev/peticao/tools/infra/chave.mjs --listar`
- Trocar a chave: rode o mesmo comando de novo. Remover: `… chave.mjs vultr --remover`.
- Cloudflare (quando gerar o token): `node /mnt/dev/peticao/tools/infra/chave.mjs cloudflare`.

## 2. Enviar a ISO (links diretos conferidos em 2026-10-31)
O Vultr exige **link direto, sem redirecionamento, sem `?`**, ISO < 10 GB, **no máximo 2 ISOs por conta**.

| ISO | Link |
|---|---|
| Ubuntu Server 24.04.4 LTS (3,17 GB) | `https://releases.ubuntu.com/24.04.4/ubuntu-24.04.4-live-server-amd64.iso` |
| Ubuntu Server 24.04.5 (mais nova, 3,80 GB) | `https://releases.ubuntu.com/24.04.5/ubuntu-24.04.5-live-server-amd64.iso` |
| Debian 13 netinst | o link oficial **redireciona**; use o do espelho final que o script indicar |

    V="node /mnt/dev/peticao/tools/infra/vultr.mjs"
    $V conta                      # confirma a chave e a conta
    $V regioes                    # confirme o código de São Paulo (sao)
    $V iso:criar https://releases.ubuntu.com/24.04.4/ubuntu-24.04.4-live-server-amd64.iso --verificar-local
    $V iso:status <id> --esperar  # aguarda ficar pronta

`--verificar-local` baixa a ISO (3 GB) para `/mnt/dev/peticao/.cache/iso/`, confere o SHA-256 com o `SHA256SUMS` oficial do mesmo diretório e apaga o arquivo. Para Debian use `--sha512 <hash do SHA512SUMS oficial>` no `iso:status`.

## 3. Criar a máquina e instalar
    $V instancia:criar --iso <id> --plano vhf-2c-4gb --regiao sao --rotulo peticao-sp --hostname peticao-sp --backups
    # (sem --sim só SIMULA e mostra o que seria enviado; com --sim cria e a cobrança por hora começa)
    $V instancia:criar --iso <id> --plano vhf-2c-4gb --regiao sao --rotulo peticao-sp --hostname peticao-sp --backups --sim

1. No painel: **Instances → sua máquina → View Console** e conclua o instalador (usuário, senha, marque **OpenSSH server**; se puder, cole a sua chave pública SSH).
2. **Solte a ISO**, senão a máquina reinicia no instalador: `$V instancia:destacar-iso <id-da-instancia>`.
3. Depois: SSH só por chave, `ufw` (80/443 só dos IPs da Cloudflare), atualizações automáticas (`unattended-upgrades`), grupo de firewall do Vultr.

## Limites e cuidados
- A ISO instalada à mão **não** recebe chave SSH nem cloud-init automáticos.
- Lembre que a API `vultr.com/api` não pôde ser lida automaticamente; campos como `status` da ISO foram confirmados pelo cliente oficial. Se algo divergir, o erro aparece na primeira chamada.
- Testes: `cd /mnt/dev/peticao/tools/infra && node --test test/`.
