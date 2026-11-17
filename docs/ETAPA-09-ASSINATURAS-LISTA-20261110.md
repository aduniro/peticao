# Assinaturas: Lista de assinaturas

Sequência expressa do responsável: após o aceite de Dispersão, seguir para Assinaturas. Materiais de divulgação adiado. Dispersão foi aceita localmente em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/dispersao-compiled-1794314316222726427/execution.json`.

## Problemas confirmados e escopo

- CSV da Lista retornava sucesso cortando em20000 linhas; preservar11 colunas e exportar o filtro completo ou falhar explicitamente por orçamento de recursos.
- Facetas limitadas a300 sem informar omissões; devolver conjunto completo dentro do orçamento explícito.
- Linhas, contagem, mapa, facetas e totais obtidos em consultas independentes; agrupá-los na mesma fotografia REPEATABLE READ, com asOf e cobertura por resposta.
- Telefone WhatsApp decifrado disponibilizado a Leitura; contato requer Edição pela política existente. Leitura mantém a lista nominal e booleanos necessários, com telefone vazio e sem selecionar a cifra. CSV continua sem telefone/e-mail/CPF.
- Fracionários/Infinity, duplicatas e datas impossíveis não podem virar consultas aparentemente válidas. Novo parser estrito da fronteira administrativa sem substituir implicitamente o parser tolerante compartilhado.
- Cliente precisa deadline, tamanho máximo, validação de DTO e proteção contra respostas tardias/troca de usuário/sessão/nível, preservando classes/fontes/layout e consumidores de Mapas.

## Perguntas e decisões tomadas

- A pesquisa q deve continuar procurando e-mail embora a interface diga nome? Decisão: pesquisar somente nome para todos os papéis. Não criar pesquisa de contato por URL nesta entrega. Registro permite revisão posterior pelo responsável.
- Separar DTO nominal Leitura do contato? Decisão: preservar campos existentes; capabilities.contacts é derivado exclusivamente do papel atual no servidor. Linha.whatsapp vazio para Leitura; Edição+ pode consultar contato. Nunca enviar cifra ou CPF/ hashes.
- Criar serviço/job de exportação ou snapshot persistente? Decisão: leitura e exportação completas dentro de transação consistente e orçamento explícito. CSV integral conferido antes de200, com nova autorização e auditoria de preparação em transação própria. Páginas distintas possuem horários próprios; nenhuma promessa de snapshot persistente entre páginas.
- Esconder facetas antigas com cargo fora das duas opções atuais? Decisão: permitir filtros de cargos legados como texto para que toda faceta retornada continue selecionável. Isso não altera a validação do formulário público.
- Como preservar contatos após downgrade de papel? Decisão: actorScope inclui usuário, sessão e nível; os três consumidores SSR reiniciam o estado do Explorador.401/403 deve limpar resultado privado; falha de rede pode preservar o resultado anterior identificado como antigo.

## Trabalho em andamento e validação

Contrato estrito e CSV11 integrado parcialmente:5 testes puros passaram, incluindo linha20001, escaping e ausência de telefone no arquivo. Essa rodada não comprova o store, a interface ou a rota final. Dois autores trabalham em drafts isolados para backend/helper e cliente/UI; integração final, tipos, regressão PG, build e Next compilado permanecem pendentes.

Preservar Mapas e rankings que compartilham filtros/helpers, sem declarar seus módulos inteiros concluídos por esta correção. Não executar envios de mensagens, serviços de provedores, deploy, merge ou sincronização com a VPS nesta etapa.

## Integração do backend e revisão independente

- Coorte backend comum20/20, sem omitidos, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/signature-store-1794315226479526677/result.json`: helpers anteriores, rankings, filtros, CSV e novo store. Inclui50001registros/351facetas, consulta Leitura sem coluna wa_cipher, inserção concorrente com fotografia RR e preservação de todos os campos. Fontes/HEAD/runtime estáveis.
- Revisão encontrou CSV de filtro incorreto quando a faceta contém vírgula. Decisão: links novos com valores ambíguos usam marcador explícito listas=json e arrays JSON para todas as listas daquele link; links usuais continuam separados por vírgula. Sem marcador, interpretação legada preservada, inclusive valor literal["QA"]. Links antigos já ambíguos com vírgula não podem ser desambiguados automaticamente. Serializer/parser/contrato compartilham a regra; teste cobre vírgula, colchetes, quotes e consumidores legados.
- Revisão encontrou dois problemas no draft UI: parser aceitava facetas incompletas e etiqueta de página usava solicitação mesmo preservando dados anteriores. Autor está corrigindo exigência de sete facetas e exibição da página confirmada. Não declarar aceite da interface antes da coorte final.
- Nova janela de expiração durante a própria auditoria foi fechada nas exportações da Lista e Dispersão. A reautorização posterior ao INSERT deve lançar erro para rollback. Dois casosPG passaram em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/export-audit-1794315532284581291/result.json`, com NOTICEs comprovando sessão válida antes e expirada durante pg_sleep do trigger; registro/audit não é persistido e arquivo não é liberado.

Tipos globais/build/Next final ainda aguardam integração da interface.

## Interface integrada e checagem global

Três fontes de UI portadas com hashes e dependências exatas do manifesto `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/assinaturas-ui-next-draft/entrega.json`. Fixture privada usa HTTP/mapa fictícios:451facetas, filtros literais, estados de página, troca de ator e seis larguras, com família/tamanho/peso/line-height/padding/borda iguais à base. Isso não comprova Leaflet ou Next reais.

Cliente comum9/9 aprovado com fontes/HEAD/runtime estáveis em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/signature-client-1794316291537163367/result.json`. Tipos globais exit0 no conjunto integrado em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794316291443009160/result.json`, incluindo a correção pós-auditoria de ambas as exportações. Backend20/20 e auditoria2/2 são rodadas separadas, não somar como uma única suíte.

Build e Next compilado com banco/navegador continuam pendentes antes de marcar a Lista100%.

## Aceite local final da Lista

Build estável em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/build-1794316955855760675/result.json` (HEAD51c64c3). Ensaio final Next/PostgreSQL/navegador exit0 em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/signature-explorer-compiled-1794319630453412733/execution.json`, QAHEAD290ddc6, igualdade integral das fontes do build e runtime202, HEAD/fontes estáveis, portas54388/3073/3074 encerradas.

CSV HTTP e download:20001linhas/11colunas/3372594bytes/SHAe4bf223ca7ce97b3d2108b97baa9c32a9f8a550c541ad33cdf4de7c0d4a24720;351facetas; filtro literal retorna exatamente1registro; fórmulas/quotes/quebras protegidas. Reader sem contato, Editor com telefone autorizado, anônimo/expirado/origem incorreta recusados. Busca por nome não infere e-mail. Resposta perdida preserva página confirmada e retry manual repete o mesmo filtro; resposta tardia não sobrescreve nova consulta;401 limpa dados. Mapa e popup preservam filtros; seis larguras sem overflow, captura390inspecionada. Os80recursos externos bloqueados eram exclusivamente tiles de tile.openstreetmap.org: o teste comprova integração do mapa/filtros, não cartografia externa; o módulo Mapas mantém seu aceite separado.

Baseline20001registros após bootstrap somente1seq+1verify_code; campos completos das assinaturas e vínculos permanecem inalterados durante o fluxo. Auditoria encadeada válida; nenhum envio/job ou mutação de cadastro.

Falhas de QA preservadas: primeiro build foi recusado por commit em andamento (guard agora exige checkout limpo); portas3061/3062 pertenciam a outros serviços e foram preservadas; transporte local encerrou uma conexão (harness passou a usar conexões novas sem retry); timeout de navegador foi comprovadamente causado pelo próprio helper segurando qausente=null. O guard agora exige holdQuerynão-nulo. Prazos, dataset e assertivas não foram relaxados.

Lista de assinaturas aceita100% LOCAL. Não publicada. Próximo módulo: E-mails e pendentes, começando pela consulta global/paginada sem DNS em SSR.
