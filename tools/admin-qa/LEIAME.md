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
