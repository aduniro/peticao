# Executor por e-mail — prova de conceito isolada

Implementação: `/mnt/apps/peticao-final/_ops/controle-operacional/executor/executor.py`.
Worker persistente: `/mnt/apps/peticao-final/_ops/controle-operacional/executor/worker.py`.
Testes: `/mnt/apps/peticao-final/_ops/controle-operacional/tests/test_executor.py`.
Testes do worker: `/mnt/apps/peticao-final/_ops/controle-operacional/tests/test_executor_worker.py`.
Plano lido: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/PLANO-INTEGRACAO-CUMULATIVA-20261110.md`, seção 9. O responsável confirmou a aprovação ao coordenador; esta frente não altera aplicação, unsigned, revisão bloqueada, DNS, caixas postais, Cloudflare, console, deploy ou infraestrutura.

**Não há ponte Codex real habilitada, servidor HTTP em execução nem envio de e-mail real nesta entrega.** O endereço planejado `executor@exec.sancionaintegral.org` ainda depende do ingresso/provedor que o coordenador qualificar. A presença de uma PoC não comprova recebimento de mensagens ou anexação à sessão atual.

## Contrato e persistência

Python stdlib. `Executor(database, config, adapter=None)` cria uma fila SQLite própria, com requests, eventos, nonces, eventos inbound, staging e outbox. Usar banco protegido e separado, por exemplo `/srv/ops-executor/executor.sqlite`; não é o banco do console nem de assinaturas. O diretório deve ter 0700, o banco 0600 e o processo umask 0077. Chaves/configuração ficam fora do Git, por exemplo `/etc/ops-executor/config.json` com 0600. Nenhuma chave real foi criada por esta frente.

Estados de pedido: received → authenticated → queued → submitted → waiting → completed; rejected, failed ou uncertain quando aplicáveis. Cada transição é auditada. Antes de chamar o adapter, a intenção submitted é persistida. Perda de resposta depois desse ponto vira uncertain; não há novo submit automático. `recover()` converte submitted interrompidos e entregas de outbox em andamento para uncertain. Executar recuperação somente no início exclusivo do worker; CLI recover/tick compartilham lock local para impedir concorrência entre eles. Um daemon futuro deve manter a mesma exclusão durante startup/loop.

Aliases permitidos: ADMIN (também Admin-v2), PAGINA (também PÁGINA e homepage), APOIO, GERAL, STATUS, LISTAR; comparação não distingue maiúsculas/minúsculas. Configuração fixa mapeia ADMIN/PAGINA/APOIO para UUIDs de threads existentes. **GERAL é um único pedido global, coordenado pela thread ADMIN.** Sua metadata derivada e retornada pelas APIs contém `global_scope:true`, `coordinator_alias:ADMIN`, `children_implemented:false`. A deduplicação continua por pedido/envelope, e não há envio cego às duas threads, filhos ou agregação de resultados implementados. Isso será coordenado posteriormente pelo responsável. O adapter precisa declarar explicitamente `global_scope_supported:true` antes de aceitar esse pedido; sem suporte, mantém espera.

A mensagem não fornece threadId, comando shell, caminho de executável ou destino arbitrário. STATUS e LISTAR são processados localmente sem IA. Citações, anexos, Reply-To e demais campos não são incorporados à instrução. Somente o campo explícito e congelado instruction é encaminhável. O adapter de e-mail precisa separar texto autoral de texto citado; não concatenar MIME/anexos ao campo instruction.

## Ingestão forte: duas provas independentes

`Executor.ingest(body_bytes, headers)` recebe no máximo 128 KiB; instruction no máximo 8192 bytes. A camada HTTP futura deve impor o limite antes de carregar o corpo, usar TLS externo e encaminhar apenas esse endpoint mínimo, sem publicar console/terminal/app-server. Esta função não abre listener.

Prova do provedor normalizado:

- X-Executor-Provider: provider_id configurado;
- X-Executor-Timestamp: Unix em segundos, tolerância de 300 segundos;
- X-Executor-Nonce: token único de 8–128 caracteres;
- X-Executor-Signature: HMAC-SHA256 hexadecimal sobre `webhook-v1\n{provider}\n{timestamp}\n{nonce}\n` seguido dos bytes exatos do corpo.

Esse é o contrato **interno da PoC**, não uma alegação de que um provedor comercial use esses headers. O adapter real, a ser qualificado pelo coordenador, deve primeiro validar a autenticação original do fornecedor e sua identidade/conta, ou fazer coleta autenticada, e só então gerar o envelope interno. Nunca confiar em Authentication-Results fornecido pelo remetente.

Corpo JSON forte:

```json
{
  "provider_id": "fornecedor-normalizado",
  "provider_account_id": "conta-pareada-do-fornecedor",
  "provider_event_id": "evento-unico-0001",
  "from": "operator-1608598f41@example.invalid",
  "recipient": "executor@exec.sancionaintegral.org",
  "owner_account_id": "conta-owner-pareada",
  "owner_key_id": "chave-owner-0001",
  "request_id": "pedido-unico-0001",
  "alias": "ADMIN",
  "instruction": "Texto explicitamente autorizado pelo Owner.",
  "issued_at": 0,
  "owner_nonce": "nonce-owner-unico-0001",
  "owner_signature": "HMAC_HEXADECIMAL"
}
```

O timestamp ilustrativo 0 é inválido em execução real. owner_signature usa outra chave, independente, e HMAC-SHA256 de `owner-v1\n` seguido do JSON canônico dos campos owner_account_id, owner_key_id, from, recipient, request_id, alias, instruction, issued_at, owner_nonce. JSON canônico: sort_keys=True, separators=(',', ':'), ensure_ascii=False, UTF-8. O Owner pareado e From devem corresponder ao destinatário fixo operator-78ffa47eeb@example.invalid`; **From sozinho não autentica**. Validação de conta do fornecedor, destinatário, relógio e dedup é obrigatória. Um request_id repetido com o mesmo envelope consulta o registro anterior; conteúdo diferente é recusado. Nonces e provider_event_id não autorizam duas execuções.

