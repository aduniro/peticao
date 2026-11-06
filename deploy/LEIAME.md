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

## Login por usuário com 4 níveis (Etapa A; ainda NÃO publicado)
Níveis (cada um inclui os de baixo): **leitura** (consultas e estatísticas) < **edição** (corrige cadastros, e-mails, domínios, filas; vê dados de contato) < **exclusão** (reservado) < **total** (lotes, envio ao Governo, WhatsApp, usuários).
Transição segura: a senha única de hoje continua valendo ENQUANTO NÃO EXISTIR nenhum usuário. O primeiro usuário cadastrado desliga a senha única na hora; se o banco falhar, ela é negada (nunca liberada).
Ordem na publicação (os comandos são sempre enviados por e-mail, com caminho completo):
1. Deploy normal (`peticao-deploy`). As 3 tabelas novas (`admin_users`, `admin_sessions`, `admin_reset`) são criadas sozinhas, aditivas; nada muda para o público.
2. Abrir o painel uma vez (para o site criar as tabelas) e então criar o dono, **na VPS, com a senha digitada sem eco**:
   `ssh -t peticao-root 'cd /opt/peticao/app && node scripts/admin-dono.mjs operator-1608598f41@example.invalid "Nome do dono"'`
3. A partir daí o painel pede e-mail e senha. O dono cadastra os demais em `/admin/usuarios` (cada pessoa recebe um convite por e-mail para criar a própria senha; nenhuma senha é enviada ou mostrada) e pode trocar a própria em `/admin/conta`. "Esqueci minha senha" em `/admin/esqueci`.
Segurança: sessão guardada no banco (só o hash do token), 4 h, revogada ao sair, ao trocar a senha ou ao desativar o usuário; o nível vem sempre do banco; 5 senhas erradas bloqueiam a conta por 15 minutos; o painel nunca fica sem um usuário de nível total ativo. Um teste varre todas as rotas de `/api/admin` e as páginas do `/admin` e falha se alguma não exigir nível, ou se o antigo `isAdmin()` voltar.

## Central de Ações, Publicar e Terminal (Etapa B e C; ainda NÃO publicados)
Tudo exige nível **total** e a **confirmação extra**: o painel pede a senha de novo e um código de 6 dígitos enviado ao e-mail do próprio usuário (vale 10 min; libera por 15 min).
- **Central de Ações** (`/admin/acoes`): ver o estado, ligar/parar o reenvio das confirmações (simular → digitar `REENVIAR`/`PARAR`), ver e pedir a publicação, ligar/desligar o Terminal. Cada execução fica em `admin_acoes` e na auditoria. As 4 tabelas novas (`admin_stepup`, `admin_acoes`, `contact_replies`, mais as da Etapa A) são criadas sozinhas e são aditivas.
- **Respostas de contato** (`/admin/contato`): prévia dos dois e-mails (só texto agora; card com QR pessoal ~1 min depois, só se a pessoa tiver código pessoal); não duplica.
- **Botão Publicar** (instalar UMA vez, como root; não publica nada ao instalar):
  `scp /mnt/dev/peticao-parcial/deploy/21-publicar.sh /mnt/dev/peticao-parcial/deploy/peticao-publicar-executar.sh peticao-root:/root/ && ssh peticao-root 'bash /root/21-publicar.sh'`
  O site só grava um arquivo-sinal com um id; um serviço root fixo (`peticao-publicar-executar`) valida o sinal e roda sempre o mesmo `peticao-deploy` sobre o que já está no `peticao-stage` (o painel não envia código). Resultado em `/var/lib/peticao-publicar/`. Remover: `bash /root/21-publicar.sh --remover`.
- **Terminal** (instalar UMA vez, como root; fica DESLIGADO até ser ligado na Central, por no máximo 60 min):
  `scp /mnt/dev/peticao-parcial/deploy/22-terminal.sh /mnt/dev/peticao-parcial/site/scripts/terminal-servico.mjs peticao-root:/root/ && ssh peticao-root 'bash /root/22-terminal.sh && systemctl restart peticao'`
  Serviço separado (`peticao-terminal`, usuário `peticao-term`): só 127.0.0.1, sem rede externa, sem acesso a `/opt/peticao`, `/etc/peticao`, `/var/lib/peticao`, `/home`, `/root`; um comando por vez, 60 s e 200 KB; ticket assinado de uso único amarrado ao comando; cada comando é registrado (auditoria + journal). O que precisar de administrador continua indo por e-mail. Remover: `bash /root/22-terminal.sh --remover`.
Ordem sugerida: (1) deploy normal; (2) criar o dono (`admin-dono.mjs`, ver acima); (3) instalar Publicar; (4) instalar Terminal; (5) testar cada um no painel.
