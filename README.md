# Azure: preparação da malha privada e Remmina SSH

Estado: **PREPARADO, NÃO APLICADO**. Este repositório contém um gerador local de
rascunhos, não um instalador ou controlador de VMs. Não cria chaves, não abre
rede, não altera perfis ativos e não liga a Azure. Configuração efetiva, chaves
Azure e GUI ainda não foram qualificadas.

## Autoridade e proveniência

Coordenador: Infra, sessão 01a1d130-2948-7140-bcfb-34696b20ab8d. Decisões e
perguntas respondidas por ele estão em PLAN.json. Root revisa antes da execução;
a execução futura precisa de reserva própria e da liberação global de Infra.
Nada deste pacote interfere no checkpoint/restauração passiva em andamento.

Base de seis nós: commit897ebff92bfc18004d4af860ce3a719ad2809b5f, POLICY pública
em /mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-network-20261114/POLICY.json.
BASELINE.json retém somente campos públicos necessários; não contém hashes ou
conteúdo de chaves privadas. Nós: Dell local, peticao-sp, Santiago, WAHA, Akamai
e Civo. Azure acrescenta root/builder em peticao-azure-dev-01, Tailnet100.76.178.21,
fd7a:115c:a1e0::d02f:b216 e peticao-azure-dev-01.tail1a6d71.ts.net.

O host pin público Azure veio da qualificação SSH já concluída, com pin em
/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/azure-worker/state/known_hosts.
É obrigatório reconferir o pin ao retomar a VM; divergência exige reconciliação,
nunca accept-new/StrictHostKeyChecking=no.

Último estado verificado: VMdeallocated, operação615/registro2997. Nova consulta
RO em15/11/2026 00:06Z foi negada AADSTS530035/securitydefaults. Não houve
logout/login, bypass ou mudança de política. Autenticação legítima do plano de
controle é uma dependência futura; este pacote não a resolve nem afirma um
estado fresh da API depois da recusa.

## Etapas futuras, com congelamentos separados

1. Root/Infra resolvem autenticação legítima e autorizam uma janela concreta.
   Confirmar ausência de trabalho/consumidores e estado real da VM. Se continuar
   desalocada, somente uma nova operação explicitamente revisada poderá ligá-la;
   este gerador não faz start.
2. Com VM acordada sob autorização, snapshot RO: id imutável da VM/host,
   Tailnet Self IP4/IP6/DNS e BackendStateRunning; host public key; contas,
   caminhos/permissões/symlinks; SSH22/config/cloud-init/authorized_keys default,
   listeners, unit, firewall/NSG e configurações atuais dos seis nós. Não ler
   valores de privadas, OAuth, histórico Codex ou dados da aplicação. Node
   IPv6 deve estar habilitado e o endereço realmente atribuído, sem alterar
   globalmente IPv6/firewalls para contornar divergência.
3. Descobrir pares específicos Azure nos caminhos de AZURE.json. Reusar somente
   pares válidos, privados600/diretórios700, sem symlink, do usuário correto e
   cuja chave pública possa ser confirmada pelo programa autorizado. Se não
   existirem, Infra decidiu criar dois pares exclusivos remotamente, **apenas
   na fase previamente revisada e reservada**. Nunca copiar a privada Owner
   ou a privada de outro nó. Não sobrescrever um par existente ou rotacionar
   silenciosamente; conflito volta a Infra.
4. Congelar depois as14 chaves públicas reais, metadados de proveniência, host
   pin e hashes anteriores das configurações/authorized_keys. É um NOVO
   manifesto de rollout com revisão Root, não mera reutilização deste ACK.
   O parâmetro azure-public-json do gerador aceita somente dados públicos;
   não substitui a descoberta real, prova de posse ou aprovação da fase.
5. Aplicação futura: primeiro confirmar builder ainda acessível pelo SSH22 e
   sudo-n. Criar somente daemon privado separado2224, arquivos exclusivos e
   authorized_keys_peticao_tailnet_v2 por usuário. Daemon usa host key existente
   somente pelo sshd, validado com sshd-t na Azure. ListenAddress contém somente
   os dois IPs Tailnet, Password/KbdInteractive desabilitados, publickey exigido.
   Preservar ssh.service/22, cloud-init e authorized_keys default, inclusive a
   restrição de root da imagem. Não abrir2224 público, NSG ou RDP. Não mexer
   em INPUT/OUTPUT/FORWARD/NAT compartilhados. Verificar22 antes e depois.
