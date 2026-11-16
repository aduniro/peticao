# Fase B — ingresso público mínimo (preparação, não aplicada)

Esta fase requer manifesto e ACK próprios no protocolo único. Não está incluída
no manifesto privado da fase A, nem autoriza publicar o site/admin-v2.

Pré-condições: fase A saudável, usuários isolados, segredos independentes,
origem privada com HTTPS e revisão Owner funcionando. O gateway Codex continua
desabilitado até qualificação compatível com a versão efetiva do daemon.

## Opção preferida proposta: Funnel443 somente para o ingresso

Recomendação técnica para este canal de baixo volume: Funnel na443 encaminhando
apenas para127.0.0.1:8768. A inferência de menor complexidade decorre de dispensar
Caddy, A/AAAA públicos próprios e alterações do firewall. Não é uma prova de
latência ou disponibilidade. A opção ainda depende de manifesto/ACK exatos.

| Item | Funnel proposto | Caddy/Cloudflare futuro |
|---|---|---|
| Callback | `https://sonda-verifica3.tail1a6d71.ts.net/mailersend/inbound` | `https://exec.sancionaintegral.org/mailersend/inbound` |
| DNS da caixa exec | Somente MX para o provedor | MX e A/AAAA para a origem |
| TLS público | Gerenciado pela Tailscale no nome `.ts.net` | Qualificação ACME e caminho Cloudflare/origem |
| Superfície adicional | Um forward público443 para o ingresso | Caddy, regras80/443 e configuração de logs |

