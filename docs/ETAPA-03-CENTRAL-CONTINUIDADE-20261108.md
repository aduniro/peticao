# Central de e-mails — recuperação, retenção e prévia

Execução supervisionada f995c41076ea42cfab600fdb6f5ad239,08/11/2026.
Candidato exclusivo `candidate-stage02-domains`, base1b1f820. Sem VPS,
outros worktrees, envio a participantes ou mudanças de estética/textos ativos.

## Lacunas corrigidas

Uma recuperação já concluída continuava exigindo conferir seu payload antes de
responder `already_settled`. Depois do expurgo aprovado de30dias, o payload vira
`{}` e a repetição/consulta devolvia conflito de conteúdo, embora a fila estivesse
concluída. A consulta agora verifica vínculo, canal, tipo e destinatário e depois
reconhece o estado `sent`, sem recuperar corpo, renovar prazo ou auditar de novo.
Isso informa o estado existente da fila; não revalida conteúdo removido, não prova
entrega e não cria um aceite novo.

Para qualquer fila ainda não concluída, continuam obrigatórios conteúdo exato,
fingerprint, vínculo, tentativa aceita finalizada e ausência de tentativa aberta.
Uma fila vencida com payload eliminado permanece bloqueada mesmo com mensagem
marcada aceita. Identidade divergente também impede a repetição de fila concluída.

O POST agora limita o stream a256bytes antes do JSON, sem confiar em Content-Length
ou carregar todo o corpo via `req.text()`. Excesso retorna413 e cancela a leitura;
UTF8 inválido retorna400. Payload permitido continua sendo somente `{id}`.
Falha técnica nos GETs de lista/diagnóstico retorna503 sem detalhes SQL nem dados
parciais. Nenhuma alteração do conteúdo de AV10 ou outra mensagem visual.

## Evidências observadas

`python3 tools/admin-qa/consolidation.py --mail-tests`: **45/45 aprovados**,
zero falhas/ignorados/cancelados, saída0. Abrange recuperação, prévia, arquivo,
histórico, rollback e retenção. Quatro regressões novas comprovam replay
concorrente após expurgo real, fila vencida sem liberação indevida, identidade
divergente, stream limitado/cancelado e fonte indisponível/recuperada. Os casos
anteriores conservam autorização, auditoria atômica, worker atrasado e transporte
injetado/dev, sem entrega externa.

Log completo `/tmp/admin-consolidation-y33rw18b/validation.log`, copiado sem alterar
o original para `.cache/qa-mail-central-20261108/targeted.log`; SHA-256 igual em
ambos: `1163d9071bc4be8c850c22a7c9799035ca682b70ef95084f0c7232f71f458cb7`.

A primeira checagem de tipos encontrou incompatibilidade apenas na declaração
`RequestInit` da fixture de stream (signal nulo no tipo DOM). A declaração foi
ajustada sem alterar o teste de cancelamento/limite e a repetição passou, saída0.
Build e tipos após build passaram, saída0. Nenhuma
mudança de DDL; não reaplicar migração nem repetir cumulativa antiga sem motivo.

## Aprovações preservadas

AV10 autoriza só “Concluir fila sem reenviar” e seu aviso. AV9 (prévia), AV11
(colunas/botões/erros de recuperação) e AV12 (erro de paginação) continuam
pendentes no catálogo. Os componentes não foram conectados à página. Nesta
sessão, perguntas nativas independentes apresentaram os textos EXATOS já propostos
de AV9/AV11/AV12; nenhuma resposta foi observada nem aprovação inferida.

O resumo legado da fila, que atribui todos os `failed` a48horas, continua pendente
de texto específico. Não alterar contagem para ocultar retidos ou expurgados.
Guardas de autorização/envio, AV16 e demais avisos permanecem independentes.

## Contratos compilados aprovados

`python3 tools/admin-qa/consolidation.py --contracts mail-recovery mail-preview`
terminou com saída0, banco fictício novo54349 e servidor3033 próprios.
Os dois relatórios em `/tmp/admin-consolidation-o4h2o9p5/` foram lidos e conferidos:

