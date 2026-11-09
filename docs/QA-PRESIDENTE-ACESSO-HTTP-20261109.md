# QA compilado — acesso ao documento e recuperação do recibo

Fonte limpa congelada `1b9ffd7faf9d4a4d1d475b651058d3b47cce7463` em
`/mnt/dev/peticao/.cache/admin-integration/candidate-president-access-http-1b9ffd7-20261109`.
Build e HTTP concluídos com código0; nenhuma fonte do app foi alterada.

Runtime `/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node`,
versão20.19.2, SHA256
`b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`.
Dependências reutilizadas de
`/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules`: lockfile idêntico,
seções de dependências iguais,102 versões instaladas verificadas e50 opcionais
ausentes. O `package.json` do cache difere nos scripts, não nas dependências.

Manifesto de1267 arquivos rastreados, igual antes/depois do build e dos HTTPs:
SHA256 do JSON canônico ordenado
`0d65e3b5bb419b0ec015d337b515da4a57bee3257570e975cd6ddb71fc4d8d77`.

## Isolamento e cobertura

Aplicação somente em `http://127.0.0.1:3049`, PostgreSQL próprio em
`127.0.0.1:54368`, portas verificadas livres antes e depois. Ambiente montado por
allowlist, diretórios de configuração/segredos vazios, `PREVIEW_MODE=1`,
`CPF_FORCE_MOCK=1` e `CPF_MOCK_DATA` exclusivamente fictício. O provider efetivo
foi conferido como `mock`. `SIGNER=none`, mail/dev e pausa restaurada no `finally`.
Nenhuma consulta CPF real, certificado, validador externo, ICP, Gov.br ou envio.

Cinco grupos funcionais aprovados por HTTP contra `next start` compilado:

1. `POST /api/presidente/documento` devolve exatamente o PDF capturado, seu hash
   e versão. Attachment/PDF, no-store, nosniff, CSP sandbox e política efetiva
   no-referrer conferidos. `POST /api/presidente/estado` expõe só o whitelist de
   metadados, sem bytes, identidade, credenciais ou consumo do desafio.
2. Origem ausente/incorreta/inválida403; formato de conteúdo415; JSON/formato400;
   corpo acima512 bytes413; GET405 sem credenciais na URL. Os dois endpoints
   compartilham12 tentativas/IP e a13ª retorna429.
3. Quatro senhas erradas alternadas entre documento/estado e uma na confirmação
   produzem `attempts=5/state=rejected`. Credenciais corretas posteriores não
   recuperam o desafio. Desafios expirados também falham fechados.
4. Lease ativo produz `canConfirm=false`, sem alteração de lease/tentativas ao
   consultar, mesmo com senha errada. Lease expirado produz `canConfirm=true`
   preservando o registro até nova confirmação. A API existente
   `POST /api/presidente/confirmar` consumiu uma vez com identidade MOCK.
   O cliente descartou o corpo apósHTTP200, sem ler o recibo; a consulta de estado
   recuperou o mesmo recibo persistido **sem um segundo POST de confirmação**.
   Isso testa perda do payload no cliente, não uma queda TCP antes dos headers.
   A garantia retornada permaneceu `own-confirmation`, ICP=false/Gov.br=false.
5. Falha fictícia de auditoria impede download e retorna409, com rollback.
   Revogar o perfil invalida leitura de desafios emitidos e consumidos,
   preservando recibo, estados, bytes do lote e cadeia de auditoria anterior.
   CPF/nascimento/token/senha em claro ausentes dos registros de desafio/auditoria.

Seed de perfil/emissão usou conta Total existente e step-up vivo, pelo store real
com provider mock. Edição e Total sem step-up foram recusados. Nenhuma assinatura
de participante foi criada; nenhuma aprovação/envio de lote ocorreu. Confirmação
positiva MOCK não constitui homologação criptográfica ou de identidade real.

## Reprodução e evidências

Executar a partir de
`/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-read-20261109`:

```sh
/usr/bin/python3 /mnt/dev/peticao/.cache/admin-integration/candidate-inbox-read-20261109/tools/admin-qa/president-access-local.py build 1b9ffd7faf9d4a4d1d475b651058d3b47cce7463
/usr/bin/python3 /mnt/dev/peticao/.cache/admin-integration/candidate-inbox-read-20261109/tools/admin-qa/president-access-local.py http 1b9ffd7faf9d4a4d1d475b651058d3b47cce7463
```

Os roteiros recusam fonte suja, Node diferente, env real ou porta ocupada. O HTTP
exige o artefato `.next` construído nessa própria cópia. A localização do ensaio é
fechada para evitar adoção de outro servidor/banco. Roteiro HTTP:
`/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-read-20261109/tools/admin-qa/president-access-http.mjs`.

Artefatos privados preservados em
`/mnt/dev/peticao/.cache/qa-president-access-20261109`:

- `/mnt/dev/peticao/.cache/qa-president-access-20261109/manifest.json`.
- `/mnt/dev/peticao/.cache/qa-president-access-20261109/build/execution.json`.
- `/mnt/dev/peticao/.cache/qa-president-access-20261109/build/validation.log`.
- `/mnt/dev/peticao/.cache/qa-president-access-20261109/http-final/execution.json`.
- `/mnt/dev/peticao/.cache/qa-president-access-20261109/http-final/president-access-proof.json`.
- `/mnt/dev/peticao/.cache/qa-president-access-20261109/http-final/server.log`.

Os registros originais ficaram em `/tmp/admin-president-access-fcfi8dyw` (build),
`/tmp/admin-president-access-tgv2schu` (HTTP inicial) e
`/tmp/admin-president-access-o_zl0tpj` (HTTP final, acrescentando prova de ausência
de credenciais/identidade em claro). Ambas as rodadas HTTP passaram. Processos
próprios encerrados, schema fictício removido e portas3049/54368 livres ao final.
Não foi executado deploy, merge, migração real ou envio.