A documentação permite Serve e Funnel em portas distintas; a mesma porta muda
inteiramente para público ou privado conforme o último comando. Funnel admite
443/8443/10000 e nomes da Tailnet, exige MagicDNS/HTTPS e a capacidade funnel,
e possui limite de banda não configurável. Não suporta o domínio web customizado
exec.sancionaintegral.org. [Requisitos oficiais](https://tailscale.com/docs/features/tailscale-funnel).

O modelo oficial de configuração usa `AllowFunnel` por SNI:porta. O estado final
deverá conter somente `sonda-verifica3.tail1a6d71.ts.net:443=true`; a9443 deve
ficar ausente/false nessa lista e continuar com seu forward privado. O RDP3389
deve permanecer idêntico ao snapshot anterior. [Modelo de configuração](https://github.com/tailscale/tailscale/blob/main/ipn/serve.go).

Antes de qualquer mutação, ler versão/ajuda da CLI instalada e salvar os estados
Serve/Funnel. A capacidade nodeAttrs permite usar Funnel; a publicação efetiva
é controlada por host:porta. Não aprovar uma alteração automática de política
que amplie acesso a todos os membros nem tornar ops-ingress/ops-control operadores
da Tailscale. Se a capacidade necessária estiver ausente, registrar o impedimento
e qualificar uma alteração mínima separadamente.

Comandos de publicação/retorno abaixo são propostas para execução NA VPS somente
após ACK/lease e conferência da CLI instalada; não foram executados:

```sh
/usr/bin/sudo /usr/bin/tailscale funnel --bg --https=443 http://127.0.0.1:8768
/usr/bin/sudo /usr/bin/tailscale funnel status --json
/usr/bin/sudo /usr/bin/tailscale serve status --json
# Retorno, somente se o estado ainda corresponder ao forward que esta etapa criou:
/usr/bin/sudo /usr/bin/tailscale funnel --bg --https=443 http://127.0.0.1:8768 off
```

Usar proxy na raiz preserva o URI recebido; o próprio ingresso rejeita outros
paths/métodos. Não montar nenhum endpoint privado na443, mesmo sob outro path.
Nunca usar reset global. `--bg` preserva o forward após reboot; isso não substitui
supervisão, teste de recuperação ou os gates da fila. [CLI oficial](https://tailscale.com/docs/reference/tailscale-cli/funnel).

Antes de criar a rota MailerSend, provar por cliente fora da Tailnet:443 chega
ao ingresso;9443 e3389 não são públicos; outros paths/métodos são rejeitados
pelo ingresso e nunca chegam a outro serviço (GET405; POST de outro path404);
assinatura de teste só aceita schema de teste e nunca inbound.message; bytes
originais conferem com o HMAC; corpo acima256KiB é recusado antes202. Incluir
canário fictício em assinatura/corpo e conferir que não apareceu em logs.
Conferir também que o proxy mantém um Content-Length compatível com o ingresso
estrito; não remover validação de assinatura, limite ou proteção contra requests
ambíguos para acomodar uma transformação inesperada do proxy.

Medir o tempo até o202 durável em tentativas normais e sob a carga permitida.
Usar3s como orçamento conservador do callback; não prometer esse prazo pela
existência do Funnel. O provedor documenta timeout/retries, com certos4xx sem
retry; confirmar que a política cobre a rota inbound efetiva. Nunca responder
202 antes de fsync nem perder dedup para ganhar tempo. [Webhooks MailerSend](https://developers.mailersend.com/api/v1/account/webhooks).

Relays Funnel transportam TLS até o nó, onde ocorre a terminação. Isso não é
promessa de ausência de metadados/logs no nó ou no serviço. Manter logs de corpo
desabilitados e usar recibos/spool como evidência; não habilitar debug durante
a recepção de mensagens reais. [Arquitetura Funnel](https://tailscale.com/docs/features/tailscale-funnel).

## Alternativa futura: Caddy/Cloudflare

Somente `exec.sancionaintegral.org`, atualmente sem registros na consulta de
10/11/2026 às22:01UTC. Reconsultar antes de escrever e recusar conflitos.

- A para64.176.29.113. AAAA para2001:19f0:c800:2599:5400:7ff:fe07:7aab
  somente após comprovar IPv6 público funcional; ambos com proxy Cloudflare.
  Nenhum registro da produção é alterado.
- MX do subdomínio para inbound.mailersend.net, prioridade10. Preservar
  integralmente MX Proton do domínio principal e demais subdomínios.
- Proxy HTTPS externo em Santiago exclusivamente para POST
  `https://exec.sancionaintegral.org/mailersend/inbound`.
- Outros paths recebem404; o console, app-server, terminal e APIs privadas
  não aparecem nesse virtual host. Caddy limita corpo a256KiB e encaminha
  bytes/Signature para127.0.0.1:8768, sem registrar corpo/cookies/segredos.
- Propor regras80/443 no firewall Vultr apenas para ranges oficiais atuais
  da Cloudflare, conferidos no momento. Preservar todas as regras anteriores
  e acesso SSH/RDP/Tailnet. Qualificar a renovação ACME antes de depender disso.

O provedor de recepção já possui API de consulta acessível e nenhuma rota foi
encontrada nessa coleta. Usar o domínio raiz verificado existente, com
inbound_domain exec.sancionaintegral.org, catch_recipient executor,
match_all, include_attachments false e apenas o forward webhook acima.
Não criar assinatura paga, novo plano ou cobrança automaticamente.

Configuração futura preparada em
`/mnt/apps/peticao-final/_ops/controle-operacional/infra/Caddyfile.exec-ingress`.
É um arquivo standalone com bloco global; não importar nem substituir outro
Caddyfile sem inventário/revisão do operador. O admin API é desligado, para que
as identidades do ingresso não possam reconfigurar um listener localhost2019.
Mudanças posteriores exigem restart controlado desse proxy ou um socket de
administração protegido qualificado separadamente.

O arquivo permite um único upstream fixo, sem retry configurado ou alteração
de URI/corpo/Signature. Outros pedidos HTTPS recebem404. Automatic HTTPS permanece
habilitado; seu desafio de certificado pode usar o caminho HTTP reservado pelo
Caddy, independentemente do callback. [Proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[limite de corpo](https://caddyserver.com/docs/caddyfile/directives/request_body).

Não habilitar access logging. O filtro do logger runtime remove request,
headers, resp_headers e body; omitir access log sozinho não protege o logger
de erros. Antes de publicar, validar a versão efetiva com `/usr/bin/caddy validate`
e verificar falhas com canário fictício, inclusive logs. Não habilitar debug.
Os testes estáticos não substituem o adaptador/servidor Caddy real.
[Logs](https://caddyserver.com/docs/caddyfile/directives/log),
[opções globais](https://caddyserver.com/docs/caddyfile/options).

Com o proxy Cloudflare e firewall restrito a seus ranges, TLS-ALPN01 não chega
diretamente à origem. HTTP01 precisa comprovar que a URL de desafio alcança a
origem sem challenge ou redirect circular da Cloudflare; a renovação também
precisa desse caminho. Se falhar, registrar impedimento, sem abrir80/443 ao mundo,
relaxar SSL da zona inteira ou desabilitar WAF global. Uma alternativa de
certificado/DNS challenge exige novo escopo e credencial apropriada.
[Automatic HTTPS](https://caddyserver.com/docs/automatic-https).

Reconsultar e preservar as regras anteriores do firewall. Obter ranges IPv4/IPv6
da fonte oficial na execução, validar CIDRs e contar as regras necessárias,
sem usar lista congelada como autoridade atual. Se o limite do grupo não
comportar a adição, não remover regras antigas para caber.
[Ranges Cloudflare](https://www.cloudflare.com/ips/),
[Firewall Vultr](https://docs.vultr.com/products/network/firewall-groups).

## Bootstrap e pareamento

1. Publicar apenas o ingresso mínimo com configuração bootstrap. Nesse estado
   somente o ping webhook.test, assinado com a chave pública específica de
   teste e schema exato, pode ser aceito. Mensagens reais recebem503.
2. Validar externamente o HTTPS, o limite de corpo e a recusa de qualquer
   mensagem real com chave de teste. Conferir ausência de challenge/WAF no
   callback; não desabilitar proteções da zona inteira.
3. Criar a rota do provedor usando o callback da alternativa escolhida no
   manifesto (Funnel preferido; não reutilizar a URL Caddy por engano).
   Usar domain_id2p03479mkypgzdrn, inbound_domain exec.sancionaintegral.org,
   catch_recipient executor, match_all e include_attachments false.
   Ela faz o ping de reachability antes de salvar.
   Capturar seu segredo individual somente em memória/proteção0600; nunca
   imprimir o JSON bruto retornado pelo provedor.
4. Parear inbound_id, endereço do envelope gerado pelo provedor e endereço
   executor@exec.sancionaintegral.org em allowlists fixas. Gravar duas cópias
  0600 do segredo individual, cada uma pertencente ao seu usuário de serviço.
5. Atualizar somente as configurações próprias e reiniciar os dois serviços
   isolados. Confirmar que a chave pública de teste não autoriza mensagens.
6. Qualificar recebimento real rastreável e resposta somente ao Owner, sem
   instrução executável, sem OTP forjado e sem publicar aplicação. Aceite
   pelo provedor não equivale a entrega. Resultado incerto não é reenviado.

A capacidade de recepção/ACK/status não comprova ponte de IA ou GERAL operacional.
Pausas, limites, bloqueios e autorizações de deploy permanecem vigentes.

## Retorno

Desativar apenas a nova rota/forward e os registros criados, com evidência dos
IDs exatos. Na opção Funnel, remover somente o forward443 criado e conferir
que9443/3389 permaneceram iguais. Na opção Caddy, remover somente o virtual host
novo e suas regras adicionais. Preservar spool e filas para reconciliação.
Não restaurar banco da aplicação, remover MX existentes ou resetar Tailscale
Serve. O HTTPS privado9443 e RDP3389 são independentes do callback público.

Referências oficiais consultadas:

- https://developers.mailersend.com/api/v1/email/inbound
- https://developers.mailersend.com/api/v1/account/webhooks
- https://caddyserver.com/docs/caddyfile/directives/request_body
- https://caddyserver.com/docs/caddyfile/directives/log
- https://caddyserver.com/docs/caddyfile/options
- https://caddyserver.com/docs/automatic-https
- https://tailscale.com/docs/features/tailscale-funnel
- https://tailscale.com/docs/reference/tailscale-cli/funnel
- https://github.com/tailscale/tailscale/blob/main/ipn/serve.go
- https://www.cloudflare.com/ips/
- https://docs.vultr.com/products/network/firewall-groups
