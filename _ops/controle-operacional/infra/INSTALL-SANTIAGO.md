# Instalação isolada em Santiago — roteiro para o integrador

Estado: arquivos preparados; este roteiro não instala nem ativa serviços. Executar somente após commit exato, testes, manifesto, ACK da outra sessão e lease vigente. Não é autorização de deploy do site/admin-v2.

Fonte local: `/mnt/apps/peticao-final/_ops/controle-operacional`.
Destino exclusivo: VPS `sonda-verifica3`, alias SSH administrativo `cluster-santiago`, Tailnet `100.80.18.81` / `fd7a:115c:a1e0::3e2f:1252`.

## Fronteiras e caminhos na VPS

| Caminho absoluto na VPS | Proprietário e modo | Finalidade |
|---|---|---|
| `/opt/peticao-ops` | `root:root`, diretórios 0755/fontes 0644 | Cópia somente das fontes do commit qualificado, sem `.git`, provas, configurações ou dados |
| `/etc/peticao-ops` | `root:root`, 0711 | Travessia para os dois diretórios privados abaixo |
| `/etc/peticao-ops/control` | `ops-control:ops-control`, 0700 | Configuração, chave do proprietário e API token; arquivos 0600 |
| `/etc/peticao-ops/ingress` | `ops-ingress:ops-mail`, 0700 | Configuração da rota e segredo de assinatura do fornecedor; arquivos 0600 |
| `/srv/ops-console` | `ops-control:ops-control`, 0700 | Catálogo, OTP, grant e fila de deploy privada |
| `/srv/ops-executor` | `ops-control:ops-control`, 0700 | Banco/fila duráveis do executor e diário do processador |
| `/srv/ops-ingress` | `ops-ingress:ops-mail`, 0750 | Spool assinado; diretórios 0750 e registros 0640 |

Criar contas de sistema sem shell/login/sudo: `ops-control` (grupo primário próprio, suplementar `ops-mail`) e `ops-ingress` (grupo primário `ops-mail`). O grupo privado `ops-mail` deve conter somente essas duas contas; `ops-control` lê o spool, mas não o modifica. Nenhuma conta recebe chaves administrativas gerais, acesso Docker ou credenciais da aplicação.

O ingress lê apenas `/etc/peticao-ops/ingress/provider-forward.secret`, 0600 e pertencente a `ops-ingress`. O revalidador privado recebe uma cópia 0600 do mesmo segredo em `/etc/peticao-ops/control/provider-forward.secret`, pertencente a `ops-control`. Não compartilhar chaves Owner, approval, provider interno, API token ou auth-pepper com o processo público.

## Configuração privada

Inicializar o catálogo como `ops-control`, já com diretórios/proprietários definidos:

```sh
/usr/sbin/runuser -u ops-control -- /usr/bin/python3 /opt/peticao-ops/console/console.py --root /srv/ops-console init --origin https://sonda-verifica3.tail1a6d71.ts.net:9443
```

O comando gera auth-pepper independente em `/srv/ops-console/auth-pepper`. Manter `production_enabled:false`. Não copiar o `HASH_PEPPER` ou arquivos de ambiente da aplicação. A configuração `/etc/peticao-ops/control/executor.json` segue `/opt/peticao-ops/executor/README.md`; gerar chaves internas independentes e armazená-las sem stdout, argumentos CLI, Git ou relatórios. Mapear somente as sessões autorizadas. A composição atual não habilita ponte Codex real nem execução de deploy.

O token de envio fica em `/etc/peticao-ops/control/mailersend-api-token`, 0600, pertencente a `ops-control`; usar credencial restrita ao necessário. O transporte entrega exclusivamente a operator-78ffa47eeb@example.invalid`. Aceite do fornecedor não comprova entrega.

Configuração `/etc/peticao-ops/control/ingress.json` (metadados ilustrativos; substituir somente com valores reais retornados pelo fornecedor):

```json
{
  "spool_root": "/srv/ops-ingress",
  "secret_file": "/etc/peticao-ops/control/provider-forward.secret",
  "inbound_id": "bootstrap-not-configured",
  "recipients": ["executor@exec.sancionaintegral.org"]
}
```

`/etc/peticao-ops/ingress/route.env` contém somente metadados, nunca segredos:

```ini
OPS_INBOUND_ID=bootstrap-not-configured
OPS_EXECUTOR_RECIPIENT=executor@exec.sancionaintegral.org
OPS_PROVIDER_RECIPIENT=bootstrap@inbound.mailersend.net
OPS_MAIL_GID=SUBSTITUIR_PELO_GID_NUMERICO_REAL
```

O instalador deve obter o GID real de `ops-mail`; não usar literalmente o marcador. O segundo destinatário é substituído pelo endereço gerado pelo fornecedor assim que a rota for criada. `route.env` é lido pelo systemd; a aplicação aceita somente destinatários fixos de uma allowlist administrativa de até quatro endereços.

## Bootstrap e ativação da rota de e-mail

1. Preparar/validar fontes e unidades antes de publicar o endpoint. Com segredo de encaminhamento ainda ausente, o ingress permite somente `webhook.test` com esquema exato e a assinatura pública de teste documentada pelo fornecedor. Esse teste não cria instrução nem usa a quota de mensagens reais. `inbound.message` continua retornando 503 até pareamento completo.
2. Instalar proxy HTTPS mínimo e tornar alcançável apenas `POST /mailersend/inbound` em `exec.sancionaintegral.org`. Conferir conflitos DNS, Caddy e firewall antes de qualquer alteração. Preservar MX da raiz Proton e demais rotas existentes. Não abrir portas 8767/8768 na interface pública e não usar Funnel para o console.
3. Criar a rota do fornecedor com URL `https://exec.sancionaintegral.org/mailersend/inbound`; guardar ID, endereço gerado e segredo de encaminhamento diretamente em arquivos protegidos. Não imprimir resposta bruta contendo segredo. Sem upgrade pago implícito.
4. Atualizar `route.env`, a allowlist e ID de `/etc/peticao-ops/control/ingress.json` e as duas cópias 0600 do segredo. Conferir proprietários/modos antes de reiniciar os serviços isolados. O segredo público de teste nunca autentica `inbound.message`.
5. Conferir o MX específico de `exec.sancionaintegral.org` conforme a resposta do fornecedor; não alterar MX de `sancionaintegral.org`. Validar receipt de provedor, spool durável, revalidação privada e staging `pending_owner_confirmation` antes de anunciar recebimento operacional. Nenhuma mensagem comum pode virar execução sem confirmação Owner do hash congelado.

