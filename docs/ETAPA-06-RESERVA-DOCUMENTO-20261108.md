# Etapa 6 — reserva de aprovação e documento

Execução `d24c089484ec4e609dd3fe750e190284`. **continue**: bloco local validado;
não conclui documentos/lotes/aprovação integralmente.

O controle de pausa/stepup foi validado e commitado em `3a7bfdc`. A correção do
cancelamento com auditoria atômica e sua primeira regressão foram commitadas pelo
principal em `3ccf5e6`: 6/6, log `/tmp/admin-root-cancel-cszonaiw/validation.log`.
A reprodução anterior `/tmp/admin-root-cancel-evu65520/validation.log` demonstrou
que a falha de auditoria deixava o lote cancelado e o código apagado.

## Contrato implementado, ainda sob validação

- Admissão de aprovação bloqueia a linha e consome o código junto com a auditoria.
  O código continua com seis dígitos e 15 minutos; seu hash interno agora vincula
  bytes originais/assinados, classificação, lista e contagens. Códigos antigos v1
  exigem novo pedido, sem fallback que admita uma versão de documento não vinculada.
- Após admissão, `approved_at` congela a versão: novo código, anexação e cancelamento
  ficam bloqueados. Nenhuma transação de banco permanece aberta durante transporte
  ou validação ICP. Mensagens/textos e verificação ICP existentes preservados.
- Saída por destinatário usa `messageKey` estável por lote/hash PDF/destinatário,
  `queue:false` e `singleAttempt:true`. O journal existente distingue aceite,
  rejeição e incerteza; nenhum replay renova conteúdo expurgado ou seus 30 dias.
  Aceite não comprova entrega. Resultado incerto não habilita fallback/repetição.
- Persistência dos resultados e auditorias é atômica. Falha de persistência após
  transporte aceito não é capturada como rejeição; journal e reserva permanecem.
- Anexação valida fora de transação e depois compara revisão e documento sob lock.
  Gravação e auditoria são atômicas. Cancelamento também recusa documento reservado.
- Rotas passam o ator real. Cada mutação inicial revalida Total ativo/identidade
  na transação; auditoria conserva userId/email da sessão e aprovador do código
  como identidades distintas. Revogação durante validador impede commit no teste.

## Evidência e falhas preservadas

O principal acrescentou corrida de duas aprovações: 7/7 em
`/tmp/admin-root-cancel-rbu6u32d/validation.log`, antes de exigir ator no contrato.
A rodada `/tmp/admin-root-cancel-03yxzn7b/validation.log` usou fixture de hash v1
contra implementação v2 e obteve zero envios; incompatibilidade de fixture,
sem evidência de nova duplicidade ou reprodução histórica desse problema.

Primeira rodada ampliada: `/tmp/admin-consolidation-xjx4pylx/validation.log`,
12 aprovados, 1 falha, 4 cancelados. A fixture de PDF gerava ByteRange negativo
(141 bytes, comprimento final -59), logo a guarda estrutural recusava antes da
auditoria e o teste atrasado não alcançava o validador. Corrigido somente fixture:
padding, conferência estrutural, deadline e liberação/espera no finally. Não foi
relaxada a validação de assinatura. Rodada intermediária do principal, sufixo
`g_quf0yl`: 10/17 aprovados, 7 falhas ao cruzar a API com ator obrigatório e fixtures
antigas sem esse parâmetro; não é resultado positivo nem falha validada do produto.

Após adaptar rotas/fixtures: **18/18**, saída 0 em
`/tmp/admin-consolidation-gp_yjcij/validation.log`; tipos também saída 0.
Regressão adicional de replay: **19/19**, saída 0 em
`/tmp/admin-consolidation-hvj1e_ex/validation.log`; tipos atualizados saída 0.
O replay com chave estável preserva o registro integral de mensagem, sua expiração,
documento e quantidade de tentativas/arquivos dev. Autoria e aprovador distintos
também conferidos. Artefatos copiados em `.cache/qa-batch-reservation-20261108/`.
Build atualizado saída 0 (helper `verify_admin_candidate.py build`, sessão 38243),
captura em `.cache/qa-batch-reservation-20261108/build.log`. Tipos pós-build saída 0.
HTTP compilado `--contracts batch-control batch-reservation`: saída 0,
`/tmp/admin-consolidation-2bkoui9d/validation.log`, ambos os JSON positivos.
O segundo contrato, preparado pelo principal, usa aprovação/destinatário fictícios
configurados apenas nele. Confere aprovação positiva e concorrente, hash do anexo,
ator real versus aprovador, rejeição de origem/papel/stepup, rollback de cancelamento
com falha injetada, replay sem transporte e preservação de assinante/outro documento.
Copiados em `.cache/qa-batch-reservation-20261108/`, fora Git.

## Pendências explícitas

Conciliação de aceite com resultado de lote não persistido e recuperação de
rejeição conclusiva permanecem no próximo bloco. O bloqueio conservador também
impede retomar uma rejeição comprovada; não declarar esse cenário resolvido.
Criação/preparo de PDF e suas auditorias também precisam de revisão final.
O commit deste hardening deve ser identificado no checkpoint seguinte. Não inferir
aceite de módulo a partir de uma bateria parcial. AV9/11/12/16/17 seguem sem resposta. AV17 registra
o conflito entre resumo legado e resultado incerto, sem ativar novo texto.

Nenhum envio real, publicação nominal, alteração CPF, integração de decisões
locais ou acesso/escrita/merge/deploy VPS. Banco e mensagens exclusivamente fictícios.