## E-mail comum: aguarda confirmação no console

O usuário não precisa calcular HMAC manualmente. `Executor.stage(body, headers)` é uma API separada para e-mail comum já recebido por adapter de provedor autenticado. Usa os campos provider_id, provider_account_id, provider_event_id, from, recipient, alias e instruction; ainda não exige prova Owner. O corpo é **dado não confiável**: congela alias/instruction/from/recipient, guarda SHA256 e estado `pending_owner_confirmation`, sem criar pedido executável. Enfileira aviso rastreável ao Owner fixo. From forjado não consegue executar nessa etapa.

`Executor.read_staged(stage_id)` permite ao adapter interno fornecer a instrução congelada à página de revisão. O chamador deve autenticar Owner antes de exibir; não publicar essa função sem autenticação. Citações/anexos não entram no conteúdo congelado. Quando o console mostrar o conteúdo, tratá-lo como texto, nunca HTML/instrução do próprio console.

`Executor.list_staged(limit=100)` fornece somente índice com stage_id, state, instruction_sha256, alias, created_at, approved_at, request_ref e metadata, sem corpo da instrução. `Executor.list_status(limit=100)` retorna estados públicos e metadata dos pedidos; aceita limites de 1 a 100. `read_staged` mantém o conteúdo congelado exato e metadata separada. Esses métodos não autenticam sessão web por si: o adapter do console aplica Owner/CSRF/Origin antes de chamá-los. Aliases alternativos são canonicalizados antes de congelar o staging; a aprovação assina esse conteúdo exato, inclusive GERAL.

`Executor.approve_staged(assertion, signature)` exige chave approval_key independente, pareada separadamente com o adaptador do console. Assinatura HMAC-SHA256 de `console-approve-v1\n` + JSON canônico desta assertion **exata**:

