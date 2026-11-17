# Adaptador fixo São Paulo — engine fictícia validada, produção desativada

Fonte: `/mnt/apps/peticao-final/_ops/controle-operacional/deploy/sp_adapter.py`.
Testes: `/mnt/apps/peticao-final/_ops/controle-operacional/tests/test_deploy_sp.py`.

Não foi feito SSH, leitura de banco/segredos reais, instalação, publicação, e-mail ou commit nesta frente. Nenhuma readiness foi concedida a r0000 ou a outro artefato real. Callbacks reais ainda precisam ser instalados/qualificados pelo responsável da infraestrutura.

## Alvo e runtime fixos

Alvo físico único: peticao-sp. Destino do console/wire: sp-production, mapeado no código. Aplicação: `/opt/peticao/app`, obrigatoriamente diretório real. Serviço: peticao.service, User/Group peticao. Não há releases/current nem exigência de transformar a aplicação em symlink.

Formato inicial **next-start-v1**, compatível com `/usr/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1`. Mantém unit, EnvironmentFile `/etc/peticao/app.env`, bind/porta e ReadWritePaths existentes. A engine não lê nem altera `/etc/peticao/app.env`, HASH_PEPPER ou `/var/lib/peticao`. Ambiente/configuração protegida deve estar fora do pacote; preflight recusa .env* encontrado diretamente na raiz atual da aplicação, exigindo plano separado de preservação. Configuração de fonte como next.config.mjs pode integrar o runtime aprovado; não substituir configuração operacional secreta.

**next-standalone-v1 é recusado** nesta versão. Um server.js standalone não funciona automaticamente com a unit atual. Suportá-lo exigirá outro adaptador qualificado de launcher/drop-in, com backup/rollback desse drop-in e daemon-reload. Não foi implementado aqui.

## Entrada JSON e upload binário

Processo futuro ForceCommand restrito: uma linha JSON de no máximo 32768 bytes, terminada em newline. Na action upload, seguem exatamente artifact_size bytes binários e EOF. Sem base64. A conta/chave de transporte futura deve executar somente esse programa, sem shell, forwarding ou login root livre; esta frente não cria essa conta/chave.

Campos exatos do header:

```json
{
  "action": "preflight",
  "request_id": "ID_IMUTAVEL_DO_PEDIDO",
  "job_id": "ID_DO_JOB_DO_CONSOLE",
  "release_id": "r0001-exemplo",
  "manifest_hash": "SHA256_DO_CATALOGO_CANONICO_SELADO",
  "runtime_manifest_sha256": "SHA256_DO_MANIFESTO_INTERNO",
  "artifact_sha256": "SHA256_DO_TAR_FINAL",
  "artifact_size": 12345,
  "destination": "sp-production",
  "grant": {"claims": {}, "signature": "HMAC_HEX"},
  "lease": {}
}
```

IDs são tokens de 1–96 caracteres, sem barras; SHA256 são 64 caracteres hex minúsculos. Tamanho máximo do artefato: 1 GiB; limite descompactado: 3 GiB/100000 membros; manifesto interno: 32 MiB. Todos os caminhos de staging/backup são derivados do ID validado, sem aceitar caminhos do navegador. Staging `/opt/peticao/.ops-deploy-sp/ID`, fora de app e obrigatoriamente na mesma partição. Journal SQLite privado `/var/lib/ops-deploy-sp/journal.sqlite`. Backup `/var/backups/peticao-deploy/ID`.

Actions: preflight → upload → prepared → publish; status consulta; rollback é ação explícita distinta. RequestID+fingerprint são idempotentes. Repetir publish concluído não para/inicia serviço nem troca arquivos novamente. Repetição durante transporte interrompido vira uncertain; não retoma automaticamente. Consulte status antes de retransmitir upload já aceito.

## Três hashes e selagem

1. Criar inventário determinístico de todos os arquivos do runtime, sem incluir seu próprio hash nem o hash do tar; serializar como release-manifest.json. Obter runtime_manifest_sha256.
2. Empacotar release-manifest.json e runtime/; obter artifact_sha256 e artifact_size do tar final.
3. Publicar revisão imutável do catálogo com artifact.sha256/bytes e artifact.runtime_manifest_sha256, mais fonte/testes/compatibilidade; selar antes do grant Owner. Seu JSON canônico produz manifest_hash externo.

Isso evita circularidade: o catálogo inclui o hash do tar, portanto seu próprio hash não pode ser embutido naquele tar. Ausência de qualquer pin/evidência bloqueia qualificação. A engine não interpreta flags de um manifesto de fonte como prova de build.

