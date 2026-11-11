# Executor local de testes PG17 de Materiais

**Preparado, sem execução real.** Diretório: `/mnt/apps/peticao-final/_ops/qa-materials-pg17-20261111`.

A configuração mantém `infra_reviewed=false`. O programa recusa a execução antes de preparar fontes ou chamar Docker. Root e revisor independente precisam aprovar uma ativação com novo manifesto e reservar o recurso antes de um único ensaio. Não é deploy, executor remoto ou servidor HTTP.

## Fontes e dependências

A fonte é o commit `7b7bff946022ef54a0c0b808fe4418d5f6e7473d`: base f555, backend de Materiais c02 e os nove testes PG. O grafo foi identificado por análise estática de imports e leitura de blobs Git, sem importar o aplicativo. São 18 arquivos, 282.360 bytes e somente `pg` como pacote externo em tempo de execução. `source-preflight.json` registra caminhos, tamanhos e hashes.

A preparação inclui apenas fontes rastreadas, DDL da base e JSONs públicos. Não copia arquivos de ambiente, cookies, PDFs, estado ou segredos. `db.init` inicializará a base cumulativa somente nos schemas fictícios; portanto, o ensaio futuro fará escritas nesse banco de testes. Nenhum fluxo próprio/A1, worker, envio sem assinatura, IA, contatos ou atividade bloqueada do R16 é reproduzido aqui.

As dependências são 14 pacotes PG, 138 arquivos e 469.685 bytes, já instalados em `/mnt/dev/peticao/site/node_modules`. Versões e inventários foram comparados ao lockfile. Não copiamos o runtime de 475 MB nem instalamos pacotes. A execução futura criará um link explícito no estágio privado e verificará os arquivos antes e depois; isso é reutilização auditada, sem alegação de montagem somente leitura ou isolamento contra um usuário privilegiado.

O compilador TypeScript 5.9.3, também identificado por hash, transpilará as fontes para CommonJS sem importar o código produzido. Depois, Node 20 executará diretamente o teste compilado, usando `node:test` no mesmo processo. Não haverá `npm`, `tsx`, esbuild ou processo filho do test runner.

Root já verificou o typecheck estrito transitivo do novo teste: zero diagnósticos, 507 entradas e 17 pacotes compatíveis com o lockfile. `SOURCE-TYPECHECK-PROOF.json` aponta para a prova `92deafe6…`. Typecheck não significa que os nove testes PG passaram.

## Ensaio futuro

O perfil fixa Node 20.19.2, com hash b964…, e a imagem local PostgreSQL 17.11, com hash 665dc…. Cada tentativa terá nonce e diretório próprios.

O banco permitido é `fixture_only`, em `127.0.0.1:55496`, com usuário e senha exclusivamente fictícios. Além do endereço, os testes exigem PostgreSQL 17.11, usuário esperado, `cluster_name` igual ao nonce e diretório de dados `/var/lib/postgresql/data` dentro do contêiner. Cada caso cria um schema novo, sem apagar nomes preexistentes na admissão. A limpeza confere proprietário, comentário de identidade e nome exato.

A classe DockerPG vem do controlador aceito na revisão af2e/R13. As diferenças são somente diretório, unidade, portas e identificadores de recursos. A equivalência por AST normalizada está registrada; não alegamos igualdade de bytes nem herança dos 16 testes antigos. Três casos críticos foram executados com Docker totalmente simulado:

- Timeout na criação mantém a incerteza e impede remover a rede dependente.
- Criação, partida, identidade TCP simulada e limpeza seguem o caminho esperado.
- Identidade estrangeira é recusada, sem limpeza ampla.

O `fsync` foi substituído por um spy somente nesses testes puros. A durabilidade do controlador operacional permanece intacta. Não há retry genérico ou prune; resultados incertos exigem reconciliação manual.

A unidade proposta é `peticao-materials-pg17-qa-20261111.service`: duas CPUs, 3 GiB de RAM, 256 tarefas, limite externo de 720 segundos, prazo interno de 600 segundos e 120 segundos para encerramento. `RemainAfterExit=yes` preservará o resultado para captura antes do STOP. O contêiner PG terá limites adicionais de uma CPU, 512 MiB e tmpfs de 256 MiB. A porta 31396 permanece reservada e deve terminar fechada para preservar o contrato do controlador; nenhum servidor HTTP será iniciado.

O guard do Node exige o contexto local, ambiente de teste, e-mail dev e flags dos demais fluxos desligadas. Permite somente TCP literal para a fixture PG e resolução sintética de `127.0.0.1`. Recusa outros hosts e portas, sockets Unix, spawn, fetch, TLS, UDP e listeners. O bootstrap TCP também usa esse guard. Nenhuma credencial real será fornecida.

## Critérios para o resultado real

O resultado só poderá ser aceito com todos estes itens:

- Nove nomes exatos no TAP; nove aprovações, zero falhas, skips ou cancelamentos; processo Node com código zero.
- Nenhum schema `t_materials_*` restante e nenhum arquivo no spool de e-mail dev.
- Guard instalado no PID real do teste, sem operações negadas inesperadas.
- Fontes compiladas e dependências com inventários e hashes estáveis.
- Nenhum processo filho restante; contêiner e rede removidos; portas 55496 e 31396 fechadas.
- Resultado da unidade carregada e retida, capturado independentemente antes do STOP. Valores padrão de uma unidade já coletada não comprovam sucesso.

O TAP bruto permanecerá privado na pasta da tentativa. O recibo conterá nomes dos casos, contagens, hashes e metadados técnicos. Skips não serão apresentados como passagem dos testes PG. Não haverá atualização automática de percentuais.

## Evidência realmente observada

Foram executados 11 testes Python puros: oito do perfil e parsers, mais três do controlador com Docker simulado. Os quatro testes Node do guard usam uma VM com módulos e funções de rede simulados. As negativas não chamaram as operações subjacentes.

Uma rodada inicial da VM falhou por incompatibilidade do import de assert na montagem do próprio teste. Foi corrigida somente a opção `esModuleInterop`; a prova anterior permanece em `mock-proof/vm-prep-attempt-1*`.

O teste compilado, executado diretamente com opt-in vazio, registrou nove skips, zero aprovações e nenhum callback PG. As fontes Python e JavaScript passaram na checagem sintática. O typecheck transitivo é a prova separada emitida por Root.

**Não foram executados Docker, PostgreSQL, aplicativo HTTP, testes PG, instalação, build, merge ou deploy. Nenhuma unidade foi criada.** A preparação integrada das fontes, os nove casos reais e as provas de retenção e limpeza continuam pendentes.

## Próximo passo

Revisão independente deste freeze, seguida de revisão Root. Somente depois haverá uma ativação explícita com `infra_reviewed=true` e novo hash. Root poderá executar uma tentativa quando o recurso estiver livre e a autorização específica estiver vigente.

Se fontes ou dependências divergirem, o preflight deve falhar. Não se deve importar o aplicativo para descobrir dependências, procurar alternativas para atividades bloqueadas ou ampliar o escopo deste perfil.