```json
{
  "issuer": "owner-console",
  "owner_account_id": "conta-owner-pareada",
  "stage_id": "ID_DO_STAGING",
  "instruction_sha256": "SHA256_DO_CONTEUDO_CONGELADO",
  "decision": "approve",
  "issued_at": 0,
  "nonce": "nonce-aprovacao-unico-0001"
}
```

Tolerância de 120 segundos e nonce único. O console deve emitir isso somente após autenticação Owner, proteção CSRF/Origin e aprovação explícita daquele conteúdo/hash. **Não reutilizar grant/OTP de deploy**, pois seu escopo é distinto. Sem chave/adapter específico, a confirmação permanece indisponível; não basta um booleano de aprovação enviado pelo cliente. A API gera envelope forte e associa o pedido resultante ao staging. A geração é idempotente, inclusive após interrupção entre ingestão e associação. Não altera nem amplia gates de publicação, permissões, pausa ou bloqueios.

O endpoint do console e seu adapter de aprovação ainda não foram integrados nesta frente; código de console pertence a outro agente. Até essa integração, e-mail comum mantém fila/aviso e **não executa**.

## Ponte para sessões existentes

Interface injetável:

```text
probe(thread_id) -> ready, reason, existing_session, exclusive, state, provider, model, global_scope_supported
submit(thread_id, request_id, instruction, metadata=None) -> state, receipt
poll(receipt) -> receipt, state, answer
```

O adapter padrão DisabledLiveAdapter sempre informa bridge_unqualified; submit/poll reais são desativados. FixtureAdapter é explicitamente fictício, usado só em testes. Não há shell, subprocess, codex exec, novo app-server, thread/resume, turn/start ou turn/steer real. A interface futura usará a conexão stdio/socket Unix **da instância existente**, depois que o coordenador comprovar anexação segura e exclusividade. Não prometer suporte live apenas porque o protocolo existe.

Contrato do gateway fictício paralelo: ADMIN → alias admin, PAGINA/APOIO → alias apoio. GERAL exigirá coordenador admin com metadata global preservada; não remover essa metadata para forçar compatibilidade com um gateway antigo. Gateway recebe JSON assinado `{action:'submit',requestId,alias,instruction:{text},keyId,ts,nonce,signature}` e status por requestId; recibo/correlação precisam ser preservados. O transporte entre esse gateway e esta interface ainda não é live; não se inicia nem retoma uma thread ativa para qualificá-lo por outro caminho.

Só encaminhar quando sessão existente/ociosa/exclusiva e provedor/modelo corresponderem à configuração esperada. Ocupada/ausente/pausada/bloqueada/sem limites mantém waiting com aviso deduplicado. Pedido uncertain também bloqueia outro submit para a mesma thread até reconciliação humana. Receipt mismatch vira uncertain. Erro numa consulta de resultado mantém espera; nunca reapresenta o turno. Nenhuma mudança de provedor/modelo automática.

## Outbox separado e somente Owner

