# Política central da senha administrativa

Em08/11/2026 o responsável determinou mínimo de **8 caracteres**, substituindo12.
O aviso AV1 foi aprovado com essa alteração. Esta política se aplica ao candidato
admin-v2; não publica ou altera credenciais da VPS.

`site/src/lib/admin-password-policy.mjs` concentra os limites8–200 e a validação
existente de repetição, presença do e-mail e senhas comuns. `senha.ts` reexporta
essa função para criação, troca e redefinição de usuários. Os campos de conta e
redefinição usam as mesmas constantes. O bootstrap `admin-dono.mjs` também importa
a mesma política, sem manter um mínimo divergente.

Hashes scrypt, salt, contas/senhas existentes, login, limites de tentativas e
confirmação extra permanecem com o comportamento anterior. As senhas temporárias
geradas continuam com16 caracteres. A troca e a redefinição continuam revogando
todas as sessões e preservam a gravação/auditoria transacional e os tokens de uso
único. O aviso de Minha conta agora descreve essa revogação corretamente, com o
texto autorizado, mantendo classes, fontes e layout.

## Evidências

A regressão reproduziu a falha antes do ajuste: uma senha fictícia de8 caracteres
era recusada com a exigência antiga de12. Após o ajuste, **37/37 testes** passaram
em banco fictício exclusivo54353 e ambiente limpo, sem falhas/skips/cancelamentos.
Foram executados os arquivos `admin-password-minimum`, `admin-users`,
`admin-reset-requests`, `admin-user-actions`, `admin-stepup` e `admin-password`.
O novo teste atravessa criação, autenticação, troca e redefinição:7 caracteres são
recusados sem consumir o token nem trocar o hash;8 são aceitos, sessões caem e
repetição do token é recusada. Os demais testes preservam bloqueio, confirmação
extra, auditoria/rollback e compatibilidade da senha única legada.

Log: `/tmp/admin-password-eight-04_shme4/validation.log`.
Cópias e manifesto: `.cache/qa-password-eight-20261108/` (fora do Git).
`node --check` aprovou o helper compartilhado e o CLI; importação pelo Node puro
também aceitou8. Tipos/build e teste visual integrado pertencem à consolidação
do candidato, sem presumir que estes testes dirigidos os substituem.
