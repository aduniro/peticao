# A1: consulta do resultado por intenção exata

A leitura de disponibilidade continua usando `/api/admin/lotes/<id>/a1`. Uma nova leitura opcional usa somente `?requestId=<uuid>` e retorna o job persistido daquela conta e daquele lote. Total, sessão ativa, confirmação extra e validação de origem continuam obrigatórios. Parâmetro extra, repetido ou inválido é recusado.

A consulta de resultado não depende de o gate operacional de assinatura continuar ligado: desativar novos jobs não apaga o resultado já registrado. Uma conta diferente ou lote diferente recebe not_found. Não há PDF, senha, lease ou autorização no resultado.

Importante para a interface: not_found não prova que um POST anterior não poderá ser admitido posteriormente; portanto não libera retry automático. Enquanto o resultado estiver incerto, continuar reconciliação via GET e preservar a intenção. Nova solicitação sempre depende de ação explícita, disponibilidade e binding atual.

Casos de regressão incluem solicitação antiga ainda consultável depois que outro job fica mais recente, política operacional desligada, conta/lote incorretos e duplicação de query. Reteste específico em execução após este commit; não usar existência do teste como aprovação. Nenhum texto visível/layout foi alterado.

## Transporte do navegador

O módulo `site/src/lib/a1-request.ts` realiza uma única tentativa por chamada explícita. O POST projeta somente requestId, versão documental e revisão de política; não transporta certificado ou senha. O GET por intenção mantém a correlação de lote, conta, documento e política. Uma resposta 404 não autoriza repetição do POST.

A resposta possui limite efetivo de 64 KiB e prazo que inclui a leitura do corpo, mesmo quando um transporte ignora AbortSignal. JSON malformado, resposta de outro pedido/documento, HTTP inconsistente ou queda de rede produzem resultado incerto. Nenhum desses resultados dispara assinatura, aprovação ou envio automaticamente. O módulo não adiciona textos ou controles visíveis enquanto a aprovação específica dos textos da interface está pendente.

Validação preliminar: nove grupos de testes de transporte passaram, cobrindo resposta perdida, leitura travada, limite real do stream, conteúdo inválido, vazamento de campos extras e isolamento de intenção. Rodada anterior da API: 21/21, commit 0c6b475, código estável.

## Reconciliação do estado da tela

`site/src/lib/a1-reconciliation.ts` consulta a intenção exata quando existe uma solicitação em acompanhamento. Sem intenção, consulta disponibilidade. A observação só se aplica ao lote e à intenção que continuam selecionados quando a resposta chega; respostas atrasadas de outra seleção são descartadas. O reducer conserva a revisão mais recente, exige versão/hash do arquivo publicado para mostrar sucesso e pede disponibilidade atualizada antes de qualquer nova solicitação após falha.

Teste preliminar deste incremento: 24/24 casos (estado, transporte e seis cenários de reconciliação), incluindo 404, timeout, troca de lote/intenção e erro atrasado de POST depois de GET confirmado. Checkpoint anterior 78b2e39: 30/30 na rodada API com PostgreSQL isolado e typecheck aprovados, fonte estável. O novo incremento ainda deve passar pela mesma rodada integrada. Nenhum componente visível ou configuração de produção foi ativado.

## Rodada integrada e disponibilidade após falha

No commit 6fa8e93: 170/170 testes documentais e build aprovados com fontes estáveis. O primeiro typecheck concorreu com o build e falhou porque `.next/types` foi recriado; a evidência foi preservada. Repetido após o build, passou com fontes estáveis. O runner agora possui locks distintos para Next/build/tipos e PostgreSQL, além de registrar a estabilidade do commit, evitando repetir essa concorrência.

O cenário adicional distingue falha terminal comprovada de resultado incerto: depois de conhecer a falha da intenção exata, a próxima consulta é de disponibilidade. Somente uma nova ação explícita, com outro requestId e bindings atuais, pode criar solicitação. Sete cenários puros de reconciliação passaram; a rodada integrada desse incremento será repetida.

## Respostas atrasadas e rascunho visual

O ensaio adicional reproduziu uma resposta de recusa do POST chegando depois de o GET exato já comprovar o job. O reducer agora mantém a comprovação atual, assim como já fazia para falha atrasada de transporte. O teste falhou antes da correção e passou depois; log privado preservado em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-reconciliation-draft/late-rejection-before-fix.log`. Conjunto puro: 26/26 após a correção.

O controle visual permanece fora da árvore de produção, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-reconciliation-draft/A1Assinatura.tsx`, aguardando aprovação dos seus textos. Ensaio no navegador com API fictícia: seis larguras (360, 390, 768, 1024, 1440 e 1920), duplo clique com somente um POST, resposta perdida recuperada por GET da intenção, sem retry ou overflow. Isso não é ensaio navegador→backend real nem homologação ICP-Brasil.

Checkpoint 9444372: build, tipos e rodada A1 integrados aprovados, commits/fontes estáveis. A trava do runner foi observada adiando build até os tipos liberarem o mesmo recurso.
