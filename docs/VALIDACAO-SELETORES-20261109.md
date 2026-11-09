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