Layout do tar: somente arquivos regulares release-manifest.json e runtime/CAMINHO. Sem entradas diretório, duplicatas, links simbólicos/hardlinks, especiais, setuid/setgid, nomes absolutos/traversal ou segredos (.env*, secrets, chaves/certificados etc.). O empacotador deve produzir a lista regular explícita; dependências com symlinks exigem exportação regular fiel e validada. O tar não executa scripts.

Manifesto interno exato:

```json
{
  "schema_version": 1,
  "release_id": "r0001-exemplo",
  "source_commit": "COMMIT_COMPLETO_HEXADECIMAL",
  "runtime_format": "next-start-v1",
  "entrypoint": "node_modules/next/dist/bin/next",
  "files": {"package.json": {"sha256": "SHA256", "bytes": 123}},
  "migration_id": null,
  "migration_ack_sha256": null
}
```

files precisa inventariar exatamente todos os arquivos: package.json, CLI/package do Next, `.next/BUILD_ID`, conteúdo `.next/server/` e `.next/static/` são mínimos estruturais; **não bastam para atestar dependências completas**. O callback root de qualificação deve comprovar runtime, dependências, fonte/commit, layout, testes e compatibilidade efetiva do schema/rollback, incluindo a versão real do PostgreSQL/Node. Um diretório .next sozinho é recusado. A engine confere novamente todos os bytes antes do backup e antes do exchange.

## Grant Owner exato e lease/fencing

