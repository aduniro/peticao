# Histórico comum e exclusão de alterações entre dois coordenadores

Ferramenta local: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py`.
Banco operacional privado: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/state/coord.sqlite`.
Testes: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/test_coord.py`.

Esta ferramenta não edita o app, não faz merge/deploy, não envia e-mail e não inicia um agente. O subagente que a implementou recebeu o contexto desta conversa por herança de sessão; não copiou arquivos de chat, senhas, chaves ou conteúdo de cadastros. O pai é responsável por integrar o watcher persistente e o relatório horário solicitado pelo responsável. Um pulso do watcher não comprova desenvolvimento ou compatibilidade.

## Participantes e fontes físicas

| Ator | Sessão | Checkout acompanhado |
|---|---|---|
| apoio | 01a1c0b3-f069-75a0-a2e9-e691094c9bab | /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109 |
| admin | 01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7 | /mnt/dev/peticao, /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109 e /mnt/apps/peticao-final/peticao-integrado |

Os três caminhos do inventário original são árvores físicas distintas. No inventário inicial, a consolidação estava no branch main, HEAD b9e8ae2574125df90d80fc18ef24832f5d646ce0; /mnt/dev/peticao no branch integracao-admin-vps, HEAD 5b78e1871351c00ba96458689d31764211f4ee29; candidato real admin no branch admin-v2-final-20261109, HEAD 0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f. Esses valores são checkpoints observados, não promessa de estado atual. Nenhum arquivo da aplicação foi alterado nesta implementação.

## Consultar e registrar

Executar na máquina local, de qualquer diretório:

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py status
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py history --after-seq 0 --limit 200
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py observe --actor apoio --repo /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109 --app-code-only --no-require-ack
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py observe --actor admin --repo /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109 --app-code-only --no-require-ack
```

`observe` aplica por padrão allowlist de app: site/src, site/assets, site/public e manifests/configs específicos. Executa Git com pathspec e `--untracked-files=no`; registra somente HEAD, branch, nomes/estados dos arquivos e stat. Não lê nem copia seu conteúdo. CSV/TSV/XLS/XLSX/SQLite/DB/SQL/dump/log, .env, segredos, builds e dependências ficam fora da observação. O fingerprint inclui metadados do arquivo, identificando novas gravações mesmo que o estado Git continue M. Não é hash de conteúdo nem prova de compatibilidade. Na primeira observação cria baseline sem ACK; nas próximas, sem `--no-require-ack`, mudanças exigem ACK. O watcher deve usar essa flag para telemetria e publicar um anúncio separado quando houver um contrato/alteração para revisão.

Para registrar alteração intencional que o outro coordenador precisa conhecer:

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py announce --actor apoio --resource code:site/src/app/page.tsx --summary 'Descrever comportamento e evidência; sem dados pessoais'
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py ack --actor admin --event NUMERO_RETORNADO
```

`announce` exige ACK por padrão. Para telemetria factual, usar `--no-require-ack` e recurso coord:sessions. ACK significa ciência/revisão pelo par, não aprovação humana adicional nem prova de teste. Os comandos são cooperativos: quem chama deve usar sua identidade real, conferir o conteúdo e só declarar resultados observados. A ferramenta não autentica a identidade do agente contra a API do Codex.

## Reservar arquivos antes de editar

O mesmo caminho relativo nas quatro árvores autorizadas mapeia para o mesmo recurso lógico. Por exemplo, as quatro grafias absolutas de site/src/lib/db.ts convertem-se em code:site/src/lib/db.ts. Um diretório conflita com todos seus descendentes. Paths físicos fora das árvores usam path:/caminho/absoluto; a grafia `path:` também é normalizada e exige caminho absoluto. Labels semelhantes sem relação de ancestralidade não conflitam.

Reserva do editor da página (ajustar aos arquivos realmente tocados):

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py acquire --actor apoio --operation edit --ttl 600 --resource code:site/src/app/page.tsx --resource code:site/src/components
```

Reserva do admin para uma alteração transversal, somente quando estiver de fato realizando essa alteração; não manter essa lista inteira reservada por conveniência:

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py acquire --actor admin --operation edit --ttl 600 --resource code:site/src/lib/db.ts --resource code:site/src/lib/signatures.ts --resource code:site/src/lib/assinaturas-email.ts --resource code:site/src/lib/institution-registry.ts --resource code:site/src/lib/mail --resource code:site/src/lib/whatsapp --resource code:site/src/app/api --resource code:site/package-lock.json
```

O retorno contém lease, token, fence e expires. Guardar o retorno em arquivo privado, nunca em commit/e-mail. Renovar durante atividade real e checar imediatamente antes de cada mutação externa. Exemplo com os valores retornados:

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py renew --actor apoio --lease LEASE --token TOKEN --fence NUMERO --ttl 600
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py check --actor apoio --lease LEASE --token TOKEN --fence NUMERO
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py release --actor apoio --lease LEASE --token TOKEN --fence NUMERO --outcome completed --summary 'Commit, testes e resultado observados'
```

`check` valida a posse no ledger, mas o filesystem/Git/provedor não aplicam fencing automaticamente. Os dois agentes e os wrappers de execução precisam respeitar o protocolo. O lease não é sandbox, consentimento para alterar dados nem garantia contra um processo que ignore o protocolo. Não registrar tokens no texto de anúncios. Status e histórico omitem o token gerado pelo ledger.

## Manifesto obrigatório para merge, deploy e migration

