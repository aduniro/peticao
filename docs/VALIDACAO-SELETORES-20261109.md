# Validação dos seletores — 09/11/2026

## Causa e correção

A correção anterior cobria apenas a seta. onFocus voltava ao filtro do valor selecionado, e clicar no corpo já focado não alterava o modo; por isso HC-UFG podia mostrar só uma opção. O componente central agora abre a lista completa em foco e clique, inclusive já focado. Apenas onChange por edição do texto ativa a lista filtrada. Abrir não chama onChange nem apaga a seleção.

Política: `docs/POLITICA-CENTRAL-SELETORES.md`, referenciada em AGENTS.md no candidato e no repositório central.

## Evidências aprovadas

- Build e typecheck passaram.
- API de universidades: teste isolado PostgreSQL com 55 nomes confirmou lista completa do país, deduplicação e isolamento; busca digitada mantém filtro/limite 40 anteriores.
- Backend de geografia: 5571 municípios validados em suas 27 UFs, incluindo ID IBGE; uma cidade incompatível para cada UF foi rejeitada (27 pares).
- Navegador, 10 grupos: HC-UFG selecionado e três cliques no corpo já focado mostram 48 mantendo valor; blur/reentrada/seta 48; digitação HUGV filtra 1 e reclique abre 48; teclado; toque 390px; instituições 113; campi UNIR 8; UFs 27; cidades RO 52 e AC22; Canadá 159 na navegação/40 na busca digitada e Uruguai 6 sem vazamento entre países.
- Nenhum POST de assinatura, recurso externo ou erro JavaScript nos testes de navegador.
- Captura mobile foi inspecionada: hospital permanece HC-UFG e há múltiplas opções com sigla e nome, com rolagem para as 48.

## Quantidades por UF na base local

| UF | Municípios |
|---|---:|
| AC | 22 |
| AL | 102 |
| AM | 62 |
| AP | 16 |
| BA | 417 |
| CE | 184 |
| DF | 1 |
| ES | 78 |
| GO | 246 |
| MA | 217 |
| MG | 853 |
| MS | 79 |
| MT | 142 |
| PA | 144 |
| PB | 223 |
| PE | 185 |
| PI | 224 |
| PR | 399 |
| RJ | 92 |
| RN | 167 |
| RO | 52 |
| RR | 15 |
| RS | 497 |
| SC | 295 |
| SE | 75 |
| SP | 645 |
| TO | 139 |

## Ambiente e limites

Prévia local http://127.0.0.1:3062/ . Código local da funcionalidade no commit 8b86150. Nenhum deploy, migração ou alteração dos dados da VPS. Testes extensos permanecem para etapa posterior.

Evidências privadas:

- `/mnt/apps/peticao-final/peticao/.cache/seletores-qa-20261109/uf-city-backend.json`
- `/mnt/apps/peticao-final/peticao/.cache/ebserh-flow-qa-20261109/combobox-body-click-result.json`
- `/mnt/apps/peticao-final/peticao/.cache/ebserh-flow-qa-20261109/combobox-hospital-hc-ufg-touch.png`
- `/mnt/apps/peticao-final/peticao/.cache/siglas-dominios-20261109/universities-all-tests.log`

## Pré-publicação — regressões da política institucional

Nova bateria completa sobre d7e903a:233 testes,224passaram e9falharam. Log preservado: /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109-qa/fix-fa25c04/reports/backend-1794249140958268547.log . As expectativas antigas de instituição/domínio foram alinhadas à regra MEC; nenhuma validação foi relaxada. Casos históricos de curadoria agora usam fixtures legadas diretas em banco fictício.

Corrigida regressão real em sign-flow: typo institucional mantém a sugestão e detalhe existentes somente quando a correção pertence à instituição selecionada. Continua sem cadastro/curadoria/envio; sugestão de outra instituição não encobre mismatch. Referência de campus IFSul padronizada para IFSUL.

Build completo Node20.19.2 passou após correção do fluxo. Atualização posterior apenas do teste reaproveitou o mesmo build, com prova de igualdade dos arquivos de execução. Regressão dirigida final nos7arquivos afetados:27/27,zero falhas,ignorados,cancelados. Log: /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109-qa/fix-fa25c04/reports/predeploy-policy-regression-1794250083791730311.log . Não foi alegada uma segunda rodada global233/233.

Dump consistente da produção restaurado em container PostgreSQL17semrede externa; DDL aplicada2vezes conservou todos os campos anteriores das12326assinaturas. Relatório privado /mnt/apps/peticao-final/peticao/.cache/deploy-pagina-revisada-20261109/schema-validation.json . Certificados/chaves/dados pessoais permanecem fora do Git.