O signer administrativo root deriva o grant exclusivamente do job-claim autenticado do console e da revisão já selada. Não aceitar claims montadas pelo navegador. Claims exatas: todos os campos do header exceto action/grant/lease, mais owner=operator-78ffa47eeb@example.invalid`, owner_nonce, operation=`deploy` ou `rollback`, issued_at, expires_at, migration_id e migration_ack_sha256. Todos os hashes/job/release/destino/tamanho devem coincidir. HMAC-SHA256 sobre `sp-grant-v1\n` + JSON UTF8 canônico (sort_keys=True, separators=(',', ':'), ensure_ascii=False), chave root de pelo menos 32 bytes. Validade máxima 1h; status permite consultar grant criptograficamente válido expirado. Rollback manual exige novo grant com operation=rollback. O rollback automático por smoke malsucedido pertence ao mesmo job autorizado.

Lease não é uma afirmação booleana do cliente: callback root deve validar prova criptográfica, coordenador/generation/fence_token/holder atuais, escopo job e validade em autoridade real. Sem callback vivo, recusa. Rechecagem ocorre antes da operação, após backups, antes do exchange e antes de iniciar a nova versão, inclusive rollback. O lock global SP impede dois publishers simultâneos; um job uncertain também bloqueia outro publish até reconciliação. O deploy não cria autoridade independente da coordenação.

Migração: nenhum SQL ou comando do manifesto é executado. Config root deve mapear migration_id a adapter previamente aprovado, e o grant precisa fixar o mesmo ID e SHA256 do ACK de compatibilidade. Sem allowlist/ACK, recusa. O callback root deve novamente validar a autorização; migrações precisam permitir retorno do código preservando dados posteriores.

## Callbacks administrativos para o responsável instalar

Configuração fixa `/etc/ops-deploy-sp/config.json`, root e 0600, sem symlink, produção enabled=false por padrão. CLI rejeita campos de configuração extras e não oferece fixture/target/path override. Campos: enabled, grant_key (hex), callbacks (mapa de nome para executável absoluto root), migrations (mapa root de ID para adapter aprovado). Todos os ancestrais dos executáveis/config precisam ser root e não graváveis por grupo/outros.

Cada callback é executável fixo, sem argumentos dinâmicos, sem shell. Recebe JSON stdin e emite somente JSON stdout. Ambiente mínimo PATH/LANG; configurações de PG e autenticação pertencem ao helper protegido, nunca ao pacote. Não registrar credenciais em stdout/stderr. Prazo máximo 600s; saída JSON até 32768 bytes.

| Nome | Entrada adicional | Resposta obrigatória/efeito |
|---|---|---|
| lease | scope, proof | valid:true, job_id exato, generation inteiro, expires_at futuro, após verificação viva de autoridade/fence |
| preflight | scope, target, unit, app | ready:true, protected_config_external:true, service_user/group peticao, runtime_format next-start-v1, environment_file `/etc/peticao/app.env`; verificar unit/exec reais, armazenamento e capacidade |
| qualify | runtime gerado e manifest | runtime_complete/tests_passed/schema_compatible/rollback_compatible/catalog_sealed todos true; manifest_hash, runtime_manifest_sha256, source_commit exatos; runtime_format next-start-v1. Provar evidência real contra catálogo selado; não ecoar flags |
| backup_app | output fixo `/var/backups/peticao-deploy/ID/app.tar` | criar arquivo privado preservando aplicação/config/permissões/links conforme plano de backup; verificar captura; retornar verified:true e sha256 |
| backup_pg | output fixo `/var/backups/peticao-deploy/ID/postgres.dump` | pg_dump consistente, verificar dump, retornar verified:true, consistent:true, sha256. Nunca copiar diretório de dados PostgreSQL ativo |
| service | operation stop/start | operar somente peticao.service; esperar confirmação real inactive/active; nunca aceitar unit/comando arbitrário |
| health | phase publish/rollback | smoke tests públicos/admin/confirmação/documentos esperados, retornar healthy:true somente com prova; sem alterar assinaturas/reenviar e-mails |
| migration | migration_id, adapter da allowlist root, ack_sha256 | executar somente adapter qualificado/autorizado; completed:true após comprovação |

Os callbacks recebem ainda scope/target/unit/app fixos. O callback de lease recebe scope/proof sem paths de aplicação. A engine verifica SHA256 e fsync dos backups antes do cutover. Nenhum callback de restaurar banco existe.

## Cutover e recuperação

Após backup da aplicação e dump PostgreSQL consistentes/verificados: parar serviço, executar apenas migração autorizada quando houver, revalidar lease/runtime/identidades e trocar `/opt/peticao/app` com staging/runtime por **renameat2(RENAME_EXCHANGE)**. Troca Linux única; nenhum instante deixa o caminho app ausente. Se indisponível/partições distintas, recusa, sem fallback com janela. O diretório anterior fica preservado no slot staging/runtime; cópia adicional está no backup privado. Iniciar serviço com a mesma unit e fazer smoke.

Smoke confirmado como falha provoca rollback atômico do código anterior e novo smoke. **Não restaurar o dump**, não apagar dados criados após deploy, não alterar HASH_PEPPER. Falha/timeout de callback/cutover/start fica uncertain, preservando journal e arquivos. Não repetir automaticamente. status observa identidades inode/dev dos dois slots e informa candidate/previous/unknown; não supõe sucesso pela presença de arquivo.

Se o processo morrer antes/depois do exchange, próxima consulta com lock livre identifica a operação interrompida e registra uncertain. Novo publish retorna esse estado. Recuperação é manual: grant rollback específico e lease vivo permitem restaurar o slot anterior quando identidades forem verificáveis; se o anterior já estiver no app, não troca novamente, apenas permite a recuperação explícita do serviço e smoke. Identidades desconhecidas recusam rollback. Backup histórico não é apagado pela engine. Rollback de migração/banco exige escopo próprio e não integra esse procedimento.

## Integração do worker do console

O worker root usa job-claim e o worker_token do console; valida autorização Owner, release/hash/destino/nonce e catálogo selado; deriva os pins e obtém lease real; então emite grant SP. Envia cada action/consulta pelo futuro transporte restrito. No console atual, completed do adapter corresponde ao terminal completed (publicada), rolled_back ao terminal reverted, uncertain a uncertain. Mapear fases internas: preflight/upload/prepared → staging; application_backup/postgres_backup → backup; migration → migrations; exchange/start → switch; smoke → smoke; rollback_* → rollback; estado uncertain → reconciliation. Reportar pelo job-update somente campos permitidos como artifact_sha256, checks, receipt_id e error_code. Resultado perdido sempre consulta o mesmo request_id, sem criar novo job ou publicar de novo. Worker_token/segredos não pertencem ao artefato nem à página.

Não instalar/chamar esta CLI contra produção até helpers, assinatura do grant, lease, runtime completo, backup e smoke terem qualificação operacional. Os testes atuais são fictícios, com diretórios temporários e callbacks fake; o console pode continuar mostrando releases de fonte como não prontas.

```sh
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/controle-operacional/tests -p 'test_deploy*.py' -v
/usr/bin/python3 -m py_compile /mnt/apps/peticao-final/_ops/controle-operacional/deploy/sp_adapter.py
```

Treze testes passaram: publicação/idempotência, rollback de smoke e manual preservando novos dados, crashes antes/depois do exchange, hash/truncamento/tar hostil, Owner/lease/concorrência, runtime/standalone/qualificação, adulteração pós-prepared, dump inválido e produção desativada. São evidências locais, sem autorização implícita de produção.
