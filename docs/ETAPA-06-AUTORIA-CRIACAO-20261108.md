# Etapa 6 — autoria da criação manual

Estado: **continue**; backend validado por testes dirigidos/tipos, integração
compilada global pendente de janela coordenada pelo principal. Não conclui a etapa.

A rota `POST /api/admin/lotes/criar` conserva Total + stepup e passa a sessão real
para `createBatchForAdmin`. Não aceita autoria do formulário. O núcleo revalida
identidade, nível Total e conta ativa na transação de reserva e novamente antes de
gravar o PDF/auditoria, depois da renderização fora de transação.

Auditorias de criação, preparo e falha guardam `source=admin`, userId e e-mail real.
A chamada automática existente `createBatch` continua com fonte explícita
`scheduler`, sem fabricar usuário. Bytes, contagens, lista capturada, hash, ICP,
textos e aparência permanecem. Não altera senha, rascunhos, UI e-mail ou schema.

## Evidência efetiva

`python3 tools/admin-qa/consolidation.py --document-tests`: **33/33**, zero falhas,
cancelamentos ou ignorados; saída0 em
`/tmp/admin-consolidation-ai_xxcq6/validation.log`. Cópia em
`.cache/qa-batch-creation-actor-20261108/33-tests.log` (fora Git).
Tipos pelo helper `verify_admin_candidate.py types`: saída0, sessão88118.

Três regressões novas comprovam a rota com stepup, autor forjado ignorado,
revalidação antes da reserva, identidade divergente, revogação entre reserva e
gravação final, rollback da reserva por falha de auditoria e autoria do agendador.
Revogação injetada deixa `preparing` sem bytes/hash e sem aviso ao aprovador.
As outras30 regressões cobrem lotes, assinatura estrita e recuperações anteriores.
Somente assinantes/documentos fictícios e caixa dev; nenhum transporte real.

## Coordenação e pendências

Não iniciar build global sem coordenar: senha pertence a `admin_password`,
rascunhos a `admin_contact_draft`, interface de e-mail/prévia/recuperação ao root.
Esses arquivos e `db.ts` foram preservados. Snapshot cumulativo `c975304` do
principal é anterior a este bloco e usa54351; não atribuir seu resultado ao módulo
atual. QA deste bloco usou54349. O commit será identificado no checkpoint seguinte.

Próximo independente da Etapa6: limites de entrada e IDs nas rotas de lote,
preservando formulários/textos. Preparo interrompido ainda necessita contrato de
retomada/snapshot durável. Modelo AV16 compartilhado/autoria/versão/30dias agora
está autorizado; textos do editor continuam para apresentação antes de integrar UI.
Nenhum deploy, merge/escrita VPS, promoção CPF ou alteração de outro worktree.
