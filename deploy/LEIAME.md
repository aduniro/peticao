# Hospedagem na VPS (Vultr, São Paulo, Debian 13)

Estado em 2026-10-31: instância `peticao-sp` (`vhp-2c-4gb-amd`) em `216.128.169.215`, IPv6 `2001:19f0:b800:266e:5400:6ff:fefd:6233`.
Firewall do Vultr (grupo `peticao-web`) já aplicado: **443 só dos IPs da Cloudflare** e **SSH (22) só do seu IP** (IPv4 e prefixo IPv6). Portas 80 e as demais estão fechadas.

## Ordem (tudo no ZORIN; os scripts pedem a senha do sudo da VPS)
1. `/mnt/dev/peticao/deploy/preparar.sh`: fixa o IPv6, instala Node 20, PostgreSQL, Caddy, ufw, fail2ban, atualizações automáticas, serviço e backup diário.
2. `/mnt/dev/peticao/deploy/publicar.sh`: envia o código, `npm ci`, `next build` e reinicia. Use **a cada mudança no app** (testes → publicar → conferir).
3. Teste por túnel (a 443 só abre para a Cloudflare, então de fora não há acesso direto):
   `ssh -L 8080:127.0.0.1:8080 peticao` e abra `http://localhost:8080`.
4. Segredos (na VPS, digitação oculta): `sudo bash peticao-stage/deploy/definir-segredo.sh CPF_BRASIL_API_KEY` (idem `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `SMTP_URL` ou `BREVO_API_KEY` com `MAIL_PROVIDER`, `RECIPIENTS`…), depois `sudo systemctl restart peticao`.
   - A senha do `/admin` foi gerada: leia com `sudo grep ADMIN_PASSWORD /etc/peticao/app.env` (só você vê).
   - **Nunca troque `HASH_PEPPER`** depois do lançamento.
   - Enquanto `MAIL_PROVIDER='dev'`, nenhum e-mail sai (as confirmações ficam numa pasta no servidor).

## Cloudflare (painel; sem token por enquanto)
1. Domínio na Cloudflare (ex.: `sancionaintegral.org`). **DNS → Records**, todos com a nuvem laranja (proxied):
   - `A` `@` → `216.128.169.215`
   - `AAAA` `@` → `2001:19f0:b800:266e:5400:6ff:fefd:6233`
   - `CNAME` `www` → `@`
   Registros de e-mail (MX, SPF, DKIM, DMARC) ficam **DNS only** (nuvem cinza).
2. **SSL/TLS → Overview**: modo **Full (strict)**. **Edge Certificates**: *Always Use HTTPS* ligado, TLS mínimo 1.2.
3. **SSL/TLS → Origin Server → Create Certificate** (hosts: `@` e `*.seudominio`). Copie o certificado e a chave **só para a VPS**:
   `sudo mkdir -p /etc/caddy/certs && sudo nano /etc/caddy/certs/origin.pem` (cole o certificado) e `sudo nano /etc/caddy/certs/origin.key` (cole a chave). Não mande a chave por e-mail/mensageiro nem a cole aqui na conversa.
4. Na VPS: `sudo bash peticao-stage/deploy/ativar-dominio.sh seudominio.org` (configura o Caddy, `APP_URL`, `ALLOWED_HOSTS` e `TRUST_CF_HEADER=1`).
5. Opcional: *Security → WAF → Rate limiting* para `/api/assinar`; *Bot Fight Mode*.
Quando você gerar o token da Cloudflare (`node /mnt/dev/peticao/tools/infra/chave.mjs cloudflare`), eu automatizo os registros DNS.

## Firewall (Vultr) — comandos úteis (no Zorin)
    V="node /mnt/dev/peticao/tools/infra/vultr.mjs"
    $V firewall:listar
    $V firewall:liberar-ssh c20a68b5-1c14-4a9d-9d85-c0160a053d08 <novo_ip>   # se o IP de casa mudar
Se perder o SSH: console VNC do Vultr (usuário e senha do Debian; sem maiúsculas) ou desanexar o grupo no painel (Instance → Firewall).
As faixas da Cloudflare mudam raramente; para atualizar, crie um grupo novo com `firewall:criar-site`, aplique e apague o antigo.

## Diagnóstico
    sudo systemctl status peticao caddy postgresql
    sudo journalctl -u peticao -n 80 --no-pager
    sudo ufw status verbose        sudo fail2ban-client status sshd
    sudo /usr/local/bin/peticao-backup && ls -la /var/backups/peticao

## Git na VPS (a partir de 2026-11-05)
O projeto passa a ter git também na VPS. Ramos: `main` = v1 preservada; `producao` = o que está no ar; `admin-v2` = desenvolvimento do painel novo.
Instalação (UMA vez, na sua máquina; o comando sai por e-mail):
    scp /mnt/dev/peticao-parcial/deploy/20-git-vps.sh /mnt/dev/peticao-parcial/deploy/peticao-atualizar-stage.sh peticao-root:/root/ && ssh peticao-root 'bash /root/20-git-vps.sh'
Fluxo de uma mudança:
1. Commit no ramo `producao` (cópia isolada `/mnt/dev/peticao-parcial`, que espelha a produção).
2. `git -C /mnt/dev/peticao-parcial push vps producao`: o gancho atualiza o `peticao-stage` (só avanço; histórico reescrito é recusado; o que não está no git, como `geo-data`, `data` e segredos, não é tocado).
3. Deploy como sempre: `ssh peticao-root /usr/local/sbin/peticao-deploy`. O arquivo `VERSAO` do stage guarda o commit enviado.
Modificar de dentro da VPS: clone de trabalho `/home/adunir/peticao` (`git pull`, editar, `git commit`, `git push origin producao`). O `rsync` antigo para o stage continua funcionando enquanto o git não for validado.

## Publicação vinculada ao candidato (integração de 06/11 — não instalada)

A revisão de integração substitui o sinal antigo que publicava qualquer conteúdo presente no stage. O candidato passa a ter manifesto de código sob controle de root, com SHA-256 da árvore e commit informativo. A Central envia o hash obtido na simulação; o executor verifica a identidade e o publicador verifica origem/cópia novamente antes de trocar a aplicação. Alterações durante a compilação recusam a publicação.

A instalação exige o conjunto consistente desta versão: `publication.py`, `03-instalar-app.sh`, `peticao-atualizar-stage.sh` e `23-publicacao-segura.sh`, seguidos de `21-publicar.sh` e `peticao-publicar-executar.sh` para o botão. O 23 instala os arquivos fixos e faz backup do publicador anterior; **não publica o app**. Não executar o antigo 05 apenas para atualizar o publicador, pois ele também configura outros serviços.

Após preparar o stage, root executa `/usr/local/sbin/peticao-publicar-preparar`. O atualizador Git novo faz isso automaticamente quando executado como root. A simulação passa então a mostrar o candidato disponível. Sem descritor válido, o botão não habilita a confirmação de publicação. Toda instalação/publicação desta integração aguarda autorização final do responsável.

O comando manual continua sem argumentos e vincula sua cópia à origem capturada no início. A ferramenta `tools/cpf-name-rule/deploy.py` desta mesma versão compartilha a trava durante backup, preparação e eventual rollback. Usar ferramentas e instaladores da mesma versão; não misturar o script antigo com o publicador atualizado.

Testes de infraestrutura: `python3 -m unittest discover -s deploy/test -v`. Ensaio do banco a partir de `site/`, usando porta/diretório de desenvolvimento isolados: `node scripts/with-db.mjs ./node_modules/.bin/tsx ../deploy/test/admin-schema-upgrade.mjs`. O ensaio recusa banco remoto e exige `DEV_DB_PORT` explícita. Nunca apontar os testes para produção.

### Protocolo do Terminal integrado

O app novo consulta `/protocolo` antes de enviar um comando ao serviço local. Exige `terminal-ndjson-signed-v1`; serviço antigo não recebe comandos por esse caminho. A nova versão de `terminal-servico.mjs` mantém a saída textual para clientes antigos e oferece resultado autenticado para o app novo. Publicar o código e instalar/atualizar o serviço pelo conjunto consistente desta versão, somente após autorização; não copiar apenas o handler. O Terminal continua desligado por padrão e exige Total com confirmação extra para ser ligado/usado. Não há necessidade de alterar `HASH_PEPPER` ou os dados de assinatura.
