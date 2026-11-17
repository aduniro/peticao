# Central privada — contrato de integração

Implementação: `/mnt/apps/peticao-final/_ops/controle-operacional/console/console.py`; assets irmãos `/mnt/apps/peticao-final/_ops/controle-operacional/console/index.html`, `/mnt/apps/peticao-final/_ops/controle-operacional/console/app.js`, `/mnt/apps/peticao-final/_ops/controle-operacional/console/app.css`. Copiar os quatro juntos para o diretório definitivo do serviço. Pythonstdlib; nenhum build Node necessário.

## Estado e configuração

`OPS_CONSOLE_ROOT` ou `--root`, padrão `/srv/ops-console`. SQLite `/srv/ops-console/console.sqlite`; config `/srv/ops-console/config.json`; pepper separado `/srv/ops-console/auth-pepper`, ou arquivo apontado por `OPS_AUTH_PEPPER_FILE`. Diretório0700, arquivos0600 e artefatos0400. Não reutilizar HASH_PEPPER da aplicação. Sem segredo em argumento CLI, Git, stdout humano ou relatório.

Inicialização, a executar pelo integrador com o usuário do serviço:

`/usr/bin/python3 /CAMINHO/ABSOLUTO/console.py --root /srv/ops-console init --origin https://HOST-TAILNET:PORTA`

Gera pepper aleatório independente se ausente. `--pepper-stdin` recebe32–4096bytes pelo stdin protegido, nunca imprime. O campo `origin` ou `OPS_PUBLIC_ORIGIN` é uma origem HTTPS exata, sem path/query. HTTP só é permitido com configuração explícita `insecure_test:true` e hostname loopback. Cookies são Secure conforme origem HTTPS, mesmo atrás de proxy local. Não confiar em X-Forwarded-* arbitrário. Backend somente loopback/Tailnet, nunca bind0.0.0.0. O integrador configura proxyHTTPS/Tailnet; a Central não instala serviço nem cria endpoints públicos.

`config.json` inicia `production_enabled:false`. Destinos são ENUM `fixture` e `sp-production`; o segundo só aparece/fica habilitado quando configuração administrativa fixa autoriza. O alias não contém host/path/comando do navegador. Adapter root mapeia sp-production para peticao-sp por configuração fixa. Habilitar configuração não executa deploy.

## Catálogo imutável

`/usr/bin/python3 /CAMINHO/ABSOLUTO/console.py --root /srv/ops-console publish-release --manifest /ARQUIVO/ABSOLUTO/manifest.json [--artifact /ARQUIVO/ABSOLUTO/artefato.tar]`

`list-releases` retorna os registros. Não existe endpoint HTTP para publicar ou alterar manifesto.

Schema interno: release_id (rNNNN/sufixo simples), title, source:{commit40hex,...}, build:{status:'complete',executable:true,runtime:{...}}, artifact:{sha256:64hex,bytes:int,format:...}, tests:[{name,status:'passed',...}], completed:[], pending:[], compatibility:{public_admin:true,schema_reviewed:true,migrations_reviewed:true,rollback_reviewed:true,coordinator_acks:['apoio','admin']}, readiness:{declared_ready:true}, schema e rollback opcionais.

Readiness é calculada separadamente de manifesto: exige artefato regular com bytes/hash conferidos, build executável completo e runtime explícito, testes registrados aprovados, compatibilidade/revisão de schema/migrations/rollback e ACK dos dois coordenadores. Declarações vêm do publicador administrativo confiável e não substituem evidências/lease reais do ledger. Não se procura .next nem se infere prontidão por diretório existente. Ausência de qualquer gate mantém ready=false. Pendências gerais são apresentadas separadamente; o publicador é responsável por não declarar pronta uma release com impedimento essencial.

O artefato é copiado, conferido e armazenado por SHA em `/srv/ops-console/artifacts/SHA256`, máximo2GiB. Não extrair nem executar na Central. Repetir mesmo release_id+manifesto é idempotente; mudar manifesto do ID existente é rejeitado. Nova validação/build exige nova release. A imutabilidade é contratual no catálogo, não WORM contra o administrador do host. Hash dos bytes executáveis é conferido novamente no claim do worker.