- `mail-recovery.json`: autorização/stepup, lista sem conteúdo, prova original,
  timestamp com microssegundos, autor auditado, repetição e preservação anteriores
  ao expurgo. Depois, expurgo REAL do payload; GET e três POSTs concorrentes
  reconhecem a conclusão sem gravar corpo ou outro evento. Corpo257bytes é
  recusado com413; ausência de fonte retorna503 e recuperação volta a responder.
  Originais, assinaturas, mensagem e tentativas permanecem preservados. Nenhum
  transporte foi chamado. `payloadAndAttemptsPreserved` descreve a conclusão
  original; a etapa posterior de retenção remove deliberadamente apenas payload.
- `mail-preview.json`: endpoint real com Total/stepup, auditoria do autor,
  máscaras, iframe sandbox sem acesso ao pai e zero requisições a rastreadores em
  320/390/768/992/1280/1920px. Seis capturas geradas;320px inspecionada visualmente.
  Nada enviado; originais e assinaturas comparados antes/depois sem alteração.
  Isso testa a prévia isolada, não um botão de interface ainda não conectado.

Relatórios, log e seis capturas foram copiados, sem mover os originais, para
`.cache/qa-mail-central-20261108/` (ignorada pelo Git). SHA-256 dos JSONs:

- recuperação: `1771e745d17dff5aac0af062bc07cc5f86ce83a2022c150d8115ec096f8ef635`;
- prévia: `146a5b7bb4ad28660ad1b79564312670b038c8702e79f4e2066a22283e7d4274`.

Os executores próprios encerraram servidor/banco e navegador. Não há alegação de
QA autônomo ainda em execução. Cumulativas antigas não foram reapresentadas como
resultado deste código. As verificações desta alteração são os45 direcionados,
build/tipos e os dois contratos compilados atuais.

## Estado e próxima ação

Correção backend independente implementada e validada. A central integral
continua incompleta; conexão visual de recuperação/prévia depende de AV9/AV11/AV12
explicitamente pendentes, não ampliadas pelo AV10. Perguntas nativas emitidas,
sem resposta observada. Próxima ação dependente: registrar decisões desses avisos
e então conectar os controles com QA de permissões, foco/fechamento, duplo clique,
resposta perdida e paginação. O texto legado da fila também exige revisão
aprovada antes de ser alterado. Enquanto isso, as outras etapas independentes do
plano continuam autorizadas em seu próprio escopo; este bloqueio não é conclusão
do admin-v2. Nenhum deploy, merge com VPS, leitura de cofre ou envio externo.

## Impedimento do checkpoint local

Após todos os testes acima, a tentativa de `git add`/`git commit` foi impedida
antes da criação do processo: o executor retornou literalmente
`Rejected("rejected by user")`. Não há evidência adicional nesta tentativa que
permita atribuir isso a recusa do dono ou afirmar expiração da supervisão.
O comando não iniciou; não declarar um commit inexistente.

As alterações de código, testes, roteiros e este relatório permanecem no checkout,
com base1b1f820 preservada. Próxima ação técnica: liberar e executar o commit local
já solicitado; não repetir testes aprovados sem mudança/falha nova. Próxima ação
de produto: obter decisões AV9/AV11/AV12 antes de conectar interfaces pendentes.
Estado: **blocked**, por impedimento de execução do commit e aprovações visuais
pendentes. Nenhum processo de QA próprio continua ativo.

## Retomada autorizada pelo principal

O responsável esclareceu nesta continuidade que **não houve recusa do dono para
commits locais**; o principal acompanha as aprovações técnicas. A autorização de
fechar estes commits foi reiterada. Os retornos literais do executor acima ficam
preservados como fatos técnicos, sem serem apresentados como decisão do dono.
Conferidos novamente os45 testes e relatórios de HTTP/prévia já aprovados, sem
repetir QA. Fechamento backend preparado em commit separado das mudanças de
domínios e IA. Central integral e aprovações AV9/AV11/AV12 continuam pendentes;
não ativar controles ou textos por inferência dessa autorização técnica.
