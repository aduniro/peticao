# Rollback com pacotes v2 pendentes

A guarda antiga tratava somente filas de e-mail correlacionadas. O teste novo demonstrou que ela aceitava um pacote v2 ainda pendente. A versão antiga do emissor não entende o envelope de dois anexos nem sua identidade; não é seguro permitir essa volta automaticamente.

Reprodução preservada: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/package-delivery-1794288941275336573/result.json` (32/33; a nova asserção de recusa falhou).

A SQL fixa agora examina os pacotes antes de qualquer alteração em fila/auditoria e recusa quando há lote com pacote em estado diferente de sent/cancelled. Bloqueio não altera PDFs, pacote, estado do lote, fila ou auditoria. Pacotes antigos terminados/cancelados não impedem a guarda de filas já existente. Tabelas parcialmente incompatíveis produzem erro; não existe fallback para remover o segundo PDF ou apagar pacotes.

O comando root também exige ausência de consumidores A1 ativos (dispatch e worker), além da aplicação e do agendador existentes. Serviços opcionais não instalados preservam o caminho legado. Não houve instalação, parada de serviço ou execução de comando na VPS: somente alteração local dos arquivos do futuro deploy e testes com mocks.

Se uma publicação futura falhar e encontrar essa situação, a volta antiga será abortada de propósito. Deve-se manter os consumidores parados e recuperar a versão que entende o envelope v2, ou analisar e encerrar os lotes por operações suportadas. Não editar status, apagar histórico ou desativar a guarda para forçar retorno. O publicador atual não passa a parar/reiniciar A1 automaticamente; atividade A1 exige coordenação explícita antes da troca.

Verificações do código staged sobre 99f9fa7:

- Caso dirigido de rollback: 1 aprovado, demais casos ignorados pelo filtro solicitado; não apresentar como suíte inteira. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/package-delivery-1794289058805538803/result.json`.
- Rodada completa relacionada, 38/38: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/package-delivery-1794289113066137774/result.json`.
- TypeScript exit0: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794289113133235761/result.json`.
- 19 testes Python de guarda/publicação com consumidores e psql simulados: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/rollback-guard-20261110/root-mock-tests.json`.

O novo filtro opcional do runner local limita a reprodução/primeira correção aos nomes escolhidos; os comandos e ignorados ficam no resultado. A rodada completa continua necessária para aceitar a mudança. Não houve novo build da aplicação neste incremento: só mudaram o SQL/script de rollback, testes e ferramenta QA. O fluxo compilado de 99f9fa7 permanece evidência histórica das fontes da aplicação, não demonstra uma execução de rollback na VPS.

Este incremento não conclui homologação ICP/gov.br, assinatura própria do presidente, demais módulos ou aceite integral do admin-v2. Nenhum deploy/merge autorizado por este teste.