6. Nos seis nós: adicionar somente as duas públicas Azure aos arquivos já
   revisados, com from=IPv4/IPv6 exatos da Azure. Preservar TODAS as opções e
   entradas preexistentes; conflito de chave/opções/pin deve interromper,
   não ser reescrito. Overlays SSH novos contêm somente aliases Azure. Na
   Azure, configuração nova oferece todos os destinos. Arquivo público v4 de
   known_hosts é novo; não substituir v3 nem apagar entradas Owner.
7. Remmina local: instalar somente seis arquivos novos600 em
   /home/barre/.local/share/remmina, após checar conflitos. São terminais SSH,
   root/builder x IPv4/IPv6/MagicDNS, ssh_auth1 e ssh_privatekey apontando para
   a identidade Owner existente. Não armazenam senha/passphrase. Fazer merge
   SOMENTE dos pins públicos Azure em /home/barre/.ssh/known_hosts, sem
   sobrescrever conflitos, pois libssh pode usar o arquivo padrão. Não alterar
   perfis RDP/Civo/Akamai existentes. Nenhuma alegação GUI antes de abrir e
   observar conexão real; parsing de arquivo não comprova funcionamento.
8. Revalidar fonte/fence/tempo antes de cada efeito, registrar intenção exclusiva
   e recibos. Timeout não autoriza repetir mutações: observar estado real e
   reconciliar normalmente. Rollback futuro só retira arquivos/unit privados
   que a própria operação criou e cujos hashes ainda coincidem; não restaura
   regras globais nem para o SSH22. Isso precisa estar no operador novo.

## Qualificação futura

Matriz única nova:7origens ×6destinos ×2contas de origem ×2contas de destino
×3rotas =504 conexões.360 pertencem à malha antiga,144 são arestas Azure. Não
somar360 resultados históricos com144 novos e chamar de prova fresca504.

Executar serialmente com conexões novas, sem ControlMaster/ControlPath,
identidade de origem e destino comprovadas, host/UID/usuário reais e host pin
estrito. Nenhum erro pode ser reclassificado como sucesso. Primeiro provas
parciais limitadas da Azure; depois lote completo504 se todas as dependências
passarem. matrix504.json é somente planejamento. O qualificador rejeita
resultados parciais, duplicados, batch antigo, origem errada e pin ausente.

Remmina GUI, comportamento de terminal/copiar-colar e root/builder reais são
provas separadas. Este pacote não qualifica desktop/RDP, builds, fila, promoção,
cutover nem deploy do admin-v2. Não instala serviço na produção por preparo.
Estimativa indicativa da implementação futura:45–90min após dependências,
snapshots e revisão, sujeita à latência dos504 SSH; não é prazo deste preparo.

## Uso local autorizado deste gerador

Executar a partir de qualquer diretório com caminhos completos:

    /usr/bin/python3 /mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/azure-mesh-plan/source/mesh_plan.py --out /mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/azure-mesh-plan/generated

O destino precisa ser novo e estar dentro deste workspace, fora da fonte
imutável. O programa só escreve rascunhos ali. Sem públicas reais Azure, omite
as adições de autorização nos seis nós e marca o rollout como não autorizado.

Testes:14 locais, incluindo parsing OpenSSH-G, lookup real de known_hosts com
ssh-keygen-F, restrições Tailnet/root/SSH22, perfis Remmina e qualificador504
com provas fictícias. Nenhuma conexão SSH de rede é feita pelos testes e
nenhuma chave privada/pública operacional é gerada.

Referências primárias dos campos Remmina:
https://github.com/FreeRDP/Remmina/blob/master/src/remmina_ssh.c
https://github.com/FreeRDP/Remmina/blob/master/src/remmina_ssh_plugin.c
ssh_auth1 corresponde a arquivo de identidade; ssh_privatekey e
ssh_stricthostkeycheck são opções SSH diretas, distintas de ssh_tunnel_*.
A compatibilidade da versão instalada e do libssh ainda precisa de GUI real.
