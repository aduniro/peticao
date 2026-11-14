# Azure worker — apoio paralelo da Infra

Escopo: somente `peticao-azure-dev-01`, assinatura `57298c3f-7cf2-4dbe-9884-c7bafdff4478`, RG `peticao-dev-eastus`, East US. Infra é coordenador; Apoio implementa com revisão e reserva normais. Este repositório é local e isolado; não cria repositório GitHub nem faz push/Actions.

Infra selecionou `Standard_E8ads_v7`, 8 vCPU/64 GiB, com NVMe temporário de 440 GiB, para desempenho; custo de computação consultado US$ 0,581/h. A alternativa E8as custa US$ 0,477/h. Qualquer fallback exige decisão registrada e configuração novamente vinculada ao manifesto, sem pedir aumento de quota. Crédito de US$ 200, vencimento 14/12/2026, consta na evidência da Infra; a projeção mensal não bloqueia a alocação horária autorizada.

ARM: Debian 13 oficial x64 Gen2 `0.20261111.2659`, NVMe, Trusted Launch, senha SSH desativada, usuário `builder`; disco persistente Standard SSD LRS de 128 GiB; IP público Standard; rede isolada com SSH somente `181.220.194.57/32`. Sem discos de dados, K3s, app, banco de produção, GPU ou alteração na Civo. O NVMe local serve apenas a cache/scratch regenerável; nunca manter nele resultados/fontes únicos.

`azure_operator.py` exige própria reserva normal de deploy do ator Apoio, aviso e todos os hashes finais. Operações Azure e SSH possuem journal exclusivo, revalidação e bloqueio de repetição após resultado incerto. O processo tem trava local; cada fase exige tempo de reserva superior ao próprio timeout. Nenhum token Azure entra nos argumentos ou arquivos de fonte: a CLI usa autenticação legítima existente.

Parâmetros e estado ficam fora deste repositório, no diretório absoluto `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/azure-worker/state`. A única entrada ARM é a chave SSH pública, como secureString; nenhuma chave privada ou chave de autenticação Tailscale é enviada ao provedor. A chave Tailscale existente segue apenas por stdin SSH, arquivo remoto root/0600 e remoção após uso. Conexão inicial usa TOFU fixado ao IP da VM confirmado pela API, seguido da autenticação pela chave aprovada; essa limitação deve aparecer na entrega.

Fases: group, validate, deploy, verify, bootstrap, join, access. Nenhuma foi executada pela simples preparação dos arquivos. O bootstrap instala ferramentas básicas e Tailscale sem autenticar contas de terceiros. A integração real à fila e a liberação para jobs continuam separadas. Manter a VM ligada enquanto houver setup/qualificação efetiva da Infra; depois seguir o plano de desalocação após 10 minutos de ociosidade, sem construir o controlador promocional V3 pausado.

## Fontes oficiais consultadas

- https://learn.microsoft.com/en-us/azure/templates/microsoft.compute/2024-07-01/virtualmachines
- https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/eadsv7-series
- https://prices.azure.com/api/retail/prices (respostas específicas preservadas no diretório de preflight)
- https://pkgs.tailscale.com/stable/#debian-trixie

Dados atuais de imagem, restrições e quotas vieram da CLI autenticada da Azure. Disponibilidade física definitiva só é comprovada pela alocação; catálogo sem restrições não garante capacidade. Custos de disco, IP, operações e egress são adicionais; não se promete cap financeiro automático.
