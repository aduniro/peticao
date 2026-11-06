# Acesso privado à revisão pelo celular

Este serviço adiciona autenticação à revisão existente, sem escrever em `revisao.sqlite`. A senha usa scrypt com sal aleatório em `/mnt/dev/cpfs/revisao/acesso.sqlite`; sessões são armazenadas como hashes e expiram após 12 horas. Dez erros de senha bloqueiam novas tentativas por 15 minutos. Não há senhas nem dados pessoais nos logs HTTP.

- Serviço: `systemctl --user status peticao-cpf-review-access.service`.
- Gateway: `127.0.0.1:8766`, encaminhando para a revisão em `127.0.0.1:8765`.
- Ativação: `/mnt/dev/peticao/ativar-revisao-tailscale` (exige sudo).
- Endereço: `https://dell3576-zorin.tail1a6d71.ts.net:8443/`.
- O celular precisa estar conectado à mesma rede Tailscale; o computador deve permanecer ligado.
- A porta 8443 usa Serve privado, preservando a configuração já existente na porta 443. Não usar Funnel para os dados pessoais.

As decisões continuam exclusivamente no servidor original da revisão. O gateway verifica a origem dos POSTs, mantém o token interno fora do navegador e usa cookie Secure, HttpOnly e SameSite=Strict. O login protege a entrada remota; o acesso local original permanece disponível.

Antes da implantação foi criado e validado um backup SQLite em `/mnt/dev/cpfs/backups/revisao-antes-acesso-20261106T221402Z.sqlite`. A comparação dos registros confirmou a preservação integral das 220 decisões de CPF, 8.263 decisões de nomes e 8.268 entradas do histórico de nomes presentes nesse snapshot.

Testes: `python3 -m unittest discover -s /mnt/dev/peticao/tools/cpf-review/access -p 'test_*.py' -v`. Os testes usam um banco temporário. Também foram conferidos login, acesso autenticado a página e APIs de leitura, bloqueio de origem externa e preservação dos registros do backup, sem enviar decisões de revisão.

A senha foi enviada ao responsável pela Ponte; o arquivo temporário de entrega foi apagado após a aceitação do e-mail pelo provedor. A publicação no Tailscale depende do comando com sudo acima: a conta do agente não possui permissão de configuração do daemon.
