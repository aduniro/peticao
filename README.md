# Ambiente distribuído Petição

Estado: preparação; **nenhum nó instalado ou qualificado ainda**. O estado observado,
as restrições de produção e os próximos gates ficam em `state/checkpoint.json`
(privado, não versionado). Não interpretar arquivos de configuração como serviços ativos.

Raiz central: `/mnt/apps/peticao-final`. Runtime separado: `/var/lib/peticao-k3s`.
Versão fixada: K3s `v1.37.2+k3s1`, SHA256 do binário amd64
`265b3ee6a3198ef14033c63ef46cbb32370d83795199fb6d1b01f21575eddbda`.
O download foi conferido com o checksum oficial e o binário informa essa versão.

## Topologia e recursos

| Nó | Tailnet | Papel | Teto dos jobs |
|---|---|---|---|
| Santiago | 100.80.18.81 | único control plane com etcd local, fila existente e worker | 4 CPU / 7 GiB |
| Local | 100.105.193.63 | estação e worker conforme folga | 4 CPU / 16 GiB |
| São Paulo | 100.109.6.122 | produção preservada e worker condicionado | 2 CPU / 3 GiB |

O teto de Santiago de 7 GiB é a atualização posterior do responsável e prevalece
sobre os 8 GiB do texto inicial do goal. Reservas do sistema e controle reduzem
os recursos efetivamente disponíveis. Até quatro jobs globais, dois pesados,
um pesado por nó e um job total em São Paulo. Proxmox e VM WhatsApp ficam fora.
Não há failover automático do control plane único.

## Sequência e aceite

1. Regularizar a identidade `admin-recuperacao` sem assumir `admin`. A proposta
   de sucessão no ledger é o evento **1598**, com implementação no commit
   `7712a3a` do repositório de coordenação. Exige revisão e ACK real de `apoio`.
   A sucessão foi aplicada no evento1616 após ACK real de apoio. Os leases
   antigos dos drafts permanecem intocados. A própria reserva de preparação
   vencida foi reconciliada em1618; uma nova reserva foi adquirida.
2. Inventariar rotas, serviços, firewall, reservas e estado da fila; salvar
   backups protegidos antes de mutações. Aprovar manifesto e reservar os
   recursos reais no ledger existente antes de provisionar.
3. Instalar primeiro Santiago e local. Configurações renderizadas usam
   containerd do K3s separado do Docker, sem Traefik/ServiceLB/local-storage,
   portas novas privadas, etcd local, snapshots a cada 15 minutos e taint de
   admissão fechada. Conferir rotas dos três nós antes de fixar os CIDRs.
4. Preservar a publicação da homepage conduzida pela outra sessão. São Paulo
   aguarda recibo da versão efetivamente publicada e nova baseline estável de
   30 minutos. A amostragem atual é apenas observação anterior ao possível
   deploy; HTTP 200 sozinho não qualifica a admissão.
5. Endurecer namespace/RBAC/Pod Security/NetworkPolicy, quotas e isolamento de
   rede antes de liberar a admissão. Jobs sem privilégios, docker.sock,
   hostPath pessoal, credenciais reais, bancos reais ou canais de envio.
6. Acrescentar backend Kubernetes à fila **existente** em Santiago. Preservar
   health/submit/status/jobs/logs/cancel, estados e histórico; integrar Vigia
   e painel existente. Não iniciar outra fila. Somente perfis fixos com
   commit, hash do fonte, imagem por digest, dependências e orçamento.
7. Implementar claim durável e reconciliação por ID: timeout e queda de rede
   não disparam novo job. `restartPolicy: Never` e `backoffLimit: 0` sozinhos
   não provam execução única. Cancelar sem repetir efeitos incertos.
8. Qualificar tipos, testes puros, PG17, build, navegador e PDF/PNG com fixtures
   e versões fixadas do candidato. Não executar suites genéricas que atinjam
   WIPs bloqueados, incluindo revisão sem assinatura e R16.
9. Validar Ready/MTU/DNS/tráfego entre nós, fechamento público/allowlist privada,
   jobs reais nos três workers, job pesado em SP com margem, paralelismo,
   dependências, integração serial, cancelamento, queda e retorno, máquina
   local desligada, ausência de duplicação e ausência de efeitos reais.
10. Copiar snapshots etcd, token de recuperação e backup consistente da fila
    para fora de Santiago a cada 15 minutos. Reter 24h e sete diários; provar
    restauração isolada, sem promoção cega do standby.
11. Qualificar `f55595cd348c23ffe559dba2de9150259db9f1e7`, produzir candidato
    integrado rastreável sem deploy, comparar tempos serial/distribuído e
    entregar evidências, operação, recuperação e ingresso de novos workers.

## Proteção da produção

Só admitir trabalho em SP após baseline de 30 minutos da mesma versão/PID,
cinco minutos estáveis, CPU abaixo de 60% e memória suficiente para o job mais
2 GiB livres. Interromper testes em falha de produção ou pressão; cancelar se
o p95 exceder `max(1,25 × baseline, baseline + 100 ms)` por três amostras.
Não reiniciar produção ou PostgreSQL para acomodar testes.

## Arquivos e verificação

`scripts/render_node.py` gera JSON válido como YAML e units; não instala.
`manifests/` contém arquivos sem segredos. `private/` guarda tokens e backups
com acesso restrito; `downloads/`, `evidence/` e `state/` não entram em Git.
`production_baseline.py` está em execução como processo de observação somente
leitura; seu resultado HTTP não substitui os gates de identidade da release,
pressão e reserva de recursos.

`collect_baseline.py` é o coletor preparado para a janela posterior ao deploy:
usa uma pasta nova por execução, confere build/PID/boot, GET público e local,
CPU e memória. `production_gate.py` recusa janela curta, lacunas, troca de
versão/processo e pressão. O probe único já foi executado; ele não qualifica SP.

`execution_claims.py` implementa a reserva durável na mesma base SQLite da fila
existente, sem daemon ou fila adicional. Testes com processos concorrentes
comprovaram um único início e recusa de repetição após reabrir o banco. O módulo
ainda precisa ser ligado ao backend Kubernetes, autenticação do runner e
atestado real de Job/Pod; os testes unitários não provam essa integração.

`prepare_receipt.py` consulta ACKs e fencing reais antes de produzir recibo
curto para `install_node.py`. Recusa sucessão pendente, arquivo alterado,
checkout sujo e lease sem margem. A emissão para SP permanece fechada até
implementar a verificação do recibo de deploy e baseline posterior.

A revisão independente identificou que o escopo do lease era lido do JSON
privado em vez do registro autoritativo. A correção consulta o próprio registro
SQLite, sob a mesma leitura que valida ator/token/fence/estado, e usa seus
recursos e vencimento no recibo. Quatro regressões com Git e SQLite temporários
conferem escopo adulterado, metadados locais incorretos, prazo forjado e token
inválido. Os eventos1600/1601 anteriores não receberam ACK de instalação e
serão substituídos por novos manifestos desse commit corrigido.

Referências técnicas: [requisitos K3s](https://docs.k3s.io/installation/requirements),
[opções do servidor](https://docs.k3s.io/cli/server) e
[configuração avançada](https://docs.k3s.io/advanced).
