# Transporte privado do A1 — desenvolvimento, não ativado

Arquivos novos no candidato `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109`:

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/service.py`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/test_service.py`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/a1-worker-client.ts`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/a1-worker-client.test.ts`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/deploy/peticao-a1-worker.service`

Nenhuma unidade foi instalada, iniciada ou habilitada. Nenhum certificado real, banco ou VPS foi acessado. O worker/contrato anteriores permanecem inalterados.

## Fronteira de acesso

O processo web conecta somente a `/run/peticao-signing/worker.sock`, por socket Unix0660. Template usa usuário dedicado `peticao-signing` e grupo da aplicação `peticao-web`. O diretório do socket0750 pertence ao serviço. A conta web pode conectar, mas não possui leitura dos diretórios0700 e arquivos0600 de credenciais pertencentes ao assinador. Não dar ao grupo web leitura do PFX, senha ou configurações privadas.

O serviço recebe apenas o JSON do contrato já definido. Não aceita paths de certificado, senha, intérprete ou comando pelo pedido. Só o supervisor escolhe a configuração protegida `/etc/peticao-signing/service.json`; override `A1_SERVICE_CONFIG` é configuração administrativa de serviço/teste, nunca derivada de requisição. O serviço valida proprietário/permissões/ancestrais e recusa links ou escrita por grupo/outros na configuração; código/intérprete também precisam de caminhos confiáveis. O symlink do intérprete de venv é conferido sem perder o caminho original de execução e, portanto, o ambiente Python correto.

O broker não consulta banco, não admite job durável e não concede autorização administrativa. **Somente o executor durável após claim, Total+stepup e autorização vigente deve chamá-lo.** Acesso ao socket é autoridade para solicitar operação técnica; não o disponibilizar a usuários arbitrários. O resultado precisa passar pelo finish/CAS e verificador definidos no job. `ok:true` do transporte não aprova, não envia e não qualifica ICP. O cliente preserva `icpBrasilQualified:false` do contrato.

## Configuração privada do serviço

Exemplo estrutural (somente referências; nada foi provisionado):

```json
{
  "version": 1,
  "socketPath": "/run/peticao-signing/worker.sock",
  "pythonPath": "/opt/peticao-signing/venv/bin/python",
  "workerPath": "/opt/peticao-signing/worker.py",
  "workerConfigPath": "/etc/peticao-signing/worker.json",
  "maxConcurrent": 2,
  "workerTimeoutSeconds": 60
}
```

A configuração do worker contém referências persistentes do PFX, senha e confiança conforme `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/README.md`. Ela é lida pelo serviço apenas para validar proteção no startup; seu conteúdo não vai para o processo web. O subprocesso recebe ambiente mínimo criado pelo serviço, sem copiar ambiente da requisição ou todas as variáveis do pai. Intérprete e script são fixados pela configuração confiável; execução sem shell, stdin/stdout privados, stderr descartado. Não registrar payload/PDF/base64, configuração ou exceções com caminhos.

## Protocolo e limites

Um frame de requisição e um de resposta por conexão: quatro bytes unsigned big-endian com tamanho, seguidos dos bytes JSON UTF-8. Não é HTTP e não há listener TCP ou fallback. O socket é fechado ao final. Socket existente não é apagado no startup: o operador/supervisor precisa verificar socket obsoleto; o serviço não elimina objeto desconhecido.

- JSON de entrada limitado pelo `MAX_REQUEST` do worker, validado antes de iniciar subprocesso: hash, tamanho, campos e binding estritos.
- Subprocesso de job único com timeout1–60s, stdout lido incrementalmente e limitado; falha, stdout excessivo, JSON inválido ou exit diferente de zero retornam indisponibilidade sanitizada. Grupo de processos é encerrado no timeout/finalização.
- Concorrência1–4, padrão administrativamente configurado2. A semáfora é adquirida antes de criar thread de handler; conexões excedentes são fechadas sem iniciar outro worker.
- Cliente Node `requestA1Worker(binding, original)` tem uma tentativa, valida pedido e resposta com contrato existente, hash/binding e limite de frame. Timeout padrão65s, ajustável100–65000ms somente por `A1_WORKER_TIMEOUT_MS` do servidor. `A1_WORKER_SOCKET` também é somente configuração confiável do servidor. A função não recebe caminhos/opções HTTP.
- Timeout ou conexão perdida não significam que o subprocesso não assinou. Não repetir automaticamente; o estado do job durável determina reconciliação/reautorização, e lease/CAS bloqueiam publicação atrasada.

Template restringe família de sockets a AF_UNIX, egress, privilégios, filesystem, dispositivos, contas, memória/CPU/tarefas; mantém `/run/peticao-signing` como única escrita permitida necessária. Não há script de instalação automática. Instalação futura deve verificar usuários/grupos, ownership, venv pinado e proteção do material; o template não provisiona nem altera esses recursos.

## Validação desta etapa

6 testes Python: socket0660 e cleanup, contrato inválido não inicia worker, limites/timeout/exit/malformed, ambiente mínimo e stderr não propagado, concorrência e preservação de objeto existente. Worker fake é inofensivo e não abre certificados/rede.

4 testes Node: resposta fragmentada, binding exato, timeout/drop sem retry, tamanho/truncamento/hash/resposta inválidos e input inválido sem conexão. Tipos estritos dos dois novos arquivos e do contrato importado passaram.

Comandos completos usados:

```bash
A1_TEST_PRIVATE_ROOT=/home/barre/.cache/peticao-a1-worker-qa /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-worker-venv/bin/python /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/test_service.py
/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import /mnt/apps/peticao-final/peticao/site/node_modules/tsx/dist/loader.mjs --test /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/a1-worker-client.test.ts
```

O diretório privado de QA existe com0700; testes não instalam serviço e usam socket temporário. `systemd-analyze verify` do template encontrou somente o executável de destino ausente (`/opt/peticao-signing/venv/bin/python`), esperado porque não houve provisionamento. Isso não é prova de serviço instalado/operacional.

Logs protegidos e evidências: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-service-python-tests.log`, `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-service-node-tests.log` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-service-evidence.json`.

## Scheduler dedicado (template, não instalado)

`/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/dispatch.py` chama exclusivamente o endpoint local `/api/cron/a1`, sem payload, proxies, redirecionamento ou retry. A credencial systemd vem de `/etc/peticao-signing/cron-token` e não deve ser gravada no repositório. O resultado técnico sanitizado não comprova envio ou aprovação de lote. Os templates `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/deploy/peticao-a1-dispatch.service` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/deploy/peticao-a1-dispatch.timer` só documentam a instalação futura; nenhuma unidade foi ativada. Quatro testes offline cobrem segredo inválido, resposta, limites e falhas sem retry. A fila de e-mails continua independente.
