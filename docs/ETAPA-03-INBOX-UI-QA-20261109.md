# Interface da caixa de entrada — 09/11/2026

## Contrato e escopo

Candidato isolado `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109`, branch `admin-v2-inbox-ui-20261109`, base `fadcba4`. Fontes aplicativo `34de02a` e `a460449`. Requisito da Etapa3 do plano original em `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/LOG-2026-11-04-planejamento-admin-v2.md`, agora ligado às APIs de leitura `033ab85` já existentes.

A nova página local `/admin/inbox` e o item “Caixa de entrada” no grupo Comunicação usam a estética/tokens existentes. A rota independente evita a ambiguidade de prefixo de `/admin/emails` no cálculo de grupo/título do menu. Página e APIs exigem Edição e confirmação recente; o servidor continua sendo a autoridade. A página não busca automaticamente contas, conversas, mensagens ou conteúdo na montagem.

O operador digita explicitamente o identificador da conta e clica “Atualizar”. Não se inventa uma conta configurada nem se enumera configuração privada. A primeira lista contém somente UUID da conversa, contagens e data; selecionar uma conversa busca metadados paginados das mensagens. Listas não exibem assunto, corpo, remetente ou anexos. A troca de conta limpa a conversa/mensagens anteriores; os cursores de listas são independentes e escopados pelo backend existente.

“Visualizar” em uma mensagem disponível busca somente então a prévia JSON transformada pelo `renderMailPreview` commitado. O documento transformado é apresentado em iframe `sandbox=""`, sem scripts/same-origin, com referrer-policy e CSP do documento já fornecida pelo renderizador. Não se usa o HTML original no DOM do painel nem se cria outro sanitizador. Anexos aparecem depois da prévia; “Baixar” solicita a rota protegida já existente, que entrega octet-stream como `anexo-N.bin`. Nenhum anexo é pré-carregado ou executado.

Paginação e atualização são explícitas; falha de próxima página preserva as linhas já recebidas. Há prazo de 15s e cancelamento de prévia ao fechar/Esc, com proteção contra resposta tardia e retorno de foco. Estados expirado/indisponível não oferecem abertura pela lista; o servidor confere novamente quando houver tentativa de leitura/download. Mensagens de falha são reutilizadas da interface de e-mail existente, sem novos informes legais ou coleta.

## Arquivos

- `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/site/src/components/admin/Inbox.tsx`
- `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/site/src/app/admin/inbox/page.tsx`
- `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/site/src/lib/inbox-view.ts`
- `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/site/src/lib/inbox-view.test.ts`
- `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/site/src/components/admin/shell/menu.ts` — um item neutro novo.

## Validação observada

1. Seis testes unitários passaram: projeção estrita de metadados e microssegundos, limites/cursor/duplicações, append imutável, envelope de prévia explicitamente transformada, transporte GET com cancelamento, SSR sem iframe/bytes/seleção automática e acesso pelo menu. Primeiro ensaio SSR via tsx revelou ausência do import default React; adicionou-se o import explícito e repetiu-se a bateria, preservando a falha em `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/.cache/qa-inbox-ui/unit-initial-jsx.log`. Resultado final: `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/.cache/qa-inbox-ui/unit.log`.
2. Typecheck global concluiu 0, sem diagnósticos: `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/.cache/qa-inbox-ui/types.log`.
3. Build Node20 de produção, um worker, ambiente fictício sem arquivos de ambiente, concluiu 0. Manifesto de fontes rastreados confirmou igualdade antes/depois: `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/.cache/qa-inbox-ui/build/execution.json`.
4. Navegador/HTTP compilado concluiu 0 de primeira em 320, 390, 768, 992, 1280 e 1920px. Banco novo próprio com 43 mensagens fictícias cifradas criadas pelo núcleo de recepção HMAC local; isso não ativou relay/conta/provedor real. Foram exercitadas 21 conversas, 22 mensagens na conversa principal, paginação de ambas, isolamento de segunda conta e controles desabilitados para registros expirado/indisponível.
5. Falha 503 injetada na segunda página de mensagens em 390px preservou as 20 anteriores; repetição manual trouxe as duas restantes. Listar contas/conversas/mensagens não gerou leitura/decriptação de conteúdo, conforme auditoria. Somente as seis prévias e seis downloads explicitamente escolhidos produziram 12 leituras de conteúdo.
6. HTML fictício com script/link/rastreador foi transformado pelo backend real; iframe continha sandbox vazio/CSP, e não continha script, URL externa ou bytes do anexo. Nenhuma execução ou requisição externa observada. Seis downloads conferidos por bytes e SHA256, com nome fixo correto. Nenhum POST do navegador. Sessão ausente, nível Leitura e confirmação extra ausente foram recusados nas rotas/API; página sem stepup encaminhou à confirmação.
7. Snapshot dos 43 registros inbound permaneceu idêntico. Nenhuma assinatura, mensagem de saída, fila de saída ou resposta de contato foi criada. Não houve erro JavaScript. Capturas de 320, 390 e 1280px inspecionadas, sem extravasamento horizontal da página; tabelas rolam internamente. Capturas completas de página conservam a posição em que o teste estava ao registrar cabeçalhos fixos; não representam alteração do shell.

Prova principal: `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/.cache/qa-inbox-ui/http/inbox-ui.json`. Capturas/logs: `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/.cache/qa-inbox-ui/http/`. Checksums: `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/.cache/qa-inbox-ui/manifest.json`. Servidor, navegador e PostgreSQL próprios encerrados; portas 3036/54356 verificadas livres.

## Reprodução

Diretório de execução `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109`:

```sh
/usr/bin/python3 /mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/tools/admin-qa/inbox-ui-local.py build
/usr/bin/python3 /mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/tools/admin-qa/inbox-ui-local.py http
```

Contrato navegador: `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/tools/admin-qa/inbox-ui.mjs`. Lifecycle: `/mnt/dev/peticao/.cache/admin-integration/candidate-inbox-ui-20261109/tools/admin-qa/inbox-ui-local.mjs`. Harness exige candidato/portas próprios, dependências existentes, nenhum arquivo de ambiente, provedor dev e configuração fictícia. Node: `/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node`; dependências `/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules`.

## Limites e continuidade

Conclui a leitura administrativa concreta sobre as APIs atuais. Não ativa recepção de e-mails reais, não configura conta/relay, não envia/responde e não altera políticas de retenção/coleta. O operador precisa conhecer o identificador da conta; o backend atual não oferece catálogo de contas. A prévia atual contém os campos projetados pelo renderizador, sem campo específico de remetente inbound; não se inventou essa informação na interface. Exibir remetente após abertura é uma futura decisão/integração explícita, sem necessidade de revelar assunto/corpo nas listas.

Etiquetas, atribuição de responsável, estados organizacionais do plano original, respostas/rascunhos sobre e-mails inbound e novos fluxos de curadoria não foram implementados nesta frente de leitura. Não há integração com IA, Rich WIP, outbound/Contato, produção ou deploy. A completude do admin-v2 integral continua sob o coordenador.