Adaptador de fonte real: schemaVersion1,releaseId,state:'source-recorded',readyForDeploy:false,runtimeArtifact:null,buildResult:null. Normaliza para catálogo source-only, tests:[], build/artifact:null e ready=false, sem inventar runtime/validação. Preserva SHA dos bytes originais em manifest.original_manifest_sha256. `manifest_hash` da Central é SHA256 do JSON canônico normalizado e é ESSE hash que o grant/job usa. O hash original é evidência separada. O r0000 real foi lido e ingerido apenas em banco temporário de teste; seu arquivo original permaneceu intacto.

## Owner e HTTP

Destinatário fixo: operator-1608598f41@example.invalid. Não há campo de destinatário no navegador.

- GET `/healthz`: estado do serviço de catálogo/fila; não prontidão da aplicação.
- GET `/api/session`: cookie anônimo aleatório HttpOnly/SameSiteStrict/Secure e csrf para o cliente.
- POST `/api/auth/request` `{}`: cria desafio login e outbox, sem enviar.
- POST `/api/auth/verify` `{challenge_id,code}`: confirma OTP, consome desafio, rotaciona cookie e CSRF; sessão Owner8h.
- POST `/api/auth/logout` `{}`: revoga sessão.
- GET `/api/releases`, `/api/jobs`, `/api/status`: exigem Owner.
- POST `/api/grants/request` `{release_id,manifest_hash,destination}`: exige Owner, release pronta e destino permitido. Cria OTP de aprovação separado de login, vinculado à composição exata.
- POST `/api/grants/verify` `{challenge_id,code}`: retorna grant_token efêmero, preso a sessão+release+manifest_hash+destino; validade300s.
- POST `/api/jobs` `{request_id:UUID,release_id,manifest_hash,destination,grant_token}`: exige Owner+grant; cria um job e consome grant na mesma transação.

Todos os POST exigem Origin exato, X-CSRF-Token da sessão, JSON até16KiB e Sec-Fetch-Site compatível. Não há CORS. Não aceita shell, path ou target livre. Idempotência por request_id: mesma release/hash/destino retorna o MESMO job, mesmo se grant já foi consumido ou gate posteriormente desabilitado. Tupla diferente é409. Uma resposta perdida é consultada no histórico; não há repetição automática de deploy no frontend. Browser guarda somente request_id/release/hash/destino em sessionStorage, nunca OTP/grant_token.

OTP8dígitos, TTL600s, HMAC-SHA256 com pepper privado, cinco erros por desafio; limites globais de solicitação ao Owner e por peer em janelas15min. Novos desafios invalidam os anteriores da mesma finalidade/sessão e eliminam payloads ainda não enviados. Código/grant/cookie nunca entram em logs HTTP/eventos. HTTP request logging está desabilitado; não registrar corpos em proxy/transporte. CSP sem inline scripts, frame-ancestors none, no-store e nosniff. Expiração de sessão/OTP é conferida no backend.

## Outbox — integrador de e-mail separado

`outbox-claim` retorna uma mensagem ou null, reservando uma única vez:

`{id,recipient:'operator-1608598f41@example.invalid',kind:'owner_otp',payload:{otp,challenge_id,purpose:'login'|'deploy',release_id,manifest_hash,destination},expires_at,delivery_token}`

**SAÍDA CONTÉM SEGREDOS TRANSITÓRIOS.** Consumir programaticamente, sem imprimir em chat/log. Não existem mensagens até o usuário solicitar código. No e-mail de deploy, mostrar claramente release, manifest_hash e destino; não apresentar código genérico sem esse contexto. Aceite do provedor não prova entrega.

`outbox-result` recebe JSON por stdin ou `--input /ARQUIVO/PROTEGIDO`:

`{id,delivery_token,state:'accepted'|'rejected'|'uncertain',provider_receipt?:ID}`

Apaga payload OTP em qualquer resultado terminal e na expiração; eliminação é lógica no SQLite, não promessa de remoção forense dos WAL/backups. Nunca recoloca mensagem sending/uncertain automaticamente na fila. Callback tardio pode registrar aceite mesmo após expiração, mas o OTP continua inválido. Resultado incerto pode ser reconciliado com `{reconcile:true,state:'accepted'|'rejected'}` após consulta ao provedor, sem novo envio. Novos cliques podem pedir outro código; o transporte não deve reenviar silenciosamente o anterior.

