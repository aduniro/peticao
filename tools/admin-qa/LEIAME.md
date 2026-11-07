# QA local do painel administrativo

`contact.mjs` verifica o editor de respostas em 320, 390, 768, 992, 1280 e 1920 px. Injeta uma única falha na requisição de prévia, confere rascunho e botões, repete a prévia com transporte normal e salva capturas/relatório. Nunca clica em **Enviar**. Exceções do navegador, respostas HTTP de erro e falhas de rede não injetadas reprovam a execução.

Pré-condições: build do candidato concluído, servidor exclusivo em loopback na porta 3031 com `PREVIEW_MODE=1`, `ADMIN_NO_PASSWORD=1`, `MAIL_PROVIDER=dev`, `MAIL_PROVIDERS=dev` e PostgreSQL exclusivo na porta 54345. Não reconstruir `.next` enquanto essa prévia estiver ativa; parar apenas seu processo antes do build e reiniciá-la depois. Não usar o banco de testes cumulativos, a revisão de CPFs ou uma cópia de dados pessoais.

A ferramenta recusa host/porta fora desse ambiente e exige o aviso de caixa de saída local na página. Insere somente uma mensagem fictícia identificada por `[QA ADMIN FICTICIO]`; reexecuções reutilizam essa mensagem, sem apagar ou reescrever linhas existentes. O banco precisa já ser o ambiente isolado de QA, e não apenas outro banco apontado por engano à mesma porta.

Variáveis para executar `node tools/admin-qa/contact.mjs` a partir do candidato:

- `QA_BASE_URL=http://127.0.0.1:3031`
- `DATABASE_URL=postgres://peticao:peticao@127.0.0.1:54345/peticao` (credenciais fictícias de desenvolvimento)
- `PREVIEW_MODE=1`, `MAIL_PROVIDER=dev`
- `QA_PLAYWRIGHT_MODULE`: caminho absoluto de um módulo Playwright instalado no ambiente de QA.
- `QA_CHROMIUM`: caminho absoluto do executável Chromium usado pelo QA.
- `QA_OUTPUT_DIR`: diretório absoluto de evidências fora dos arquivos versionados.

Essa execução comprova somente o editor/estado sem card e a recuperação da prévia. Não comprova entrega de e-mail, todas as permissões ou paridade integral das demais telas. Os testes TypeScript de handler e de envio cobrem os contratos correspondentes com dados e transportes fictícios.

## Páginas por nível de acesso

`access.mjs` usa um segundo servidor do mesmo build em `http://127.0.0.1:3032`, com `ADMIN_NO_PASSWORD=0`, `PREVIEW_MODE=1` e e-mail dev, conectado ao banco fictício 54345. Executar com `site/node_modules/.bin/tsx tools/admin-qa/access.mjs`; fornecer as mesmas variáveis do teste de contato, alterando `QA_BASE_URL` para a porta 3032 e acrescentando `ADMIN_NO_PASSWORD=0`.

A ferramenta cria/reutiliza somente as contas fixas `qa-access-<nivel>@example.test`, emite sessões temporárias e as encerra ao terminar. Não apaga contas ou assinaturas. Confere ausência de sessão, os quatro níveis e cinco páginas em seis larguras; Total sem confirmação deve ir ao fluxo existente. A confirmação é habilitada diretamente na sessão fictícia para testar as páginas seguintes: este QA não prova envio ou digitação real de OTP. A prévia sem senha da porta 3031 não serve para testar essa matriz.

A revisão de visibilidade também confere controles do painel inicial e links da gaveta por nível, o atalho inferior de E-mails e o formulário de liberação de CPF. No celular abre/fecha a gaveta e exige Menu à esquerda/Filtros à direita na lista de assinaturas. A execução reprova exceções, respostas HTTP de erro, requisições que falham e rolagem horizontal; não ignora erros de rede genericamente.

Cada caso usa uma página nova e verifica erros antes do encerramento deliberado dessa página. Isso evita atribuir ao caso seguinte o cancelamento de consultas da página anterior durante uma navegação. O roteiro não filtra `ERR_ABORTED`, `NetworkError` ou `ChunkLoadError` por texto: qualquer falha durante o caso ativo continua reprovando a execução.

## Configurações: falha, recuperação e concorrência no cliente

`settings.mjs` usa o servidor autenticado 3032 e o banco fictício 54345, com as mesmas variáveis do QA de acesso. Cria/reutiliza somente `qa-settings@example.test`, valida seis larguras e modifica apenas `painel_popup_estado`, cujo valor anterior é restaurado no encerramento. A sessão emitida é revogada. Não usar no banco de produção nem em dados da revisão.

O teste segura uma requisição para confirmar que ambos os interruptores ficam indisponíveis enquanto há gravação pendente, injeta uma falha de rede e exige a preservação dos estados anteriores. Depois deixa uma gravação atravessar o handler real e verifica resultado e autor na auditoria. O aborto deliberado é associado à requisição exata; as demais falhas de rede, HTTP e JavaScript reprovam a execução. As capturas/relatório ficam em `QA_OUTPUT_DIR`.

## Central de Ações: somente consultas e simulações

`actions.mjs` usa as mesmas variáveis do servidor autenticado 3032 e banco fictício 54345. Cria/reutiliza `qa-actions@example.test` e libera somente sua sessão fictícia para testar a tela, sem enviar OTP real. Em seis larguras, preenche as datas, injeta uma falha na simulação, exige preservação dos campos e recupera por uma simulação real. Consulta o estado do sistema e confere o registro da simulação.

O teste rejeita requisição que use modo `executar` e nunca preenche a palavra ou aciona Executar. Configurações de reenvio/Terminal são comparadas antes e depois e devem permanecer iguais. A sessão é revogada ao encerrar. Este roteiro não comprova publicação, reenvio ou execução real de Terminal; os cenários de efeitos/auditoria são cobertos separadamente em banco fictício e callbacks controlados.

## Histórico de mensagens: contrato compilado

`mail-history.mjs` exige app autenticado em 127.0.0.1:3032 e banco fictício 127.0.0.1:54345/peticao, `PREVIEW_MODE=1`, `ADMIN_NO_PASSWORD=0` e `MAIL_PROVIDER=dev`. Usa contas `qa-mail-history-*@example.test`, metadados e tentativa fictícia, sem chamar transporte. Confere autorização HTTP, paginação, detalhe, separação do legado e ausência de conteúdo secreto na resposta; compara filas/mensagens/tentativas/logs e assinaturas antes/depois das consultas. Sessões são revogadas ao terminar. Requer `QA_OUTPUT_DIR`; relatório `mail-history.json`.