O proxy deve preservar os bytes do corpo e o header `Signature`, recusar corpos acima de 256 KiB e encaminhar para `127.0.0.1:8768`. Todos os outros métodos/caminhos públicos retornam erro, incluindo `/healthz`. TLS, autenticação e proteção do endpoint precisam de teste real após instalação; testes sintéticos não os substituem. Se ACME HTTP for escolhido, planejar portas públicas 80/443 e emissão do certificado; nenhum outro serviço deve ser exposto por essa abertura. Não presumir Caddy, certificado ou regras de firewall já instalados.

## Unidades e isolamento

Fontes locais das unidades:

- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/systemd/ops-control.service`
- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/systemd/ops-ingress.service`

Destinos na VPS: `/etc/systemd/system/ops-control.service` e `/etc/systemd/system/ops-ingress.service`.

Cada unidade limita CPU a 25% de um núcleo, RAM a 256 MiB, não tem capabilities e restringe gravação aos seus diretórios. O ingress usa rede somente loopback, via `IPAddressDeny=any`/`IPAddressAllow=localhost`; confirmar suporte efetivo do kernel/cgroup. O control necessita saída HTTPS/DNS para o fornecedor de e-mail; sua entrada HTTP continua exclusivamente loopback. Nenhuma unidade inicia builds, containers, shell remoto ou servidor Codex novo.

Validar unidades no destino antes de qualquer start (este roteiro não executou estes comandos):

```sh
/usr/bin/systemd-analyze verify /etc/systemd/system/ops-control.service /etc/systemd/system/ops-ingress.service
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl start ops-ingress.service ops-control.service
/usr/bin/systemctl status --no-pager ops-ingress.service ops-control.service
```

Os comandos administrativos exigem root/usuário sudo já autorizado. Depois de comprovar saúde, limites, reinício e persistência, o integrador pode habilitar o boot dessas duas unidades; não criar um novo timer de relatórios.

## Console pela Tailnet

Origem privada exata: `https://sonda-verifica3.tail1a6d71.ts.net:9443`, proxy para `http://127.0.0.1:8767`. Antes e depois da mudança, capturar a configuração Serve e confirmar que o encaminhamento RDP 3389 continua intacto. Não executar `tailscale serve reset` nem substituir toda a configuração.

Comandos para o integrador, somente depois do ACK e qualificação:

```sh
/usr/bin/tailscale serve status --json
/usr/bin/tailscale serve --bg --https=9443 http://127.0.0.1:8767
/usr/bin/tailscale serve status --json
```

Verificar acesso pela Tailnet dos dispositivos autorizados e o fluxo Owner/OTP/CSRF, cookies Secure, revisão por texto e grant preso à versão. Estar na Tailnet não concede autoridade Owner ou permissão de deploy. Não expor terminal, app-server, banco, SSH administrativo ou dashboard pelo endpoint de e-mail.

## Aceite, retorno e pendências

Registrar commit/hash das fontes efetivamente instaladas, configurações sanitizadas, limites ativos, testes, resultado de reinício e destino. Segredos e corpos de e-mail permanecem fora do Git e do relatório. O retorno interrompe somente as novas unidades e remove apenas as novas rotas/proxies sob seu manifesto; preservar filas/spool para reconciliação e não reenviar mensagens incertas.

Ainda pendem: instalação/qualificação real, callback externo e entrega real, ponte Codex real qualificada, orquestração global completa e migração coordenada do mecanismo único de relatório para a VPS. O scheduler de relatório atual continua local até cutover com fencing e desativação da cópia anterior. Não afirmar que o sistema ou o modelo opera 24h antes de comprovar essas etapas. Nenhum comando deste documento foi executado por sua elaboração.
