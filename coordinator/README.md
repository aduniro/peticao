# Backend Kubernetes da fila existente — preparação

Este checkout é o draft `infra/kubernetes-backend-20261111`. **Nada dele foi
instalado em Santiago.** O checkout principal continua no commit de instalação
`04bb4ba`, preservado para revisão dos eventos 1600 e 1601. A sucessão do
coordenador continua dependendo do ACK real do evento 1598.

## Origem e contrato

`ORIGIN.json` identifica os hashes dos quatro arquivos efetivamente instalados
em `/opt/admin-v2-cluster`. Foram conferidos novamente por SSH; continuam
iguais aos originais. Os testes legados de fila e recuperação foram preservados
com apenas o caminho de import ajustado para este checkout.

`coordinator.py` mantém o mesmo banco, daemon com flock, autoridade com geração,
RPC SSH e interfaces health/submit/status/jobs/logs/cancel/snapshot. O backend é
opcional e começa desligado (`ADMIN_CLUSTER_KUBERNETES=0`). O novo tipo de job
é `kubernetes-profile-v1`. Só aceita perfil revisado, commit explícito e IDs de
dependências já existentes da mesma geração; não aceita comandos, imagens,
orçamentos ou observações enviados por RPC.

Os seis perfis de `profiles.json` começam **desabilitados**, sem imagem
placeholder. Habilitação exige catálogo root-owned, aprovação referenciada,
imagem do registro privado por digest, commit e manifesto do fonte por SHA256.
`images/base-image-pins.json` registra os manifests linux/amd64 obtidos do
registro oficial para Node 20.19.2 e PostgreSQL 17.11. Ainda não há imagem de
execução construída ou qualificada.

## Fluxo e limites

1. O mesmo SQLite reserva o job, token hash e estado `starting` numa transação.
2. Cria um Job de nome derivado do ID, suspenso, sem token de ServiceAccount,
   sem privilégios, com filesystem raiz somente leitura e volumes efêmeros.
3. Confere identidade e annotations observadas, vincula o UID real e retira
   a suspensão. Uma resposta perdida é reconciliada pelo mesmo nome. Ausência
   ou indisponibilidade não cria outro Job.
4. Antes dos comandos, o runner precisa do claim durável. O backend atesta
   UID/owner do Pod e imagem via API; um segundo início é recusado.
5. Artefatos técnicos são limitados, conferidos por hash e gravados antes de
   confirmar o resultado no SQLite. Caminhos fora da área, links, excesso de
   tamanho e substituição de resultado são recusados. O Job só é recolhido
   após condição terminal e recibos locais; histórico e hashes permanecem.

Até quatro jobs, dois pesados e um pesado por nó. Teto local 4CPU/16GiB,
Santiago 4CPU/7GiB e SP 2CPU/3GiB, sempre reduzido por reservas/folga observadas.
SP exige gate de produção válido. Observações vencem após 45 segundos. Jobs
independentes menores podem avançar quando outro não cabe ou espera dependência.
Um job legado em execução conserva exclusividade para evitar disputar suas
reservas com o novo backend.

Cancelar primeiro grava a negação de novos claims e depois solicita remoção.
A resposta DELETE ou a ausência do objeto não é anunciada como prova de que um
processo numa máquina desconectada terminou. Esse estado permanece pendente de
reconciliação, sem novo início automático.

## Recuperação

`recovery.py` e `replicate.py` acrescentam os metadados Kubernetes ao allowlist
já existente. O snapshot consistente inclui a tabela de claims no mesmo banco.
Restore continua passivo, preserva os claims e marca execuções anteriores como
incertas; não promove standby nem retoma jobs. O teste novo comprova esse
fluxo com SQLite e arquivos temporários. Não é prova de restauração do etcd.

Para desativar o backend, manter este coordenador compatível e fechar a flag.
Não substituir pelo coordenador antigo com jobs Kubernetes pendentes: ele não
conhece o novo tipo. Toda mudança de autoridade requer reconciliação explícita.

## Trabalho ainda necessário antes de ativar

- ACKs reais, instalação K3s e prova de isolamento/RBAC/MTU/DNS nos três nós.
- Gateway HTTPS de claims/artefatos com autenticação por job, limites e PKI;
  runner e imagens completos, com guards e comandos dirigidos revisados.
- Coleta autenticada de folga/produção, renovação da credencial restrita da API,
  interrupção de testes sob pressão e reconciliação de cancelamentos desconectados.
- Pacote de instalação dos módulos, catálogo root-owned e credencial do
  coordenador. `execution_claims.py` deve ser instalado ao lado destes módulos.
- Integração de Vigia/painel e backups offsite de etcd, tokens, fila, fontes e
  imagens; prova real de restauração, falhas e retorno.
- Qualificação real de todos os perfis/f555, candidato rastreável e benchmark.

Os testes deste draft usam API Kubernetes simulada e fixtures locais. Não
comprovam execução em cluster, desempenho distribuído ou prontidão de deploy.

Referência para condição terminal e coleta de Jobs:
[documentação oficial Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/job/#terminal-job-conditions).