Antes de adquirir um lease crítico, publicar anúncio imutável com este esquema e aguardar ACK do outro coordenador. O autor já declara concordância ao publicar. Todos os outros avisos relevantes pendentes também precisam ser reconhecidos.

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py announce --actor apoio --resource code:site --resource deploy:production --summary 'Manifesto explícito da atualização a publicar' --data-json '{"manifest":{"commit":"SHA_COMPLETO_40_HEX","files":["site/src/app/page.tsx"],"api_contracts":"sem alteração ou contratos alterados","database":"sem alteração ou plano explícito","tests":["comando, resultado e caminho absoluto da evidência"],"destination":"peticao-sp:/opt/peticao/app; identificar serviço e URL"}}'
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py ack --actor admin --event NUMERO_DO_MANIFESTO
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py acquire --actor apoio --operation deploy --resource deploy:production --manifest-event NUMERO_DO_MANIFESTO --ttl 600
```

O SHA ilustrativo precisa ser substituído por40 caracteres hexadecimais reais. `files` e `tests` devem ser listas não vazias de strings; `api_contracts`, `database` e `destination` precisam de descrição explícita, aceitando “sem alteração” onde cabível. A ferramenta confere estrutura e ACK, não a veracidade dos testes ou existência remota do commit. Os pares devem conferir as evidências e o hash congelado. Um manifesto antigo não qualifica mudanças novas: cada alteração de commit/arquivos/contrato requer outro anúncio e ACK. Não reutilizar um manifesto para outra intenção.

Merge, deploy e migration reivindicam automaticamente code: (todas as fontes), além dos recursos pedidos. Assim nenhum editor pode continuar alterando fonte enquanto a operação crítica está reservada. Deploy e migration também exigem recurso global deploy: ou db:. Para merge usar operação merge e destino exato de repositório/branch no manifesto. Não há execução de publicação neste utilitário; o pai deverá integrar esse gate aos wrappers reais, respeitando a autorização atual do responsável.

## Expiração, incerteza e recuperação

TTL entre30 e3600 segundos; padrão600. Expirar não transfere posse: o recurso passa para uncertain e bloqueia novos donos e renovação. Não basta a sessão estar offline ou um processo parecer ausente. Primeiro conferir commit, processos/logs/recibo remoto e o resultado da operação; publicar uma reconciliação com evidência verificável e obter confirmação dos dois coordenadores.

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py propose-resolution --actor apoio --lease LEASE_INCERTO --result completed --evidence '/CAMINHO/ABSOLUTO/DO/RECIBO; estado remoto conferido'
/usr/bin/python3 /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py confirm-resolution --actor admin --resolution RESOLUCAO_RETORNADA
```

A proposta já registra a confirmação de seu autor. A mesma pessoa não substitui o outro ACK. A confirmação final libera o recurso como reconciled; uma nova aquisição gera fence maior. Tokens ou fences antigos não são aceitos. Não há takeover automático após timeout, reinício ou perda de rede. Se a evidência estiver inconclusiva, manter uncertain e continuar apenas tarefas independentes.

## Persistência, limites e verificação

SQLite usa BEGIN IMMEDIATE, WAL e busy_timeout. Eventos são append-only por triggers SQL; tentativas normais de UPDATE/DELETE abortam. A autoridade do sistema é cooperativa: quem já possui acesso de escrita ao arquivo SQLite pode contornar o aplicativo; não é uma auditoria criptográfica contra administrador malicioso. Diretório de estado0700, banco0600, umask077 no CLI. Manter banco, WAL/SHM, tokens, provas operacionais e exportações fora Git. O pai deverá decidir backups e retenção sem descartar histórico em curso.

Executar testes sem app/VPS/produção, com dados fictícios e banco temporário:

```bash
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/coordenacao-dupla/tools -p test_coord.py -v
```

15 testes passaram: concorrência entre dois processos, independência de arquivos, normalização física/lógica, manifestos/ACKs, fencing/token, expiração sem takeover, reconciliação dupla, eventos imutáveis e observação sem conteúdo/artefatos pessoais. A ferramenta não é um daemon e o término do subagente não significa monitoramento contínuo. Watcher e e-mail horário são serviços separados mantidos pelo pai.

## Extensão ao candidato integrado — 10/11/2026

Após aprovação do plano pelo responsável (referência informada pelo coordenador: evento93), o único ledger local passou a reconhecer também `/mnt/apps/peticao-final/peticao-integrado`. Verificado no momento da extensão: worktree no branch `integration/admin-v2-publico-20261110`, HEAD `0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f`. Não houve alteração de fontes, merge ou deploy nesta extensão.

O participante admin mantém sua sessão e os dois repositórios anteriores, acrescentando o integrado. Paths sob esse root coalescem para `code:` como nos candidatos anteriores. O prefixo parecido `/mnt/apps/peticao-final/peticao-integrado-outra` fica fora desse mapeamento; somente o root explicitamente cadastrado e seus descendentes são reconhecidos. A regressão valida exclusão entre os candidatos e esse limite.

O banco `/mnt/apps/peticao-final/_ops/coordenacao-dupla/state/coord.sqlite` permanece a autoridade única. Um adaptador remoto deve encaminhar chamadas para esse CLI/ledger; não inicializar outro banco em Santiago nem adotar uma fila paralela para substituir o lock. A ausência de conectividade com o ledger exige falhar fechado para mutações coordenadas. Esta extensão não modifica o watcher, timers, e-mail ou política de publicação.