As respostas são criadas na mesma transação do pedido/transição. `outbox_claim()` devolve `{id,request_ref,recipient,kind,body}` e persiste submitting antes do transporte externo. recipient é sempre operator-78ffa47eeb@example.invalid`; Reply-To é ignorado. Não aceitar destinatário do navegador/mensagem. `outbox_result(id, state, provider_id)` aceita accepted/rejected/uncertain. Accepted significa aceito pelo provedor, **não comprova entrega**. Reinício/timeout incerto não recria nem reenvia aquela mensagem. Consultar spool e reconciliar pelo mesmo ID. O transporte real fica com o coordenador, separado do banco de OTP do console.

Ingressos sem autenticação do provedor recebem erro/trace_id e não geram instrução ou resposta arbitrária. Pedidos com origem do provedor válida e prova Owner inválida ficam rejected e geram aviso ao Owner fixo. Replays exatos recebem erro consultável; o pedido original/outbox preservam seu histórico. Nenhuma mensagem vai a terceiros.

## Worker persistente exclusivo

`Worker(executor, deliver=None, interval=2, stop_event=None, paused=None, heartbeat=None)` em `/mnt/apps/peticao-final/_ops/controle-operacional/executor/worker.py` mantém o mesmo lock privado `.worker.lock` usado pela CLI tick/recover durante **toda sua vida**. Apenas o processo vencedor chama recover, uma vez no início. Depois executa dispatch/poll e, quando configurado por código administrativo confiável, um callback de outbox por ciclo. Não roda recuperação no meio do loop. Falha inesperada encerra com failed; um supervisor futuro pode reiniciar e aplicar a recuperação única de startup. Não foi instalado serviço nesta frente.

Sem deliver, nenhum item é claimed: permanece pending, com transporte indisponível no heartbeat. Callback retorna `{state:accepted|rejected|uncertain, provider_id:receipt}`. Exceção/resultado inválido após claim vira uncertain e não é reenviado; accepted não comprova entrega. Para integrar o transporte administrativo já existente, o responsável pode usar um callback que chama `transport.send(message)` **uma vez** e transforma seu Result.state/Result.receipt nesses campos. Não há importação/configuração real desse transporte nesta CLI.

`paused()` retorna bool: quando true, não despacha novos pedidos. Consultar resultado já aceito é somente observação e nunca retoma uma sessão. Pausa/bloqueio/limites do adapter continuam obrigatórios mesmo quando o worker não está pausado. Heartbeats contêm apenas estado, horário, ciclos, modo da ponte e disponibilidade/estado do transporte; nunca a instrução, anexos ou segredos. SIGTERM/SIGINT solicitam parada limpa; o lock é liberado ao sair. O intervalo é limitado a 0,05–60 segundos. Não cria segundo scheduler de relatórios.

CLI ilustrativa futura, que mantém a ponte live desativada e não envia e-mail:

```sh
/usr/bin/python3 /mnt/apps/peticao-final/_ops/controle-operacional/executor/worker.py --config /etc/ops-executor/config.json --database /srv/ops-executor/executor.sqlite --interval 2
```

## CLI e testes

Comandos ilustrativos para instalação futura; configuração e banco indicados não foram criados por esta frente:

```sh
/usr/bin/python3 /mnt/apps/peticao-final/_ops/controle-operacional/executor/executor.py --config /etc/ops-executor/config.json --database /srv/ops-executor/executor.sqlite status
/usr/bin/python3 /mnt/apps/peticao-final/_ops/controle-operacional/executor/executor.py --config /etc/ops-executor/config.json --database /srv/ops-executor/executor.sqlite tick
```

Ações ingest/stage recebem JSON stdin `{body_base64,headers}`; read-staged recebe `{stage_id}`; approve-staged recebe `{assertion,signature}`; outbox-result recebe `{id,state,provider_id}`. list-staged/status/outbox-claim/recover não recebem payload. Não passar segredos por argumento de terminal. Config.load exige caminho absoluto, arquivo sem symlink e sem permissões para grupo/outros; chaves provider_key/owner_key/approval_key são hex de pelo menos 32 bytes e independentes. Demais campos são os da dataclass Config, incluindo mapa threads fixo, expected_provider e expected_model.

```sh
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/controle-operacional/tests -p 'test_executor*.py' -v
```

Dezenove testes passaram, com fixtures exclusivamente em `/dev/shm`: os dez anteriores mais aliases alternativos/GERAL, índices/metadata, worker único, recover único, pausa, falta de transporte, perda de resposta SMTP, falha de ciclo e pedido global coordenado uma única vez. Evidência é somente local/fictícia. Permanecem com o coordenador: pareamento de conta, ingresso real do fornecedor/TLS, wiring do console de confirmação, instalação supervisionada, transporte real de respostas e qualificação da sessão existente. Nenhum teste sintético equivale a envio real ou ponte live homologada.
