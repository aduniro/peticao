# GERAL: contrato de coordenação global

Fonte: `/mnt/apps/peticao-final/_ops/controle-operacional/executor/global_coordination.py`.
Testes: `/mnt/apps/peticao-final/_ops/controle-operacional/tests/test_global_coordination.py`.

GERAL não é um broadcast do mesmo comando. O pedido Owner autenticado origina
um pai único. Um planejador ADMIN confiável deve produzir um plano explícito
com responsabilidades, instruções, recursos e chaves de efeito distintos.
Todos os participantes do registry administrativo do projeto recebem um filho;
o registry contém pelo menos ADMIN e PAGINA. Não corresponde aos processos
arbitrários do sistema operacional nem aceita targets fornecidos por e-mail.

`GlobalCoordinator` recebe registry fixo, adapter, authorizer e consulta à
autoridade do ledger único. Defaults recusam. Não emite leases e não substitui
o protocolo em `/mnt/apps/peticao-final/_ops/coordenacao-dupla`.

Operações: record_parent, install_plan, dispatch_once, poll_once, recover,
reconcile e status. Toda mutação exige autoridade ADMIN vigente e fencing
conferido. O transporte deve conferir o mesmo fence no limite do efeito.
Status é somente leitura mesmo com autoridade expirada.

Cada intenção é persistida antes do submit. O máximo é um submit por chamada;
um filho pausado não impede outro independente de avançar. Dependências só
avançam após conclusão do filho correspondente. Recibos precisam corresponder
ao filho. Crash em submitting vira uncertain, sem replay ou takeover.
Reconciliação explícita nunca recoloca um efeito incerto na fila.

IDs de pai, plano e efeito são imutáveis; reutilização conflitante é recusada.
Uma chave de efeito não pode reaparecer sob outro pai para repetir a ação.
Callbacks administrativos devem conferir o vínculo com o pedido Owner e o
plano ADMIN exatos. Não basta aceitar um booleano enviado pelo navegador.

Estado desta entrega: módulo isolado, 17 testes fictícios aprovados. Ainda não
está integrado ao daemon real, não recebe planos reais e não executa filhos
reais. Não autoriza deploy, resume de pausa, troca de modelo ou contorno de
bloqueios. A fase A privada usa o pacote anterior sem este módulo e mantém
GERAL em espera, com `children_implemented:false`.
