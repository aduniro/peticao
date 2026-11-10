# Perfil fixo runtime HTTP para fila existente — proposta privada

Draft /mnt/apps/peticao-final/_ops/r0000-cluster-runtime-profile-20261110. Sem instalação, transferência, SSH, app real, banco, deploy ou alteração de fonte canônica. A recuperação gov.br permanece congelada separadamente no commit0d68c02.

Baseline coordinator SHA3675926e81e1b6160b9548ad15c9d18b8fcc65ccec208cf6329f8ada3fb55f92 coincide com o observado instalado por root. Baseline launcher local bf1f35bdb44446351af0199f777258cb053189a791ee7de7168dd0a271d67685 deve ser conferido independentemente contra instalado antes de portar. Gateway24a938ef8f69d7ee670699221e6be086241cceb3f709fc6300ca2c6396796849 não muda.

Patch mínimo: adicionar /opt/admin-v2-cluster/runtime_profile.py; alterar /opt/admin-v2-cluster/coordinator.py para único kind allowlisted runtime-http-r0000-v1 e branch de preparação sem import-source; alterar /usr/local/libexec/admin-v2-launch somente para RuntimeMaxSec120 nesse kind (demais7200), preservando limites/cgroup/grace. Contrato documentado em core/CORE-INTERFACE.md no draft.

Entrada física grande é artifact de runtime staged por transporte separado aprovado, SHA4338322..., não arquivo de Git falsificado, não RPC64MiB. Nenhum novo método de upload/execução livre é criado. Perfil usa somente caminhos/SHA/comandos fixos e exige source_commit0a5, verifica manifesto completo antes Next, conserva execuçãoúnica da fila e marker adicional do perfil. O operador ainda precisa ACK/lease/estadiamento e conferir recursos/porta31387 antes da operação remota. A fila real não foi alterada.

23/23 testes fictícios passaram:15 regressões existentes da fila e8 do perfil (contrato estrito, pins/tamper, fonte não-importada, idempotência/cancelamento, ordem de fases, falha do guard semHTTP, exportação sórecibos, SIGTERM real de filho-fictício drenado e contrato cgroup/timeout). Não houve npmtest, aplicação real, assinatura/unsigned/IA/contatos nem serviço remoto. py_compile passou. Provas no evidence/final-tests.log do draft.

Limite real proposto: launcher120s total, alarm105s, até13s para drenar filho/recibos; timeoutcontrolado por código, não por usuário. Não demonstramos que hash/extract12milfsync/guard/HTTP caberão nesse orçamento em Santiago; se não couberem, falha explícita/semreplay. Revisar orçamento antes de qualquer ampliação. Cgroup é contrato do launcher qualificado localmente por inspeção/teste; não alegamos execução supervisora remota nesta entrega. HTTPsmoke continua semDB/semhidratação/semhomologação criptográfica e operationalReadyfalse.
