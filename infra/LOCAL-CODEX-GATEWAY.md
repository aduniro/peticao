# Gateway local para sessões existentes — envio real desabilitado

Código: `/mnt/apps/peticao-final/_ops/controle-operacional/infra/local_codex_gateway.py`.
Testes: `/mnt/apps/peticao-final/_ops/controle-operacional/tests/test_gateway.py`.
Prova readonly sanitizada: `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/gateway-readonly-proof.json`.
Rodada final dos testes: `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/gateway-tests-ram.log`. A tentativa em disco permanece registrada em `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/gateway-tests.log`.

A interface da [documentação oficial do App Server](https://learn.chatgpt.com/docs/app-server) exige inicialização por conexão e permite consultar metadados com thread/read sem retomar a sessão. O cliente instalado foi qualificado pelo próprio --help: `/home/barre/.codex/packages/app-server-daemon/releases/0.166.0-x86_64-unknown-linux-musl/bin/codex app-server proxy --sock /home/barre/.codex/app-server-control/app-server-control.sock`.

O proxy encaminha bytes crus para o socket WebSocket existente. O gateway faz HTTP Upgrade, valida Sec-WebSocket-Accept e usa frames de cliente mascarados. Não inicia outro app-server, não muda configuração/modelo/provider e não lê arquivos de autenticação do Codex. A primeira tentativa JSONL expirou sem resposta; o diagnóstico foi corrigido no framing, não por troca de conta/provedor ou servidor.

A qualificação readonly enviou somente initialize, initialized, thread/read e thread/read, com includeTurns=false. O socket permaneceu o mesmo. Só foram registrados IDs, estados e flags conhecidas; títulos, previews, conteúdo/histórico, mensagens brutas e stderr não são persistidos. Estados observados são pontuais e não demonstram disponibilidade futura.

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/controle-operacional/infra/local_codex_gateway.py --qualify-readonly
```

## Aliases fixos

- apoio: 01a1c0b3-f069-75a0-a2e9-e691094c9bab.
- admin: 01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7.

Não há target arbitrário, método RPC livre, shell, anexos, citações estruturadas, mudança de goal ou overrides de modelo/provider. Os papéis PAGINA/APOIO do executor mapeiam para apoio; ADMIN mapeia para admin.

## Interface stdin/stdout

Uma única requisição JSON por execução; o cliente precisa fechar stdin. Resposta JSON única, sem logs brutos. Para futura SSH ForceCommand, usar comando fixo sem aceitar argumentos do cliente; ignorar SSH_ORIGINAL_COMMAND. Nenhuma configuração SSH foi instalada nesta frente.

Exemplo de estrutura (os valores de assinatura/nonce são ilustrativos, não copiáveis):

```json
{
  "action":"submit",
  "requestId":"request-UUID",
  "alias":"apoio",
  "instruction":{"text":"Texto explícito congelado, sem anexos ou metadados de citações."},
  "keyId":"local-codex-v1",
  "ts":1794340000,
  "nonce":"32-ou-mais-caracteres-hexadecimais",
  "signature":"HMAC-SHA256-hex64"
}
```

Status usa action=status, requestId e os cinco campos de autenticação; não aceita alias/instruction. action=qualify_readonly usa somente action e autenticação. Não encaminha métodos fornecidos pelo usuário ao daemon.

Assinar UTF8 de JSON com sort_keys=true, separadores compactos (vírgula/dois-pontos), ensure_ascii=false, excluindo SOMENTE signature. HMAC-SHA256 com chave binária de32 a128 bytes em arquivo regular0600, proprietário do processo, absoluto e sem symlink. keyId é fixo local-codex-v1. ts deve ser inteiro Unix com desvio máximo120 segundos. nonce precisa de32 a128 caracteres hex minúsculos e não pode ser reutilizado. Campos extras, chaves JSON duplicadas e valores não finitos são recusados. Nonce e digest do envelope sem assinatura são auditados sem armazenar o texto da instrução ou a assinatura.

A chave padrão prevista é `/mnt/apps/peticao-final/_ops/controle-operacional/state/gateway.hmac`. Ela **não foi criada nem distribuída** nesta implementação; o responsável pela instalação deve fazê-lo por canal protegido e separado das chaves SSH. O gateway não imprime seu conteúdo. Nunca enviar a chave em argumentos de shell, e-mail ou commits.

Recibos ficam em `/mnt/apps/peticao-final/_ops/controle-operacional/state/local-codex-gateway.sqlite`, modo0600, fora Git. O diretório deve ser privado do operador. Outbox e conteúdo congelado ficam no executor; este banco retém hash, alias, IDs, estado, motivo e transições, não a instrução original. Não apagar recibos para contornar uma tentativa incerta.

Resposta:

```json
{"ok":true,"result":{"requestId":"request-UUID","receipt":"gw-UUID","alias":"apoio","state":"waiting","reason":"live_adapter_not_qualified","live":false,"adapter":"disabled","instructionHash":"SHA256","updatedAt":"UTC","answer":null}}
```

Erros retornam `{ok:false,error:CODIGO,state:waiting}` sem dados brutos. Estado waiting cobre thread_busy, thread_paused, indisponibilidade e falta de qualificação. Default disabled não abre o proxy nem inicia turnos em submit/status.

## Idempotência e execução incerta

A mesma requestId e o mesmo hash retornam o recibo existente; conteúdo/alias divergentes são recusados. Nonce repetido é recusado mesmo se a requestId existir; uma consulta/repetição legítima precisa de novo nonce e assinatura. Requests ainda waiting, sem tentativa anterior, podem ser submetidos de novo com a mesma instrução congelada quando a situação mudar. Status sozinho nunca despacha um waiting.

A reserva de tentativa é persistida antes da chamada do adapter. Há no máximo um pedido em dispatching/accepted/uncertain por alias. Exceção após reservar tentativa produz uncertain; repetição de submit/status não a reexecuta. Processo interrompido em dispatching também é tratado como incerto. Uma resposta direta ainda em trânsito pode resolver a tentativa, mas não há reenvio automático. Não inferir falha ou liberação pelo silêncio, thread idle ou falha de rede. Esta versão não fornece endpoint para apagar/reconciliar uncertain; isso exige uma futura operação administrativa qualificada e evidências.

## Fixtures e limites atuais

`--adapter fixture` é opção local explícita para testes; não pode ser selecionada pelo JSON remoto. Ela simula accepted/completed ou busy/paused/unavailable/uncertain, sem rede, ferramentas ou modelo. A resposta conhecida de conclusão é fixture-completed. Default --adapter disabled mantém live=false. Não usar resultado fixture como prova de envio real.

21 testes passaram (15 do gateway e6 do qualificador isolado): HMAC/timestamp/replay; idempotência e concorrência; exclusão por alias; waiting; incerteza sem repetição; rejeição de target/model/goal/anexos/RPC; permissões da chave; ausência da instrução nos recibos; framing WebSocket; e recibo persistente entre processos stdio. Testes usam apenas chaves/bancos temporários fictícios.

```bash
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/controle-operacional/tests -p 'test_gateway*.py' -v
```

O qualificador real em thread nova fictícia, se autorizado, fica isolado em outro programa e não amplia ALIASES/METHODS deste gateway. Nenhum envio às sessões reais, e-mail, SSH, alteração de goal/configuração ou atividade unsigned bloqueada foi executado por esta implementação.

## Qualificação real fictícia autorizada separadamente

Programa isolado: `/mnt/apps/peticao-final/_ops/controle-operacional/infra/qualify_fixture_turn.py`. Sua allowlist não modifica os métodos nem aliases do gateway geral. Schema obtido do gerador local do cliente0.166 em `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/fixture-protocol-schema`. Essa versão só aceita sandboxPolicy readOnly/networkAccessfalse, sem readableRoots do guia atual; não foi usado campo sem suporte.

A autorização adicional do coordenador permitiu uma única thread nova ephemeral e um único turno com o prompt fixo de resposta OPS_BRIDGE_FIXTURE_OK. O programa validou o schema, a identidade nova, cwd vazio, ephemeral e sandbox readonly antes de iniciar geração. Não enviou model, provider, objetivo, configuração global ou solicitações às duas sessões reais. Um handler detecta itens de ferramenta/comando e solicita interrupção somente do turno fictício com identidade confirmada.

Prova sanitizada: `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/fixture-turn-proof.json`. Resultado observado19:29:53UTC em10/11/2026: completed, resposta esperada conferida por hash; uma thread/start e um turn/start; zero ferramentas/comandos; socket mantido; modelo/provider sem override. Nenhum conteúdo de histórico/resposta foi salvo. A thread recebeu ephemeral=true; não se afirmou exclusão/arquivamento do lado servidor, pois nenhum método de arquivo foi chamado. Somente o proxy cliente foi encerrado; daemon permaneceu no mesmo socket.

A intenção persistida em `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/fixture-turn-intent.json` impede repetir o programa: não remover nem substituir esse arquivo para tentar novamente. Um resultado incerto exige reconciliação, nunca outro turn/start automático. Como essa execução já ocorreu, não executar novamente --run-once.

Verificação sem RPC e sem geração:

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/controle-operacional/infra/qualify_fixture_turn.py --preflight-only
```

Esta prova qualifica o transporte e um turno fictício, não habilita comandos de produção, envio às sessões existentes ou e-mails reais. O gateway continua live-disabled, aguardando decisão do coordenador para qualquer etapa adicional. Os testes unitários do qualificador usam schemas/workspaces temporários fictícios; a prova real usou o schema gerado pelo cliente instalado e registra seu SHA.

## Condição de I/O observada durante a entrega

A última rodada com bancos temporários em disco sofreu espera de journal (processos em jbd2_log_wait_commit) e erros de contenção SQLite. Somente o processo desta rodada foi interrompido. Não foram apagados arquivos nem encerrados processos de outras frentes. Os bancos, schemas e workspaces FICTÍCIOS dos testes foram movidos para /dev/shm quando disponível; a rodada final passou em21 testes,0,463s. Não houve repetição do turno real fictício.

Essa mudança é exclusiva dos testes: recibos operacionais permanecem SQLite durável em disco; não foi reduzido synchronous, WAL ou o controle de idempotência operacional. Desempenho/disponibilidade do armazenamento local precisam ser considerados antes da ativação de produção; os testes em RAM não qualificam latência de persistência do disco. Default live-disabled continua vigente.