## Worker de deploy — sem execução na Central

`jobs`: até200 jobs recentes. `job-claim --worker NOME`: reserva no máximo um job e retorna null se existe reserved/running/uncertain; não cria coordenador ou lease global próprio. Adapter root ainda deve obter/verificar o lease/fencing real compartilhado antes de efeitos. A reserva local apenas serializa esta fila.

Claim retorna campos do job + worker_token + release completa com artifact_path administrativo. Inclui authorization durável `{owner,owner_nonce,grant_id,challenge_id,approved_at,release_id,manifest_hash,destination}`. Artifact SHA/bytes e source.commit vêm do manifesto imutável; signer root deve ligar job_id/release/hash/artifact/destino/nonce ao grant do adapter externo.

**worker_token é segredo transitório de controle local.** Persistir recibo/token em diário protegido ANTES de efeitos. A reserva não expira/reabre automaticamente. Se a resposta do claim se perder antes de persistir token, job permanece bloqueado para intervenção administrativa; a Central não inventa recuperação nem reexecuta.

`job-update` recebe JSON por stdin/arquivo protegido:

`{id,worker_token,state:'running'|'completed'|'failed'|'uncertain'|'reverted',phase:'reserved'|'staging'|'backup'|'migrations'|'switch'|'smoke'|'rollback'|'reconciliation',result:{...},reconcile?:false}`

Result permite somente summary,artifact_sha256,deployed_commit,checks,previous_release,receipt_id,error_code (JSON máximo8KiB). Não mandar log bruto, stderr, tokens, e-mails pessoais ou env. completed exige phase smoke/reconciliation, artifact_sha256 e deployed_commit exatos do manifesto e checks não vazios com name/status:'passed'. Incerto bloqueia novos claims e só aceita atualização com reconcile:true, phase:reconciliation após consulta real; não retorna queued. Resultados/eventos mantêm job/release/hash ligados. Não há endpoint HTTP que atualize worker ou dispare shell.

A implementação não executa staging, backup, migrations, switch, smoke, rollback, SSH, containers ou e-mail. Qualificação desses adapters e controle de lease/rollback permanecem com o integrador. Homologar com fixture antes de habilitar produção.

## Hook específico de e-mail e status do ledger

Root pode importar o módulo e chamar `make_server(app,host,port,extensions={('POST','/api/mail/approve'):callback,...})`. Somente GET/POST no namespace /api/mail/ são aceitos. Antes de callback: Owner autenticado nos GET e Owner+Origin+CSRF nos POST; ambos exigem login Owner recente≤900s. Callback recebe `({owner_id,session_id},data)`; são só identidade autenticada e hash de sessão, sem segredo de cookie/CSRF/OTP. Retorna objeto JSON ou levanta Denied(code,status). `Handler.require_csrf()` e `owner_context(recent_seconds=900)` estão disponíveis. Assertion/HMAC de aprovação de e-mail é separada e produzida pelo adapter root, vinculada a stage_id+instruction_sha256; nunca reutilizar grant de deploy.

`/srv/ops-console/ledger-status.json` é snapshot somente leitura e limitado64KiB, fornecido por adapter root sanitizado. A Central não abre coord.sqlite nem escreve autoridade do ledger. Sem snapshot, mostra não conectado. Não copiar histórico bruto ou segredos para esse arquivo.

## Verificação e limites restantes

Testes: `/mnt/apps/peticao-final/_ops/controle-operacional/tests/test_console.py`.

`/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/controle-operacional/tests -p 'test_console*.py' -v`

Fixtures locais/HTTP/fake mail apenas. Cobrem OTP/TTL/tentativas/rotação e escopo, cookies/Origin/CSRF, hook recente Owner, outbox incerta/tardia, fonte real não pronta, imutabilidade/hash, artefato alterado, concorrência/idempotência/restart e conclusão presa ao commit/artefato correto. Nada enviado ou publicado. Integração real de entrega, HTTPS/proxy, worker qualificado, lease global, backup/migrations/rollback, navegador completo e processos persistentes ainda são passos do root, não declarados concluídos por estes testes.
