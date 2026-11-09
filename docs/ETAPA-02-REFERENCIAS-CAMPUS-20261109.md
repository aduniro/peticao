# Referências públicas locais de campus: primeiro backend

Escopo restrito aprovado: índice de fontes versionadas, helper puro e consulta
administrativa explícita. Não há rede, IA, serviço, esquema novo, frontend/texto,
credencial, VPS ou aplicação de cadastro/coordenada/decisãoCPF.

## Requisito original e lacuna observada

O `LOG-2026-11-04-planejamento-admin-v2.md` pede pesquisa de página oficial/lista
de campi, localização pelo IBGE, mapa e proposta para o dono aprovar. A curadoria
atual em `campus-review.ts` já grava versões humanas com prova/autor, mas valida
sintaxe e consistência local: não busca a página nem comprova que ela demonstra
um campus. O coletor de triagem usa catálogo público atual; não pesquisa fontes
externas. Faltava disponibilizar as referências de campus já preservadas no repo.

Inventário atual, conferido nesta captura: `campi-oficiais.csv` tem **837registros**,
com240referênciasURL (234HTTPS/6HTTP,19instituições) e597somenteINEPindireto.
O relatório preservado ainda menciona827 e números/cobertura anteriores às
correções finais. Não reescrever esse original nem apresentar837como atualização
oficial em tempo real. A auditoriaJSON guarda20notas de campi faltantes/novos;
alguns são anúncios/implantação e um tem funcionamento relatado historicamente.
Nenhum desses relatos vira comprovação atual ou inclusão automática.

## Implementação

`tools/data/build-campus-reference-index.py` gera deterministicamente
`contact-triage/campus-reference-index.json`, com837referências e notas separadas.
Lê exclusivamente oito arquivos públicos versionados; guarda SHA256 de cada um,
data do material2026-11-03, linha de origem, fonte literal e URL separada.
`--check` exige reprodução byte a byte, preservando o CSV e demais originais.

A autoridade do hostname é comparada à lista versionada de domínios da respectiva
IFES. URLs específicas, referências genéricas/anotadas, HTTP, fontes não
verificadas e INEPindireto têm categorias diferentes. Não há upgrade silencioso
HTTP→HTTPS, alegação de página lida agora, arquivo de conteúdo ou confirmação de
funcionamento. Todas as referências continuam com suficiência não comprovada e
revisão humana obrigatória; as URLs oficiais específicas podem fornecer apenas
os campos de entrada de uma proposta para o fluxo existente.

`campusReferenceEvidence` resolve IFES/município por chaves públicas existentes,
com filtros/paginação limitada. Expõe município, vínculo ao catálogo atual e
critérios geográficos atuais; coordenadas são explicitamente **centróides do
município**, com `campusCoordinatesKnown:false`, sem alegar localização exata do
campus ou decisão jurídica. O material original não distingue, por linha, se a
cidade foi declarada pela fonte ou inferida do nome: essa incerteza acompanha
cada referência. Notas da auditoria não geram propostas automaticamente.

`GET /api/admin/contato/campus/referencias` exige Edição, aplica as guardas
administrativas existentes, responde sem cache e aceita somente instituição,
IBGE, cursor e limite. Nenhum parâmetro de nome/CPF/e-mail/contato é consultado ou
enviado a terceiros. Não há POST de pesquisa, fetch, geocodificador remoto ou
acesso à APIdeCPF. A resposta não contém prova de aprovação e não marca fonte
como revisada. O operador ainda deve conferir a fonte e passar pela prévia/
registro atuais; o SHA da captura acompanha a consulta, mas não foi inventada
uma vinculação nova desseSHA à prova de revisão existente.

## Validação

**30/30 testes passaram**, zero falhas/cancelados/ignorados: sete regressões novas
mais curadoria/triagem existentes. Cobrem oito hashes e geração reprodutível,
busca explícita, precisão municipal, compatibilidade de todos os candidatos com
a normalização humana existente,837registros rastreáveis, fontes indiretas/
genéricas/HTTP, anúncios, paginação, parâmetros inválidos,401/403 e preservação
de assinatura com decisãoCPF, referência humana aprovada, fila e auditoria.
O testeHTTP substitui `fetch` por uma função que falha; chamadas observadas:0.
Tipos da árvore isolada passaram com código0. Não houve build ou navegador.

Execução: `/tmp/admin-campus-references-dqxj_tcn/`; cópia/checksums privados em
`.cache/qa-campus-references-20261109/`. Fontes relevantes estáveis durante a
rodada, PostgreSQL54356novo encerrado e porta liberada. NenhumDDL foi alterado.

## Próximas etapas reais

1. Integrar apresentação/mapa e controles aprovados ao fluxo de campus; esta API
   sozinha não entrega a interface nem publica proposta.
2. Atualização oficial externa, se autorizada, deverá ser ação administrativa
   explícita com URLs oficiais, DNS/IP/SSRF, limites de corpo/redirecionamento,
   timeout e fetchfake em testes; não enviar dados pessoais como consulta.
3. Arquivar conteúdo/trechos e data de coleta para melhorar a prova de fonte;
   decidir versionamento da evidência na revisão humana antes de ligá-la à prova.
4. Instituição ausente e referência sem fonte suficiente continuam casos humanos;
   não acrescentar automaticamente campus, coordenada ou instituição ao JSON.

Essas pendências não devem ser omitidas nem tratadas como pesquisa externa
integral concluída. A entrega atual reaproveita apenas fontes públicas locais e
mantém intacto o processo de decisão do dono.
