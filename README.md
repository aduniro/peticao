# Perfis reais — preparação isolada, não qualificada

Fonte de apoio do coordenador Infra, em:
`/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-v2-20261115/source`.

Não modifica aplicação, produção, banco de assinaturas, autoridade/fila, autenticação,
serviços ou infraestrutura contratada. Não instala o driver nem executa a aplicação.
A fonte é candidata; disponibilidade de arquivos e testes locais não habilitam um nó.

## Contrato

Três nomes fechados: `admin-typecheck-v1`, `admin-build-v1`, `admin-qa-v1`.
Programa futuro fixo `/opt/peticao-dev-profile-tools-v1/driver.py`, interpretador
`/opt/peticao-dev-profile-tools-v1/python312/bin/python3.12`, flags `-I -S -B`.
O descriptor tem 12 campos; `profile_sha256` sela o descriptor inteiro, não o plano.
A interface é compatível com o runtime V5 da Infra, commit
`33fcce1bd0206e9d03baf3c696bb692ab0336f0a`, apenas como revisão de fonte.

`driver.py` é um template com hashes nulos: recusa execução. O produtor offline
`freeze_driver.py` exige template público revisado, política pública integralmente
pinada, fechamento verificado e evento positivo de liberação para qualificação
isolada. Produz arquivos novos e exclusivos sob `/mnt/apps/peticao-final`; não
instala, não liga serviços e mantém todos os catálogos `qualified=false` e
`operationalReady=false`. O broker exige ainda qualificação nativa independente
por descriptor e boot. Não há comando de instalação pronto nesta fase.

O bootstrap valida o verificador e a política antes de carregar código do projeto;
carrega os bytes já verificados dos oito helpers. Inventários de ferramentas e QA
precisam ser completos. Python é isolado, sem site automático; wheels são conferidos
antes da inclusão explícita no caminho. Todos os links da árvore pública de
ferramentas devem ser materializados pelo produtor. Bibliotecas do SO externo são
parte da base confiável e não estão cobertas pelo inventário do prefixo.

## Execução planejada

Cada trabalho usa um StateDirectory novo, usuário dinâmico sem capacidades, rede
privada do runtime e diretórios relativos próprios. A inicialização e as fases são
exclusivas; estados parciais são preservados e não são reiniciados no mesmo trabalho.
Fonte e dependências são verificadas antes das escritas mutáveis e extraídas em
árvores novas. O normalizador offline aceita somente o hardlink exato já observado,
materializa seu conteúdo e registra origem, inventário e novo hash. Nunca altera o
arquivo original nem promove o cache original a integralmente validado.

Ordem: verificação → ativos offline → TypeScript; build e exportação própria quando
necessários; QA100 somente sobre a exportação nova do mesmo trabalho; drenagem.
QA100 = 43 backend + 7 HTTP + 40 browser + 2 mapas + 8 HTTP após reset, com renovação
da fixture e parada dos processos próprios. Mapas não comprovam serviços externos
nem tiles/geocoding reais. PostgreSQL usa TCP local, sem sockets Unix nem dados reais.

O Supervisor acompanha apenas filhos diretos por pidfd/identidade; não comprova
netos parados, cgroup vazio, custódia ou aposentadoria. O supervisor Node de QA para
explicitamente seus estágios, app e PostgreSQL; parada forçada/erro falha a fase.
O runtime Root continua responsável pela prova independente de stop/cgroup,
custódia, exportação e aposentadoria. Nenhuma dessas provas é inventada pelo driver.

Ambiente reconstruído por fase, dados fictícios, entrega de e-mail de desenvolvimento,
WhatsApp/cron desabilitados, configuração vazia e sem dotenv real. Build verifica
recibo positivo de instalação do guard e recusa qualquer negativa de rede.

## Saídas

Sete nomes permitidos em `artifacts/`, máximo 16 MiB por arquivo e 32 MiB total.
JSONs usam schemas exatos; logs exportados são construídos a partir de nomes/estados
das fases. Logs brutos, fontes, DB, outbox e estado do navegador ficam privados e
não são exportados. `result.json`, privado e durável na raiz do trabalho, possui
somente `protocol`, `profile`, `exit_code` para o contrato WorkerRPC; não integra os
sete artefatos. Root relaciona esse código ao término observado da unidade.

O exportador Root V5 confere estrutura/tipo/links/limites após stop/cgroup. Não
certifica a semântica por si só; o driver selado valida schemas antes de publicar.

## Recursos e limites pendentes

Planos fechados: 4 CPU / 8 GiB / heap 3072 MiB; ou 14 CPU / 20 GiB / heap 6144 MiB.
Reserva-alvo de controle: 2 CPU / 8 GiB. O nó observado possui aproximadamente
29,9 GiB reais, portanto 24+8 GiB não cabem. A escolha de 20 GiB é candidata,
não mínimo medido. Admissão precisa verificar capacidade e pressão frescas.
Orçamento de disco de 30 GiB não é quota de disco nem garantia de reserva.

Permanecem necessários: execução autorizada do normalizador real em staging
controlado por Root; inventário completo e imutável de dependências/Python/stdlib/
PG/bibliotecas/Chromium/wheels/PDFJS; manifestação da integridade integral;
manifesto nativo específico; orçamento IPC qualificado. Os hashes de binários
Python/Chrome observados por RO719 não qualificam suas árvores ou o cache de origem.

A previsão estática dos caminhos atuais do StateDirectory excede 108 bytes para o
caminho conservador de IPC do Chromium. O gate recusa QA antes de lançar filhos.
Nenhum alias ou bind foi instalado ou executado; a qualificação pertence à Infra.
A aceitação em fonte do alias candidato está descrita na seção Sucessor V2.
A evidência está em
`/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/IPC-PATH-FORECAST.json`.

## Validação local

Testes são fictícios, com árvores privadas sob
`/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp`.
Somente testes do Supervisor usam processos Python triviais locais; helpers Node
são verificados quanto a sintaxe/importação sem iniciar cargas. Não houve execução
real de app, PostgreSQL, Chromium, systemd, Node de produção ou instalação de pacotes.
Consulte `TEST-RESULT.json` e o manifesto final para contagem e versão exatas.

## Sucessor V2: alias de trabalho aprovado pela Infra

A fonte V1, commit `32cce868127cb586cf5d314e429f0c3abbf0b6a5` / aviso 3303,
permanece intacta. Esta variante admite também o caminho fixo
`/run/peticao-dev-work`, além dos StateDirectory legados. O driver não cria,
monta, altera owner ou escolhe livremente esse caminho. A Infra decidiu fornecer
um `/run` privado da unidade e vincular o MESMO inode/backing do StateDirectory
físico no projeto. Essa implementação e sua prova nativa pertencem a um sucessor
do runtime; V5 e seus resultados anteriores não são alterados ou promovidos.

A previsão estática com o alias é 94 bytes para TMP e 67 para HOME, abaixo de 108.
Isso comprova somente o cálculo de tamanho, não o comportamento nativo do Chromium,
a ordem/idmap de mounts, a privacidade de `/run`, a identidade do backing, a custódia
ou uma qualificação. Os paths de ambiente continuam relativos; os mesmos gates de
integridade e execução desabilitada permanecem. O driver não aceita um caminho de
trabalho via argumentos ou ambiente do job. A revisão e os testes específicos
estão em `NAMESPACE-ALIAS-REVIEW.md` e `TEST-RESULT-V2.json` neste diretório absoluto.
