# Central de Ações — avisos, histórico e conferência

Implementação local em08/11/2026, baseada na aprovação AV5/6/7 e nas decisões
administrativas de rotina autorizadas pelo dono. Não publica, instala serviço,
ativa Terminal ou modifica a VPS.

## Comportamento

- A descrição passa a usar o efeito exato retornado pela simulação. Alterar datas
  invalida a simulação; resposta tardia de datas anteriores é ignorada.
- As dicas de início/fim usam o padrão apresentado pela simulação, sem horários
  antigos fixos. Fontes/classes/estrutura dos cartões existentes são preservadas.
- Falha ou resposta não legível depois de solicitar execução é apresentada como
  resultado a conferir. A intenção e os campos são preservados. Uma chamada em
  andamento bloqueia outra no mesmo cartão.
- Após perda da resposta, o cartão oferece **Conferir resultado**, que usa
  `modo=consultar`. Não reenvia `modo=executar`; recarregar a aba continua usando
  a consulta da intenção existente. Login/confirmação/permissão expirados seguem
  os destinos administrativos existentes.
- A nova seção de histórico carrega somente metadados pelo GET autorizado,
  pagina por ID, conserva linhas em falha e permite consultar o recibo do
  executor de uma publicação. Não oferece editar veredito, reenviar sinal,
  executar comando ou publicar novamente. Pedido aceito e publicação concluída
  são apresentações diferentes; histórico legado mantém identificação própria.

## Conferência da conta no backend

`conciliarPublicacao` agora revalida a conta Total ativa/e-mail na própria
transação, sob a trava de gestão de usuários e bloqueio compartilhado da conta.
Revogação, rebaixamento, identidade divergente ou ator inválido impedem alterações.
A rota traduz essa recusa em403. Resultado e auditoria continuam atômicos,
vinculados ao recibo exato, preservando autoria/data originais do pedido.

## Evidência dirigida

**31/31 testes passaram**, zero falhas/cancelados/ignorados, saída0, incluindo
`action-reconcile`, `action-intent`, `action-journal` e `acoes`. A regressão nova
conserva o pedido ao desativar, rebaixar ou trocar o e-mail do ator e comprova
aceite somente depois de restaurar autorização válida. Os testes anteriores de
recibo, concorrência, rollback e permissões do handler também passaram.

Execução com ambiente limpo, PostgreSQL fictício54356 e mail dev; sem credencial
real, arquivo de ambiente ou chamada a executor. Log original:
`/tmp/admin-central-unit-zh8odyqe/validation.log`; cópia privada em
`.cache/qa-central-ui-20261108/unit.log`.

## QA integrado a executar no build atualizado

`tools/admin-qa/actions-ui.mjs` verifica a página compilada em seis larguras:
descrição de janela personalizada, perda de resposta após efeito fictício já
gravado, consulta sem repetir, histórico real e recusa sem recibo confiável.
Somente desliga uma configuração de reenvio já inativa no banco de QA; restaura
essa configuração e verifica preservação de assinaturas, mensagens e fila.
Não clica em Ligar reenvio, Publicar ou Terminal.

O positivo de recibo é provado pelo teste de backend em modo test. O navegador em
produção local deve recusar um recibo sem propriedade root; a guarda não será
relaxada para produzir um positivo artificial. O roteiro legado `action-intent`
foi atualizado para a conferência explícita sem segundo POST de execução.

O principal confirmou tipos/build integrado aprovados antes da rodada de
navegador abaixo. Esse build inclui a revalidação do ator e a lógica da Central.

## Diagnóstico do primeiro QA de navegador

O primeiro roteiro terminou com timeout esperando o resultado consultado no
cartão. A repetição instrumentada não escondeu o erro:320/390/768 passaram e a
consulta de992 recebeu HTTP429, “Muitas ações em pouco tempo. Aguarde um minuto.”
O limite `admin-acao:IP` é compartilhado entre alertas, leituras de histórico e
POSTs, mesmo quando cada rota usa tetos diferentes. A sequência acelerada das
seis larguras consumiu esse orçamento; não era prova de perda de intenção.

Falha original preservada em `http-initial-timeout.log`; diagnóstico em
`http-diagnostic-429.log` e `consultation-429.json`, dentro da pasta privada de QA.
O roteiro agora verifica a resposta da consulta antes do DOM e cadencia pares de
larguras pela janela real de60s, mantendo IP, conta, limite e asserções. Não
suprime429 nem o transforma em sucesso. A UI preserva a intenção quando o
backend pede aguardar; não repete execução automaticamente.

Repetição final: **saída0**, relatório `actions-ui.json` com as seis larguras
320/390/768/992/1280/1920 aprovado em
`/tmp/admin-central-http-284nkisl/`. A paginação injetou503 e conservou as30linhas
antes de recuperar a próxima página; efeito gravado com resposta perdida foi
consultado sem segundo POST de execução; recibo ausente resultou409 e nenhuma
publicação. Não houve exceção de página, falha de rede/HTTP inesperada ou
alteração de assinaturas/mensagens/fila/configuração preservadas. Servidor3036 e
banco fictício54356 encerrados ao fim.

Logs, JSON e capturas foram copiados para a pasta privada de QA. A inspeção
visual390 identificou colunas excessivamente estreitas na nova tabela. Foi
acrescentado `minWidth:760` dentro do contêiner de rolagem existente, preservando
fontes e demais estilos. Esse ajuste visual é posterior ao build testado e
precisa de novo build/conferência visual; não atribuir a ele a aprovação da
rodada anterior. O principal fará a consolidação com as demais frentes. O painel
integral continua incompleto pelos itens da auditoria de escopo.
