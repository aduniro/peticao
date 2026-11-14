# Azure: qualificação isolada do build canônico c472

Somente a VM existente peticao-azure-dev-01, builder, Tailnet100.76.178.21; não é o harness Civo literal. Fonte c472837fb5a4584d81f34c420f4de30989084f85 permanece inalterada. Nenhum recurso cloud novo, produção, jobs gerais ou migração de sessões.

Envelope adaptado de Civo356d770 com fonte/policy/testes próprios. Só cinco insumos públicos locais com SHA e bytes conferidos: fonte, dependências/Node20.19.2, guard, build e exportador canônicos. Transferência SSH com servidor fixado, usuário builder e sudo somente para staging/unidade isolada. Chave existente consumida por SSH; nenhuma credencial lida/copied para o workload.

Nova raiz/unidade de tentativa. Execução como builder,4CPU/8GiB/256tasks/1800s, ProtectHome tmpfs, PrivateNetwork, sistema somente leitura, Docker/containerd/Tailscale inacessíveis, Node20 somente na unidade. Ambiente fictício/limpo, sem endpoints de produção. Temporários e cache no projeto. Preflight socket valida não-gravável e conexão EACCES/EPERM/ENOENT; socket acessível ou timeout falham. Disco30GiB é orçamento com32GiBfreepreflight, não quota rígida.

Caller exige TEST própria com manifesto imutável, fonte/hash closure, ACK real Root e verificação AzureVM antes de cada fase. Cada dispatch confere lease; submissão de build exige >2100s restantes para cobrir timeout1800+transporte. Journals exclusivos stage/prepare/build impedem retry cego. Estado anterior preservado se falhar. Não compartilha token/leaseInfra.

Exportador canônico exige out novo. Prepara apenas parent exports/ gravável; filho exports/build-1 deve não existir. Resultado de transporte fica no parent. Esta correção veio de achado Infra após TSC/Next CivoPASS, não de alteração no app.

Fases: stage,prepare,build,status,evidence. HTTP/backend/browser QA é fase separada; esta não libera jobs nem fila. KeepRunningduring actual setup/qualification; Infra coordena idle.

Evidências locais somente em /mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/azure-canonical-qualification/state . Sem remoteGit/push/Actions.
