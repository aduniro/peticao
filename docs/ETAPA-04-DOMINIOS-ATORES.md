# Domínios — ator transacional

08/11/2026, candidato local `candidate-stage02-domains`, base d8b8bac.

Fechadas as alterações existentes: a rota repassa ID/e-mail da sessão; a biblioteca
serializa com gestão de contas pela trava7003 e revalida conta ativa e nível antes
de escrever. Autor informado pelo chamador não substitui a identidade atual.
Revogação, mudança de identidade e falha de auditoria não deixam decisão parcial.
O classificador institucional e as regras CPF permanecem intactos.

Validação efetivamente executada nesta sessão pelo helper
`/mnt/dev/peticao/tools/monitor/verify_admin_candidate.py`:

- `targeted`:15/15 aprovados, zero falhas/ignorados, incluindo handler real,
  revogação concorrente, domínio/subdomínio e ledger de intenção.
- `types`: `tsc --noEmit`, saída0.
- `schema`: saída0; exatamente13 tabelas aditivas; preservação de autoria,
  intenção, cifras, decisões de arquivo, versões e microssegundos após reaplicar
  DDL e bootstrap anterior. Preservadas definições anteriores e assinaturas.

Banco fictício exclusivo54349, mail dev, sem transporte externo. O primeiro
comando foi impedido pela restrição de sockets; execução autorizada fora do
sandbox passou. Isso não comprova HTTP compilado nem a integração do formulário,
que seguem na próxima etapa. Nenhuma escrita na VPS ou em outros worktrees.
