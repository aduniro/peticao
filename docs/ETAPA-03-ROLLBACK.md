# Etapa 3 — retorno protegido do transporte

Implementado somente no candidato. Não instalado nem executado na VPS; não conclui a integração do admin-v2.

## Procedimento fixo

O publicador preserva o lock comum, confere o candidato e compila antes de parar consumidores. Suspende o agendador e o app durante a troca. Se o processo novo não iniciar ou a página inicial não responder, para o app antes de chamar `/usr/local/sbin/peticao-mail-rollback-guard`. O guard exige root, nenhum argumento, lock válido, processos gerenciados parados e `KillMode=control-group`. Seu SQL deve ser arquivo regular, sem link, pertencente a root e sem escrita de grupo/outros, assim como a pasta imediata.

A conexão usa o usuário postgres, banco local fixo `peticao`, ambiente limpo e psql sem arquivo de inicialização. Não lê app.env nem credenciais. O SQL usa transação com prazos de lock/execução e trava a fila e a cadeia de auditoria.

Fila correlacionada pendente com aceite comprovado por tentativa finalizada passa a enviada, com a data real do aceite disponível. As demais correlacionadas pendentes ficam retidas com `mail_rollback_quarantine`: isso não prova recusa ou ausência de entrega. Filas legadas sem vínculo ficam intactas. Payloads, identidades, tentativas, registros de assinantes e horários originais são preservados. A auditoria lista somente IDs das filas afetadas; repetir a operação não cria efeitos novos.

Somente após sucesso do guard o código anterior pode iniciar. O candidato que falhou fica em diretório separado. Se o guard falhar, app e agendador permanecem parados e `app.old` é preservado para intervenção. Publicação posterior recusa backup de recuperação não resolvido antes de compilar/parar o app. Um timer antes inativo não é ativado pelo publicador.

## Limites operacionais

A conferência das unidades, usuários e perfil PostgreSQL reais ainda deve ocorrer antes de qualquer instalação autorizada. Não usar o guard com processos externos de envio ativos. Uma quarentena exige investigação do provedor/resultado durável; não apagar nem reenfileirar automaticamente. A recuperação de tentativas indeterminadas durante operação normal ainda está pendente. Este mecanismo não oferece prova de entrega ao destinatário nem valida rollback de todos os outros módulos.

## Evidências

Cinco testes SQL em PostgreSQL isolado comprovam preservação, idempotência, cadeia de auditoria, rollback se a auditoria falhar, base legada e recusa de schema parcial. Os testes Python simulam systemd/root/transportes: verificam ordem de parada/guard/retorno, falha de início, recusa do guard, backup anterior, timer inativo, permissões e ausência de herança de credenciais libpq. São provas locais; não são uma execução root na VPS.

Logs em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: `stage03-rollback-sql-final.log`, `stage03-rollback-pipeline-final.log`, `stage03-rollback-cumulative.log` e `stage03-rollback-typecheck.log`. A primeira falha Python foi preservada no histórico: a fixture criava SQL com permissão dependente da umask. Agora ela fixa 0644 para o caso permitido e testa 0666 separadamente; a proteção de produção não foi relaxada.

Resultado final deste checkpoint: **331/331 cumulativos**, **17/17 Python**, cinco testes SQL específicos, tipos, sintaxe shell e `git diff --check` aprovados. Nenhum componente, texto ou estilo mudou; não se repetiu o build ou QA visual já concluído sobre o mesmo código aplicativo. A integração integral e o deploy continuam pendentes.
