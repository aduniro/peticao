# Civo: qualificação canônica isolada, tentativa 2

O aplicativo permanece c472837fb5a4584d81f34c420f4de30989084f85.
Este repositório contém apenas o novo envelope de ensaio; não altera código do app.

Fases: stage (cinco entradas públicas), prepare (verificação/extratos), build
(submissão de uma unidade systemd própria) e status. Todas exigem manifesto
congelado, ACK real do Apoio e reserva própria `test`, ligada ao mesmo evento.
O caller valida hashes locais e os hashes remotos de runner/policy antes de executar.
Estado ou transferência parcial nunca é apagado para tentar novamente.

Aplicação Node 20.19.2 em bind somente na unidade; Node22 do host permanece intacto.
Usuário civo sem privilégios adicionais, 4CPU/8GiB/256tarefas, filesystem somente
leitura exceto o diretório novo, home oculto, socket Docker inacessível, rede privada.
Somente fontes/cache público verificados são transferidos. As48credenciais do host
permanecem intactas e fora da unidade. Temporários/cache de trabalho ficam em
`/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt2`.

Tentativa1 preservada: o preflight exigia ausência do tipo socket, mas systemd
InaccessiblePaths usa socket000. Diagnóstico confirmou Node20 correto, home
oculto e conexão Docker EACCES. A tentativa2 testa a negação de acesso real;
dois testes com sockets Unix reais cobrem negação000 e acesso indevido.
Reutiliza apenas cópias dos cinco inputs públicos da tentativa1, com hashes
antes/depois e nova raiz/unidade. Não reutiliza logs, build, perfil ou estado.

O orçamento de disco30GiB usa preflight32GiB livres e inventário dos artefatos;
não se alega quota agregada de filesystem. A entrada descompactada tem643MB.
Build executa assets PDF offline, TSC, Next e exportador com inventário/hash.
O exportador e guard mantêm lógica canônica, adaptando apenas caminhos do ensaio.

Esse resultado isoladamente NÃO libera jobs: testes backend, HTTP, navegador,
reset e integração à fila exigem a próxima fase revisada. Nenhuma produção,
banco real, A1, e-digger, firewall ou conta é alterada.
