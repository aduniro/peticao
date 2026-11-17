# Primeira liberação administrativa concorrente

Revisão local de 09/11/2026. A hipótese inicial de corrida na configuração ausente **não se confirmou**: `setDocumentPublication` chama `authorizeBatchActor`, que adquire o bloqueio transacional administrativo 7003 antes de acessar `settings`. Portanto, o caminho completo já serializa essa criação inicial. O `FOR UPDATE` de uma linha ausente, isoladamente, não explica o comportamento completo.

Foi acrescentado somente um teste de regressão: três solicitações concorrentes com a mesma revisão esperada, com atraso controlado na inserção fictícia. O resultado é exatamente uma liberação, dois conflitos e uma auditoria; a consulta posterior reconhece a versão liberada. O teste também confirma ausência de assinaturas ou envios produzidos por essa operação.

Rodada Node 20.19.2 isolada: **6/6 testes**, saída 0, sem ignorados. Log: `/tmp/admin-mail-history-lhn8aqzj/validation.log`. PostgreSQL temporário 54366, dados fictícios, sem ativação real de publicação ou provedor. Nenhuma alteração de código de execução, DDL, texto de interface, frontend, VPS ou dados reais foi necessária.
