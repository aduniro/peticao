# Coorte de primitivos transacionais de e-mail — notas para aceite

Commitcandidato4a29bf61941b70148d05359d2d3173a587ca9eb7. Esta coorte ébase de Reenvios, não a funcionalidade completa. Nenhum endpoint novo, transporte alternativo, fila, geração de assinatura, banco deprodução ou política de reenvio foi ativado.

## Comportamento

prepareMessage e finishAttempt mantêm wrappers com transação própria e mesmos resultados. A persistência comum foi extraída para permitir helpers internos com o PoolClient da transação externa. Auditoria é adiada explicitamente até todos os locks/escritas de negócio, preservando a ordem da cadeia. Callers novos devem obrigatoriamente append+commit ou rollbackintegral em qualquererro; não há prova de commitexterno no retorno dohelper.

Proofs privados emWeakMap vinculam client/txid e estado persistido, com verificação antes/depois deappend; objetos de preparação e metadados congelados. Isso impede reuso apóscommit, autocommit e auditoria de dados desfeitos porSAVEPOINT. Falha de auditoria desfaz a unidade inteira, incluindo vínculos aeventos. Não converterresultadoincerto emaceite.

## Evidências já concluídas antes do port

- Prepare/reserva independente:22puros/tipos0+7PGreais(campanha),comrollbackaudit/sessão/concurrency/catalog/savepoint/triggeradverso,porta54381fechada/guard0.
- Finish independente:33PGreais (10novos+23archive/events),inclrollbackledger/audit/savepoint/aggregate/reconcileScope;typesglobaisclone0;porta54382fechada/guard0.
- Combinaçãoprefixprepare+suffixfinish:36PGreais (13novos+23archive/events),0skip e typesglobaisclone0. Evidência /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-finish-transaction-next-draft/pg-runs/1794333644871528977/execution.json e typecheck.json.
- Revisorindependenteencontrou classeSAVEPOINT antesport; fixreadback+casosPGadversos incluídos. Semfalsadeclaração sobreprovas fakes.

## Entrada de QA versionada

/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/mail-transaction-local.py exige commitcompletoexplicito,checkoutlimpo,Node20.19.2SHAfixo,PG18.4,DEVDBporta54382exclusiva+PGDATAefêmero,configs vazias,MAIL_PROVIDER/MAIL_PROVIDERSdev,guarddeDNS/TCP/fetch,cloneporfontesversionadas. Antesbootstrap dos testes,preload confere data_directory do servidorcontraPGDATAowned. Timeoutgrupo deprocessos ecleanup somentePGDATAdojob. Registra fonte/HEAD/toolingSHA/guard/result/porta.

QAexecutávelporcomandoabsoluto:
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/mail-transaction-local.py --execute --expected-candidate-commit 4a29bf61941b70148d05359d2d3173a587ca9eb7

Apóscommitposterior,usarSHAatualcompleto; artefatos continuam identificadospeloSHA testado. Este comando éfictício/local, não aplica migrationdeprodução. npmtestgenérico não inclui arquivos .pg.test.ts emsubdiretório;usarentradaespecífica,semprecomguards.

## Próximas dependências

Validar finalização atômicaledger/journal e readbackdurávelpóscommit; integrar geração/bindings/retarget e todosescritoreslegados,driverúnico comguardoriginal,API/controller/UI+Nextreal. Nenhumdessesfluxosédeclaradoconcluído por esta coorte.


## Aceite da coorte no candidato

A entrada versionada foi executada contra o commit4a29bf61941b70148d05359d2d3173a587ca9eb7 e passou36/36 (0skip), com fontescandidato/HEAD/tooling estáveis,guardinstalado+zeroexterno,PGDATAowned verificado antesbootstrap eporta54382fechada. Evidência: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-transaction-qa-runs/1794334080374228497/execution.json; logvalidation.log nomesmo diretório. Mapa dasfontessharedarchive idêntico àcombinaçãoqualificadaprivada,tipo globaldoclone0. Este aceite ébackend e não declara novo buildNext da versão4a, homologação emprodução ou fluxoReenvios pronto.
