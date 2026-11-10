# SSH administrativo privado entre três máquinas

Configurado em 10/11/2026, porta TCP2223, somente endereços da Tailnet. Seis direções validadas em IPv4 e IPv6:12 conexões BatchMode com identidade/hostname corretos. Sudo sem senha confirmado nos destinos Santiago e São Paulo. Não foi concedido sudo local nesta etapa.

| Alias | Destino/usuário | IPv4 Tailnet | IPv6 Tailnet |
|---|---|---|---|
| cluster-local | barre@máquina local |100.105.193.63|fd7a:115c:a1e0::e33b:c13f|
| cluster-santiago | sonda@sonda-verifica3 |100.80.18.81|fd7a:115c:a1e0::3e2f:1252|
| cluster-sp | adunir@peticao-sp |100.109.6.122|fd7a:115c:a1e0::8e2f:67b|

Os mesmos aliases estão disponíveis nas três contas. Para IPv6 explicitamente, acrescente `-ipv6`:cluster-local-ipv6, cluster-santiago-ipv6, cluster-sp-ipv6. Exemplos independentes do diretório atual:

`/usr/bin/ssh cluster-santiago`

`/usr/bin/ssh cluster-sp '/usr/bin/id -un'`

`/usr/bin/ssh cluster-local-ipv6 '/usr/bin/hostname'`

Cliente e autorização separados:

- Local: `/home/barre/.ssh/config_admin_mesh`, incluído no início de `/home/barre/.ssh/config`; `/home/barre/.ssh/id_admin_v2_mesh`; `/home/barre/.ssh/authorized_keys_admin_mesh`; `/home/barre/.ssh/known_hosts_admin_mesh`.
- Santiago: `/home/sonda/.ssh/config_admin_mesh`, incluído no início de `/home/sonda/.ssh/config`; `/home/sonda/.ssh/id_admin_v2_mesh`; `/home/sonda/.ssh/authorized_keys_admin_mesh`; `/home/sonda/.ssh/known_hosts_admin_mesh`.
- São Paulo: `/home/adunir/.ssh/config_admin_mesh`, incluído no início de `/home/adunir/.ssh/config`; `/home/adunir/.ssh/id_admin_v2_mesh`; `/home/adunir/.ssh/authorized_keys_admin_mesh`; `/home/adunir/.ssh/known_hosts_admin_mesh`.

Cada chave privada foi gerada na própria máquina/conta e permaneceu lá. Nenhum conteúdo de chave privada foi lido, impresso ou transferido. Apenas arquivos `.pub` foram usados para autorizar os outros dois nós. Hostkeys foram geradas separadamente e suas partes públicas foram obtidas através das conexões administrativas existentes e pinadas. `from` restringe cada chave aos dois IPs Tailnet do seu nó de origem; `restrict,pty` permite terminal e execução normal e bloqueia forwarding/agent/X11. Autenticação por senha, root e keyboard-interactive estão desabilitadas na nova porta.

Serviço local sem root:

- Configuração `/home/barre/.config/admin-v2-mesh/sshd_config`.
- Hostkey `/home/barre/.config/admin-v2-mesh/ssh_host_ed25519_key`.
- Unidade `/home/barre/.config/systemd/user/admin-mesh-sshd.service`.
- Consulta `/usr/bin/systemctl --user status admin-mesh-sshd.service`.
- Não há limite pequeno de memória na unidade SSH.
- Linger=yes já existia e foi somente consultado. Sem linger, um serviço de usuário depende da sessão ativa; não foi tentada habilitação de linger com sudo.

Nas duas VPSs:

- Configuração `/etc/ssh/admin-mesh/sshd_config`.
- Hostkey `/etc/ssh/admin-mesh/ssh_host_ed25519_key`.
- Unidade `/etc/systemd/system/admin-mesh-sshd.service`.
- Consulta `/usr/bin/systemctl status admin-mesh-sshd.service`.

Portas22 e2222, Tailscale SSH, shells das contas existentes e serviços da aplicação não foram alterados. Conta da aplicação peticao em São Paulo permanece `/usr/sbin/nologin`. Backups aditivos de configurações anteriores levam sufixo `.before-admin-mesh-AAAAmmddTHHMMSSZ` no mesmo diretório; nenhuma configuração original foi removida.

Artefatos locais, sem conteúdo privado:

- Instalador `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/admin_mesh.py`.
- Somente metadados e chaves públicas `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/admin-mesh-public.json`.
- Matriz das12 conexões `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/admin-mesh-validation.json`.
- Endereços de escuta e shell da conta de aplicação `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/admin-mesh-listeners.json`.

O instalador aceita bootstrap/configure, usando os aliases administrativos existentes peticao-root e sonda-verifica3-root. Não executa upgrade, instalação de pacotes, operações em bancos, código da aplicação ou Git. Nenhum commit realizado.
