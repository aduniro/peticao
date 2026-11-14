# Civo: staging inerte do coordenador de desenvolvimento

Esta fase instala os sete módulos Python recapturados do serviço real de
Santiago, sem alteração, mais a proteção de standby. Cria somente uma identidade
de serviço bloqueada/nologin, código e uma unit estática não carregada, não
habilitada e não iniciada. Não cria fila, listener, chave, autorização SSH,
sudoers, timer ou credencial. Não copia configuração pessoal ou da produção.

Os módulos gateway/replicação ainda contêm a topologia antiga e NÃO são
conectados a RPC, SSH ou timer nesta fase. A futura adaptação de topologia,
restauração completa, ensaio de fencing e promoção exigem novo manifesto e
reservas próprias; este pacote não executa esses passos.

A unit recusa uma fila ausente, primária ou armada; dispatch e Kubernetes estão
explicitamente desativados. A instalação não chama daemon-reload nem systemctl
start/enable. O cliente aceita apply somente com reserva deploy própria,
manifesto imutável, árvore limpa e ACK independente de apoio.

Testes usam fixtures exclusivamente em test-work/ deste projeto. O staging é
considerado parcial, nunca infraestrutura pronta ou recuperação completa.
