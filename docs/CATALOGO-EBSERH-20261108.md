# EBSERH / HU Brasil — catálogo local e exceção de e-mail

Pedido de08/11/2026: aceitar os domínios exatos ebserh.gov.br e hubrasil.gov.br
no formulário Servidor e pesquisar/cadastrar a rede hospitalar com geocodificação
municipal. O fluxo hospitalar no formulário fica para etapa posterior.
Sem deploy, sincronização de código ou alteração do banco da VPS.

## Entrega e escopo

Base de código: candidato isolado signup-honeypot-recovery-20261108, descendente
do snapshot equivalente à produção. Estado anterior preservado em c55f190.
Exceção EBSERH em e768c2c. Não modifica componentes visuais, CSS, traduções,
avisos de coleta ou política de privacidade. A revisão dos dois avisos de
elegibilidade para mencionar EBSERH aguarda resposta ao pedido específico.

Catálogo independente em:

`/home/barre/.local/share/peticao/catalogos/ebserh/20261108/`

- catalogo.sqlite: banco SQLite, fora do Git e separado dos bancos de assinaturas.
- catalogo.sql: dump com esquema e dados; restauração conferida.
- catalogo.csv: todos os58 registros, município, UF, IBGE, latitude/longitude,
  relação com complexo, situação, fonte, observação e data de referência.
- hospitais.geojson:47 hospitais, pronto para futura camada municipal no mapa.
- catalogo.html: tabela pesquisável com fontes, sem servidor ou API.
- manifest.json: SHA-256 das entradas e de cada saída.

Fonte versionada: data/ebserh/unidades-20261108.json. Gerador:
`python3 tools/catalogos/ebserh.py --output DIRETORIO_NOVO`.
O gerador recusa sobrescrever uma entrega existente; não abre conexões de rede
nem bancos da plataforma. Dados e decisões de revisão não são importados.

## Resultado da pesquisa

O comunicado oficial de06/11/2026 informa47 hospitais. O diretório atual contém
42 portais de unidades/gestões: Norte5, Nordeste16, Centro-Oeste6, Sudeste10 e
Sul5. Os quatro complexos UFPA, UFC, UFRJ e UFPR agrupam nove hospitais:
substituir esses quatro pais por seus nove componentes resulta em47, sem
duplicação. A base registra os pais, mas não os conta novamente como hospital.

Os47 hospitais se distribuem por39 municípios e25 UFs. As unidades físicas do
HU-UFMA (Presidente Dutra/Materno Infantil) e os dois locais do HUSE-Unirio
(HUGG/antigo HFSE) são registros subordinados informativos; não acrescentam
quatro hospitais ao total.

Incluídos15 portais ausentes da lista recebida: CH-UFRJ, HC-UFMG, HC-UFTM,
HC-UFU, Huap-UFF, Hucam-Ufes, HUSE-Unirio, HU-UFJF, HU-UFSCar, HU-UFSJ,
CHC-UFPR, HE-UFPel, HU-Furg, HUSM-UFSM e HU-UFSC. Seus componentes também
constam em registros próprios, associados ao complexo.

Correções/pendências preservadas:

- Januário Cicco: sigla oficial MEJC-UFRN; lista recebida dizia MEAM-UFRN.
- HU-UFSJ: município Divinópolis/MG; não usar São João del-Rei apenas pelo nome
  da universidade.
- HU-UFCA: projeto em construção, com contrato confirmado e notícia de obra
  em setembro/2026. Não contado como hospital operacional da rede.
- HU-UFSB/Itabuna: não confirmado no diretório nem nas buscas oficiais atuais.
  Preservado como indicação do usuário, sem promover a membro da rede. O ponto
  municipal de Itabuna NÃO prova existência, adesão ou endereço hospitalar.
- Rehuf é programa de apoio mais amplo: participar do Rehuf não prova gestão
  EBSERH. Não inserir todos os hospitais federais automaticamente.

## Geocodificação

