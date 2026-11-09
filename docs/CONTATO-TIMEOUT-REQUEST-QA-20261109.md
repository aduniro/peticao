# Prazo da requisição de resposta a contatos — 09/11/2026

Candidato isolado `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109`, branch `admin-v2-contact-request-timeout-20261109`, base `fadcba4`, código `a40eabb`.

## Correção

O editor tinha prazo de 15 segundos para rascunhos, mas a prévia e o envio da resposta podiam permanecer ocupados indefinidamente. `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/site/src/lib/contact-reply-request.ts` agora mantém um AbortController de 15 segundos até terminar a leitura JSON da resposta, com limpeza do timer em todos os desfechos. `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/site/src/components/admin/ResponderContato.tsx` consome esse helper; seu `finally` existente libera os controles.

Abortar o cliente não significa que o servidor deixou de aceitar uma mensagem. Falha/timeout de envio conserva o aviso existente de resultado inconclusivo e o texto/assunto/prévia/selo. Não se repete POST automaticamente. A prévia conserva seu aviso de erro anterior. Nenhum texto, CSS, estrutura JSX, política de envio, idempotência ou backend foi alterado; rascunhos continuam usando o fluxo anterior.

## Provas observadas

- Cinco testes em `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/site/src/lib/contact-reply-request.test.ts` passaram: abort antes dos headers, abort durante leitura do corpo, resultado perdido após aceite fictício sem repetição, sucesso sem timer tardio e preservação dos contratos HTTP/JSON. Log `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/.cache/qa-contact-request-timeout/unit.log`.
- Typecheck global sem diagnóstico: `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/.cache/qa-contact-request-timeout/types.log`.
- Build de produção Node20, um worker, configuração fictícia sem arquivos de ambiente, terminou 0 e confirmou hashes de todos os fontes rastreados iguais antes/depois. Prova `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/.cache/qa-contact-request-timeout/build/execution.json`.
- QA HTTP/React compilado terminou 0 sobre esse build e banco novo fictício, com provedor exclusivamente `dev`. Prévia sem resposta foi abortada em aproximadamente 16,3s e controles voltaram a funcionar; assunto e mensagem permaneceram iguais.
- Envio explícito foi aceito pelo backend de desenvolvimento uma única vez; sua resposta foi retida além do prazo do cliente. Em aproximadamente 15,8s o editor mostrou o aviso de resultado inconclusivo existente e liberou os controles, conservando assunto, texto e selo. O registro do servidor estava `accepted` e consulta GET protegida do histórico retornou sucesso. Isso prova que abort no navegador não autoriza concluir ausência de envio; não prova entrega a destinatário real.
- Perda de resposta do rascunho após CAS efetivo gerou um único POST e reconciliação GET, revisão 1, sem duplicar a gravação nem perder o texto.
- Nenhuma repetição automática de POST, erro JavaScript ou requisição externa do navegador. Dados do contato original preservados; alterações de resposta ocorreram somente nos registros fictícios esperados. Capturas de 390px e 1280px inspecionadas. Nenhum serviço de produção, credencial, base real, provedor real ou envio externo utilizado. Portas próprias 3036/54356 liberadas pelo cleanup e verificadas livres.

Resultado principal: `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/.cache/qa-contact-request-timeout/http/contact-timeout.json`. Logs/capturas: `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/.cache/qa-contact-request-timeout/http/`. Checksums: `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/.cache/qa-contact-request-timeout/manifest.json`.

## Reprodução

Harness `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/tools/admin-qa/contact-request-timeout-local.py` impõe candidato/portas/dependências isolados, ambiente fictício, provedor dev e ausência de arquivos de ambiente. Contrato navegador: `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/tools/admin-qa/contact-request-timeout.mjs`. Lifecycle: `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/tools/admin-qa/contact-request-timeout-local.mjs`.

Diretório de execução `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109`:

```sh
/usr/bin/python3 /mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/tools/admin-qa/contact-request-timeout-local.py build
/usr/bin/python3 /mnt/dev/peticao/.cache/admin-integration/candidate-contact-request-timeout-20261109/tools/admin-qa/contact-request-timeout-local.py http
```

Node fixado: `/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node`. Dependências existentes em `/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules`; sem instalação ou Rich/IA interrompidos. Não houve deploy.
