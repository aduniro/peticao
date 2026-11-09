# Etapa6 — resposta estrita do validador de PDF

Correção local do principal em `2ee972f`. Não conclui o módulo de documentos.

`verifyIcpBrasil` convertia `valid` por coerção booleana. Um retorno JSON com
`valid:"false"` produzia `valid:true`. O tipo TypeScript não valida o JSON recebido.
Agora somente o booleano `true` representa aprovação; as mensagens existentes e
o contrato atual de CNPJ foram preservados. Não ativa serviço nem muda política
de certificados, formulários, PDF publicado ou decisões de CPF/nome.

Regressão `signed-pdf.test.ts`, sem banco nem rede: uma função fetch injetada
retorna apenas respostas fictícias. Antes da correção, falhou com
`Não aceitar valid="false"` (esperado false, recebido true). Depois, dois testes
passaram, sem skips: rejeição de nove variantes não aprovadas, aceitação do
booleano true, comparação de CNPJ formatado e recusa de CNPJ diferente.

Comando, de `site/`, em ambiente limpo:

```sh
env -i PATH=/usr/bin:/bin HOME=/home/barre NODE_ENV=test node --import tsx --test src/lib/signed-pdf.test.ts
```

Esta evidência é dirigida. A validação integrada do candidato posterior aos
commits de recuperação de rejeições continua necessária; os534 testes do snapshot
`8436fa2` não incluíam esta mudança. Nenhum deploy ou merge foi feito.