Junção exata município+UF com site/public/data/municipios.json; códigos IBGE
de sete dígitos. Pontos de site/public/data/geo/municipios-centroides.json,
gerados por tools/geo/build.sh com ST_PointOnSurface sobre a malha IBGE2024.
São pontos interiores do MUNICÍPIO, não coordenadas da sede urbana ou do prédio.
Longitude/latitude em ordem GeoJSON; latitude/longitude em colunas distintas SQL.
Prefixo IBGE/UF e limites brasileiros validados; hashes das entradas no manifesto.
Para mapa por cidade, agrupar pela view mapa_municipios, nunca pelo nome da
universidade. Não há ainda ligação de assinaturas ou alteração do mapa do app.

## Validação

- Cumulativa do app:198/198, zero falhas/ignorados, all-ebserh.log.
- Após acrescentar o contrato explícito da guarda de e-mail governamental:
  regressão dirigida34/34, incluindo preflight, signup, CPF/identidade, antirrobô,
  IFES/EBSERH/UCPel, duplicidades e paridade de traduções.
- Build de produção aprovado, incluindo verificação de tipos.
- Cinco cenários reais de navegador390px aprovados: os dois domínios EBSERH
  no endpoint real do campo, recusa UCPel como Servidor, correção de campus,
  tentativa/identidade Apoiador e estrangeiro. Nenhuma chamada paga de CPF ou
  entrega externa; provedores fictícios e transporte dev.
- Dois testes de catálogo: integridade/FKs,47 hospitais/25 UFs, cidades e
  pendências, soma do mapa, restauração SQL idêntica, GeoJSON e checksums,
  recusa de sobrescrita e de município/coordenadas inválidos.
- Navegador da tabela local:58 linhas e filtros Divinópolis/não confirmado;
  captura1440px conferida.
- Primeiro ensaio adicional esperava sucesso final de signup com .gov.br em QA
  e encontrou a guarda preexistente mail_blocked. Corrigida a expectativa do
  teste para preservar essa guarda, não a proteção do aplicativo. Primeiro
  renderizador usou Node18 incompatível; repetido com runtime Node24 e aprovado.

Evidências locais: /home/barre/.cache/peticao-honeypot-qa-20261108/ e
/mnt/dev/peticao/.cache/ebserh-catalogo-20261108/. Aplicação/banco em produção e
prévia3031 preservados. Na prévia, e-mails .gov.br continuam sujeitos à trava
de envio de teste; elegibilidade não autoriza remover essa proteção.

## Fontes oficiais consultadas

- Diretório atual e os42 portais regionais vinculados:
  https://www.gov.br/hubrasil/pt-br/hospitais-universitarios
- Rede atual47 hospitais,06/11/2026:
  https://www.gov.br/hubrasil/pt-br/comunicacao/noticias/rede-hu-brasil-realiza-terceiro-mutirao-nacional-de-2026-com-previsao-de-quase-50-mil-procedimentos-2
- Uso dos dois domínios, página de Comunicação atualizada21/07/2026:
  https://www.gov.br/hubrasil/pt-br/comunicacao/atendimento
- Estrutura dos complexos, RAINT2025:
  https://www.gov.br/hubrasil/pt-br/acesso-a-informacao/auditorias/relatorio-anual-de-atividades-da-auditoria/raint_2025_assinado.pdf
- Componentes UFRJ:
  https://www.gov.br/hubrasil/pt-br/hospitais-universitarios/contratos-de-gestao/regiao-sudeste/ch-ufrj/contrato-de-gestao-especial-no-02-2024-firmado-entre-a-universidade-federal-do-rio-de-janeiro-ufrj-e-a-ebserh
- HU-UFSJ:
  https://www.gov.br/hubrasil/pt-br/hospitais-universitarios/regiao-sudeste/hu-ufsj/acesso-a-informacao/institucional/sobre
- HU-UFCA:
  https://www.gov.br/hubrasil/pt-br/comunicacao/noticias/representantes-da-hu-brasil-ufca-e-sesa-visitam-obras-do-hospital-universitario-em-juazeiro-do-norte-ce
- HUSE e integração HUGG/HFSE:
  https://www.gov.br/saude/pt-br/composicao/saes/dgh/hfse/hfse/
- Pontos municipais: base IBGE2024 e gerador versionado tools/geo/build.sh.
