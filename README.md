# Fase B: Materiais no Next compilado real

Diretório local: `/mnt/apps/peticao-final/_ops/qa-materials-app-http-phase-b-draft-20261111`.

Este é um rascunho preparado, sem execução real e sem ativação. `infra_reviewed=false`; `runtime_manifest_sha256`, `runtime_manifest_path` e `runtime_dir` continuam ausentes. O launcher recusa essa configuração antes de criar marcador, processo, Docker, socket ou run. `CHECKPOINT.md` registra a pausa histórica anterior, já preservada no commit e0b112b53118c8c43ae796de6170c315f84d0b9d.

## Entrada obrigatória ainda pendente

Após o build da Fase A pelo Root, uma revisão própria deverá registrar os valores reais de:

- `/mnt/apps/peticao-final/_ops/qa-materials-app-http-20261111/export/release-manifest.json` e seu SHA256;
- `/mnt/apps/peticao-final/_ops/qa-materials-app-http-20261111/export/runtime`;
- fonte exata `140ce6b98af23045849335693a82b426fdc9c826`, release `materials-preview-140ce6b-local-20261111` e formato Next start.

Não há hash inventado. O runtime antigo f555 e qualquer outro caminho são recusados. A admissão verifica todo o inventário/bytes, arquivos compilados das quatro rotas Materiais e o mapa real do Next, incluindo a prévia. Não há servidor wrapper substituindo o aplicativo.

A ativação posterior exige config e manifesto novos, revisão Root e peer, lease exclusiva desta pasta e do runtime compartilhado, recurso pesado disponível e portas livres. Não executar antes disso.

## Execução planejada

O launcher é `/mnt/apps/peticao-final/_ops/qa-materials-app-http-phase-b-draft-20261111/run.py`. A unidade futura deve ser exatamente `peticao-materials-app-http-phase-b-20261111.service`, CPUQuota 200%, MemoryMax 3G, TasksMax 256, RuntimeMaxSec 720, TimeoutStopSec 120, KillMode control-group e RemainAfterExit yes. O ambiente do launcher precisará do SHA real do manifesto revisado em `MATERIALS_HTTP_REVIEWED_MANIFEST_SHA256`. Essas instruções não iniciam a unidade.

O runtime será apenas lido e fingerprintado, sem copiar novamente centenas de MB. O Node fixo é `/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node`, versão 20.19.2 e SHA `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`. Exige pelo menos 2 GiB livres para logs/fixture antes de iniciar.

O controlador PG17.11 deriva da receita já aceita, com mudanças somente de namespace, unidade, portas e nome do ambiente de manifesto. O port não é alegado byte-idêntico: a equivalência AST normalizada e 16 mocks reais do controlador portado estão registrados. `fsync` continua operacional; apenas os mocks o substituem. Timeout de create90 e qualquer resultado incerto mantêm a dependência para reconciliação manual, sem retry nem limpeza destrutiva automática.

A imagem PG local já conhecida é `sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994`. Usa bridge normal exclusiva, sem mounts de dados existentes, container read-only, tmpfs e usuário/banco fictícios. A porta de PG é `127.0.0.1:55498`; o Next escuta somente `127.0.0.1:31398`. Os limites do container PG, CPU1/Mem512M, são adicionais ao cgroup do launcher.

A fixture verifica versão 170011, cluster_name nonce, banco, caminho interno de PGDATA e TCP antes de qualquer DDL. As oito fontes DDL são blobs Git exatos pinados. Semeia apenas dois usuários fictícios edição/leitura; nenhuma versão/material/recibo é semeada. O login usa a rota real, conservando Secure/HttpOnly/SameSite Strict; o cliente HTTP de teste mantém os cookies somente em memória, sem redirecionamentos nem exportação de cabeçalhos.

O ambiente do Next é produção, sem bypass, credenciais externas ou `.env`. Diretórios de configuração vazios, MAIL dev, spool privado vazio, recipients/approver/cron vazios, WhatsApp e todos os fluxos documentais/provedores desligados. O guard limita TCP ao PG falso e listen ao loopback reservado; bloqueia DNS externo, TLS, UDP, fetch e subprocessos. Essa proteção Node não é isolamento de rede do sistema operacional.

## Prova funcional planejada

As versões serão criadas/revisadas/arquivadas pelas rotas compiladas reais, a partir de zero materiais. O protocolo verifica anônimo 401, login real dos dois níveis, escrita recusada à leitura, create v1, recuperação por pedido, CAS v2, replay v1 sem substituir head, conflito obsoleto 409, histórico, escopo de ator, archive v3, prévia histórica v1 enquanto o head já é v3, query duplicada e pares/IDs incorretos. A inspeção SQL final exige head1/versões3/recibos3/autoria correta e três auditorias materiais, sem efeitos de assinatura, documentos, envio ou mensagens.

A prévia verifica o HTML solicitado, os hashes de conteúdo e corpo, metadados de versão/head, Cache-Control, nosniff, SAMEORIGIN, no-referrer e CSP exata com o hash do CSS efetivamente retornado. Não é validação de UI/browser.

A coleta exige guard no PID real e zero violações, runtime estável, spool vazio, encerramento dos processos e do cgroup, container/rede removidos com ownership comprovado e portas fechadas. Em incerteza, o resultado é falha/dependência mantida; não repetição automática. O Root deverá capturar a unidade carregada e retida, seu InvocationID, Result e ExecMainStatus antes do STOP intencional.

## Validação desta preparação

33 testes Python puros passaram: 10 de admissão do runtime, 16 do controlador portado e sete do contrato HTTP/HTML. Quatro testes Node VM passaram para o guard, sem rede, PG ou aplicativo. A fixture recebeu somente verificação de sintaxe. Nenhum build, instalação, PostgreSQL, Next real, HTTP real, envio, assinatura, browser, merge ou deploy ocorreu nesta preparação.

Continuam pendentes o novo runtime real, revisão/ativação deste freeze e execução/aceite da bateria. Nenhum percentual funcional foi atualizado por estes mocks.
