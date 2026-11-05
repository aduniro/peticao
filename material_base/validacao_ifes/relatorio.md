# Validação de IFES com campi em Amazônia Legal / Faixa de Fronteira

Gerado em 2026-11-03. Dados: ver seção Fontes. Arquivos: `campi-oficiais.csv`, `ifes-validado.json`, `dist_fronteira.json`, `scripts/`.

## 1. Fontes realmente usadas e limitações

| Fonte | Uso | Status |
|---|---|---|
| IBGE malha municipal 2024 (`geoftp.ibge.gov.br/.../municipio_2024/Brasil/BR_Municipios_2024.zip`, `BR_Pais_2024.zip`) | geometria municipal e contorno do Brasil | baixado e usado (shapefile) |
| Natural Earth 10m admin-0 countries (`naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip`) | países vizinhos para isolar fronteira terrestre (contorno IBGE do Brasil que está a ≤8 km de vizinho; descarta a costa) | baixado e usado; NÃO é fonte oficial brasileira |
| `regiao.json` (IBGE 2024: AL e FF) | lista de referência | usada |
| Páginas de campi de IFAC, IFAP, IFPA, IFMT, IFRO, IFTO, IFMA, IFPR, IFSC, IFSul, IFFarroupilha, IFMS, UTFPR, UFMS, UFSM, UFFS (sites .edu.br) | lista oficial de campi (consultadas por WebFetch em 2026-11-03; município inferido do nome do campus, exceto onde a página o declara) | usada (ver CSV, coluna fonte_url) |
| UNIPAMPA | 10 campi confirmados em documentos oficiais (PDI/relatórios, via busca) e coerentes com INEP | usada, URL genérica |
| INEP Censo da Educação Superior (já em `ifes.json`) | campi/municípios de oferta de cursos de graduação (cobre as 121 instituições) | usada indiretamente; microdados NÃO foram baixáveis (`download.inep.gov.br` sem conexão/timeout a partir deste ambiente) |

**Não obtidos (bloqueio do servidor, não contornado):** `dadosabertos.mec.gov.br` (HTTP 403), `gov.br/mec` (429/captcha), e-MEC (403), PNP (`pnp.mec.gov.br` 403), `dados.gov.br` (portal só JavaScript / API 401), IFC e IFRS (Radware/erro), IFAM (403), IFRR (conexão recusada), UFPR (certificado inválido), CEFET-MG/Colégio Pedro II (sem conexão). Para essas instituições (e todas as universidades não listadas acima) a cobertura de campi é só a do INEP/`ifes.json`.

IMPORTANTE: o INEP só registra campi com oferta de **educação superior**. Campi apenas de ensino técnico/médio dos IFs ficam de fora do `ifes.json` (por isso as páginas oficiais dos IFs trazem mais campi).

## 2. Geocodificação / validação

**Faixa de fronteira.** Distância calculada (SIRGAS 2000 / Polyconic, EPSG:5880) do polígono de cada município (5.573 feições da malha IBGE 2024) à fronteira terrestre (~15.440 km extraídos). Critério: distância ≤150 km (polígono intersecta a faixa).
- Geometria dá 589 feições ≤150 km; lista IBGE `ff` tem 588. Divergências (3):
  - "Área Operacional Lagoa Mirim" (RS) e "Área Operacional Lagoa dos Patos" (RS): feições da malha que NÃO são municípios (ausentes de `municipios.json`); ignorar.
  - Governador Jorge Teixeira/RO: na lista IBGE `ff`, mas a 151,8 km pelo meu cálculo (margem de erro da fronteira derivada ~ poucos km; considerar correto conforme IBGE).
- Conclusão: lista `ff` de `regiao.json` é consistente com a geometria oficial do IBGE (588/588 municípios reais conferem a ≤150 km, um deles marginal).

**Amazônia Legal (LC 124/2007).** `al` tem 773 municípios: todos os municípios de AC, AP, AM, MT, PA, RO, RR, TO (totais por UF conferem com `municipios.json`: 22, 16, 62, 142, 144, 52, 15, 139) + 181 do MA. Para o MA, calculei os municípios cuja geometria intersecta o território a oeste do meridiano 44°W: 181, **idênticos** aos 181 de `al`. Sem divergências.

**Todos os campi do CSV** (827 linhas) têm código IBGE existente em `municipios.json` (casamento por nome+UF; ambíguos: nenhum; sem casamento: apenas "Santo Antônio do Leverger" -> grafia IBGE é "Santo Antônio de Leverger", corrigido). Linhas em AL ou FF: 255.

**Atenção jurídica:** o PLV (art., §2º) lista critérios I (fronteira), II (Amazônia Legal) e III (dificuldade de fixação de efetivo); a classificação "AL ou FF" aqui é um pré-filtro geográfico. Se a exigência for cumulativa (AL **e** FF), a coluna "AL∩FF" abaixo é a que vale; a relação final de municípios depende de ato do MGI.

## 3. Instituições elegíveis (sede ou algum campus em AL/FF) — 40 de 121

Legenda: AL = só Amazônia Legal; FF = só faixa de fronteira; AL+FF = ambos. Campi de fonte "oficial" = página .edu.br; senão INEP.

| Sigla | Tipo | Sede (UF) | Sede em região | Nº campi total | Campi em região | Fonte campi |
|---|---|---|---|---|---|---|
| FURG | U | RS | FF | 4 | 3: Rio Grande/RS [FF]; Santa Vitória do Palmar/RS [FF]; São Lourenço do Sul/RS [FF] | INEP |
| UFAC | U | AC | AL+FF | 3 | 3: Brasiléia/AC [AL+FF]; Cruzeiro do Sul/AC [AL+FF]; Rio Branco/AC [AL+FF] | INEP |
| UFAM | U | AM | AL | 6 | 6: Benjamin Constant/AM [AL+FF]; Coari/AM [AL]; Humaitá/AM [AL]; Itacoatiara/AM [AL]; Manaus/AM [AL]; Parintins/AM [AL] | INEP |
| UFFS | U | SC | FF | 6 | 5: Laranjeiras do Sul/PR [FF]; Realeza/PR [FF]; Chapecó/SC [FF]; Cerro Largo/RS [FF]; Erechim/RS [FF] | oficial+INEP |
| UFGD | U | MS | FF | 1 | 1: Dourados/MS [FF] | INEP |
| UFMA | U | MA | AL | 9 | 7: Bacabal/MA [AL]; Balsas/MA [AL]; Codó/MA [AL]; Grajaú/MA [AL]; Imperatriz/MA [AL]; Pinheiro/MA [AL]; São Luís/MA [AL] | INEP |
| UFMS | U | MS | não | 10 | 4: Aquidauana/MS [FF]; Corumbá/MS [FF]; Naviraí/MS [FF]; Ponta Porã/MS [FF] | oficial+INEP |
| UFMT | U | MT | AL | 5 | 5: Barra do Garças/MT [AL]; Cuiabá/MT [AL]; Pontal do Araguaia/MT [AL]; Sinop/MT [AL]; Várzea Grande/MT [AL] | INEP |
| UFNT | U | TO | AL | 2 | 2: Araguaína/TO [AL]; Tocantinópolis/TO [AL] | INEP |
| UFOPA | U | PA | AL | 7 | 7: Alenquer/PA [AL+FF]; Itaituba/PA [AL]; Juruti/PA [AL]; Monte Alegre/PA [AL]; Óbidos/PA [AL+FF]; Oriximiná/PA [AL+FF]; Santarém/PA [AL] | INEP |
| UFPA | U | PA | AL | 11 | 11: Abaetetuba/PA [AL]; Altamira/PA [AL]; Ananindeua/PA [AL]; Belém/PA [AL]; Bragança/PA [AL]; Breves/PA [AL]; Cametá/PA [AL]; Castanhal/PA [AL]; Salinópolis/PA [AL]; Soure/PA [AL]; Tucuruí/PA [AL] | INEP |
| UFPEL | U | RS | FF | 3 | 2: Capão do Leão/RS [FF]; Pelotas/RS [FF] | INEP |
| UFPR | U | PR | não | 6 | 2: Palotina/PR [FF]; Toledo/PR [FF] | INEP |
| UFR | U | MT | AL | 1 | 1: Rondonópolis/MT [AL] | INEP |
| UFRA | U | PA | AL | 6 | 6: Belém/PA [AL]; Capanema/PA [AL]; Capitão Poço/PA [AL]; Paragominas/PA [AL]; Parauapebas/PA [AL]; Tomé-Açu/PA [AL] | INEP |
| UFRR | U | RR | AL+FF | 1 | 1: Boa Vista/RR [AL+FF] | INEP |
| UFSM | U | RS | não | 4 | 2: Frederico Westphalen/RS [FF]; Palmeira das Missões/RS [FF] | oficial+INEP |
| UFT | U | TO | AL | 5 | 5: Arraias/TO [AL]; Gurupi/TO [AL]; Miracema do Tocantins/TO [AL]; Porto Nacional/TO [AL]; Palmas/TO [AL] | INEP |
| UNIFAP | U | AP | AL | 4 | 4: Macapá/AP [AL]; Mazagão/AP [AL]; Oiapoque/AP [AL+FF]; Santana/AP [AL] | INEP |
| UNIFESSPA | U | PA | AL | 5 | 5: Marabá/PA [AL]; Rondon do Pará/PA [AL]; Santana do Araguaia/PA [AL]; São Félix do Xingu/PA [AL]; Xinguara/PA [AL] | INEP |
| UNILA | U | PR | FF | 1 | 1: Foz do Iguaçu/PR [FF] | INEP |
| UNIPAMPA | U | RS | FF | 10 | 10: Alegrete/RS [FF]; Bagé/RS [FF]; Caçapava do Sul/RS [FF]; Dom Pedrito/RS [FF]; Itaqui/RS [FF]; Jaguarão/RS [FF]; Sant'Ana do Livramento/RS [FF]; São Borja/RS [FF]; São Gabriel/RS [FF]; Uruguaiana/RS [FF] | oficial+INEP |
| UNIR | U | RO | AL+FF | 8 | 8: Ariquemes/RO [AL]; Cacoal/RO [AL]; Guajará-Mirim/RO [AL+FF]; Ji-Paraná/RO [AL]; Porto Velho/RO [AL+FF]; Presidente Médici/RO [AL]; Rolim de Moura/RO [AL+FF]; Vilhena/RO [AL+FF] | INEP |
| UTFPR | U | PR | não | 13 | 6: Dois Vizinhos/PR [FF]; Francisco Beltrão/PR [FF]; Medianeira/PR [FF]; Pato Branco/PR [FF]; Santa Helena/PR [FF]; Toledo/PR [FF] | oficial+INEP |
| IF Catarinense | IF | SC | não | 15 | 2: Abelardo Luz/SC [FF]; Concórdia/SC [FF] | INEP |
| IFAC | IF | AC | AL+FF | 5 | 5: Cruzeiro do Sul/AC [AL+FF]; Rio Branco/AC [AL+FF]; Sena Madureira/AC [AL+FF]; Tarauacá/AC [AL+FF]; Xapuri/AC [AL+FF] | oficial+INEP |
| IFAM | IF | AM | AL | 6 | 6: Coari/AM [AL]; Itacoatiara/AM [AL]; Manaus/AM [AL]; Maués/AM [AL]; Parintins/AM [AL]; Presidente Figueiredo/AM [AL] | INEP |
| IFAP | IF | AP | AL | 8 | 8: Pedra Branca do Amapari/AP [AL+FF]; Laranjal do Jari/AP [AL+FF]; Macapá/AP [AL]; Mazagão/AP [AL]; Oiapoque/AP [AL+FF]; Porto Grande/AP [AL]; Santana/AP [AL]; Tartarugalzinho/AP [AL] | oficial+INEP |
| IFFarroupilha | IF | RS | não | 16 | 14: Alegrete/RS [FF]; Caçapava do Sul/RS [FF]; Frederico Westphalen/RS [FF]; Jaguari/RS [FF]; Panambi/RS [FF]; Santa Rosa/RS [FF]; Santiago/RS [FF]; Santo Ângelo/RS [FF]; Santo Augusto/RS [FF]; São Borja/RS [FF]; São Gabriel/RS [FF]; São Luiz Gonzaga/RS [FF]; São Vicente do Sul/RS [FF]; Uruguaiana/RS [FF] | oficial+INEP |
| IFMA | IF | MA | AL | 27 | 21: Açailândia/MA [AL]; Alcântara/MA [AL]; Bacabal/MA [AL]; Barra do Corda/MA [AL]; Buriticupu/MA [AL]; Carolina/MA [AL]; Codó/MA [AL]; Grajaú/MA [AL]; Imperatriz/MA [AL]; Itapecuru Mirim/MA [AL]; Pedreiras/MA [AL]; Pinheiro/MA [AL]; Porto Franco/MA [AL]; Presidente Dutra/MA [AL]; Rosário/MA [AL]; Santa Inês/MA [AL]; São José de Ribamar/MA [AL]; São Luís/MA [AL]; São Raimundo das Mangabeiras/MA [AL]; Viana/MA [AL]; Zé Doca/MA [AL] | oficial+INEP |
| IFMS | IF | MS | não | 12 | 7: Amambai/MS [FF]; Aquidauana/MS [FF]; Corumbá/MS [FF]; Dourados/MS [FF]; Jardim/MS [FF]; Naviraí/MS [FF]; Ponta Porã/MS [FF] | oficial+INEP |
| IFMT | IF | MT | AL | 20 | 20: Alta Floresta/MT [AL]; Barra do Garças/MT [AL]; Cáceres/MT [AL+FF]; Campo Novo do Parecis/MT [AL]; Campo Verde/MT [AL]; Confresa/MT [AL]; Cuiabá/MT [AL]; Diamantino/MT [AL]; Guarantã do Norte/MT [AL]; Jaciara/MT [AL]; Juína/MT [AL]; Lucas do Rio Verde/MT [AL]; Pontes e Lacerda/MT [AL+FF]; Primavera do Leste/MT [AL]; Rondonópolis/MT [AL]; Santo Antônio de Leverger/MT [AL]; Sinop/MT [AL]; Sorriso/MT [AL]; Tangará da Serra/MT [AL+FF]; Várzea Grande/MT [AL] | oficial+INEP |
| IFPA | IF | PA | AL | 17 | 17: Abaetetuba/PA [AL]; Altamira/PA [AL]; Ananindeua/PA [AL]; Belém/PA [AL]; Bragança/PA [AL]; Breves/PA [AL]; Cametá/PA [AL]; Castanhal/PA [AL]; Conceição do Araguaia/PA [AL]; Itaituba/PA [AL]; Marabá/PA [AL]; Óbidos/PA [AL+FF]; Paragominas/PA [AL]; Parauapebas/PA [AL]; Santarém/PA [AL]; Tucuruí/PA [AL]; Vigia/PA [AL] | oficial+INEP |
| IFPR | IF | PR | não | 28 | 11: Assis Chateaubriand/PR [FF]; Barracão/PR [FF]; Capanema/PR [FF]; Cascavel/PR [FF]; Coronel Vivida/PR [FF]; Foz do Iguaçu/PR [FF]; Goioerê/PR [FF]; Palmas/PR [FF]; Quedas do Iguaçu/PR [FF]; Toledo/PR [FF]; Umuarama/PR [FF] | oficial+INEP |
| IFRO | IF | RO | AL+FF | 10 | 10: Ariquemes/RO [AL]; Cacoal/RO [AL]; Colorado do Oeste/RO [AL+FF]; Guajará-Mirim/RO [AL+FF]; Jaru/RO [AL]; Ji-Paraná/RO [AL]; Porto Velho/RO [AL+FF]; Vilhena/RO [AL+FF]; São Miguel do Guaporé/RO [AL+FF]; Buritis/RO [AL+FF] | oficial+INEP |
| IFRR | IF | RR | AL+FF | 3 | 3: Amajari/RR [AL+FF]; Boa Vista/RR [AL+FF]; Caracaraí/RR [AL+FF] | INEP |
| IFRS | IF | RS | não | 16 | 3: Erechim/RS [FF]; Rio Grande/RS [FF]; Sertão/RS [FF] | INEP |
| IFSC | IF | SC | não | 21 | 5: Chapecó/SC [FF]; São Carlos/SC [FF]; São Lourenço do Oeste/SC [FF]; São Miguel do Oeste/SC [FF]; Xanxerê/SC [FF] | oficial+INEP |
| IFSul | IF | RS | FF | 13 | 4: Bagé/RS [FF]; Jaguarão/RS [FF]; Pelotas/RS [FF]; Sant'Ana do Livramento/RS [FF] | oficial+INEP |
| IFTO | IF | TO | AL | 12 | 12: Araguaína/TO [AL]; Araguatins/TO [AL]; Colinas do Tocantins/TO [AL]; Dianópolis/TO [AL]; Formoso do Araguaia/TO [AL]; Gurupi/TO [AL]; Lagoa da Confusão/TO [AL]; Paraíso do Tocantins/TO [AL]; Pedro Afonso/TO [AL]; Porto Nacional/TO [AL]; Palmas/TO [AL]; Tocantinópolis/TO [AL] | oficial+INEP |

## 4. Instituições INELEGÍVEIS (nenhum campus/sede em AL ou FF) — 81

UFABC, UFAL, UFAPE, UFBA, UFC, UFCA, UFCAT, UFCG, UFCSPA, UFDPAR, UFERSA, UFES, UFF, UFG, UFJ, UFJF, UFLA, UFMG, UFOB, UFOP, UFPB, UFPE, UFPI, UFRB, UFRGS, UFRJ, UFRN, UFRPE, UFRRJ, UFS, UFSB, UFSC, UFSCAR, UFSJ, UFTM, UFU, UFV, UFVJM, UNB, UNIFAL-MG, UNIFEI, UNIFESP, UNILAB, UNIRIO, UNIVASF, AMAN, CEFET/MG, CEFET/RJ, CIAvEx, CP II, ENCE, ESA, EsEFEx, EsSLog, FACS - GHC, IF Fluminense, IF Goiano, IF SERTÃO-PE, IF SUL DE MINAS, IFAL, IFB, IFBA, IFBAIANO, IFCE, IFES, IFG, IFMG, IFNMG, IFPB, IFPE, IFPI, IFRJ, IFRN, IFS, IFSEMG, IFSP, IFTM, IME, INES, ISCP, ITA

Observação: AMAN, ITA, IME etc. (tipo O) são instituições militares/outras presentes no Censo INEP; não são IFES na acepção de universidades/IFs/CEFETs. Nenhuma está em AL/FF.

## 5. Divergências em relação a `ifes.json`

### (a) Campi em fonte oficial AUSENTES de `ifes.json` (acrescentados em `ifes-validado.json`)

| Instituição | Campus | Município/UF | IBGE | Região |
|---|---|---|---|---|
| IFAP | Pedra Branca do Amapari | Pedra Branca do Amapari/AP | 1600154 | AL+FF |
| IFAP | Tartarugalzinho | Tartarugalzinho/AP | 1600709 | AL |
| IFAP | Mazagão | Mazagão/AP | 1600402 | AL |
| IFFarroupilha | Caçapava do Sul | Caçapava do Sul/RS | 4302808 | FF |
| IFFarroupilha | São Gabriel | São Gabriel/RS | 4318309 | FF |
| IFFarroupilha | Santiago | Santiago/RS | 4317400 | FF |
| IFFarroupilha | São Luiz Gonzaga | São Luiz Gonzaga/RS | 4318903 | FF |
| IFFarroupilha | Uruguaiana | Uruguaiana/RS | 4322400 | FF |
| IFMA | Araioses | Araioses/MA | 2100907 | - |
| IFMA | Carolina | Carolina/MA | 2102804 | AL |
| IFMA | Grajaú | Grajaú/MA | 2104800 | AL |
| IFMA | Itapecuru Mirim | Itapecuru Mirim/MA | 2105401 | AL |
| IFMA | Presidente Dutra | Presidente Dutra/MA | 2109106 | AL |
| IFMA | Porto Franco | Porto Franco/MA | 2109007 | AL |
| IFMA | Rosário | Rosário/MA | 2109601 | AL |
| IFMA | Viana | Viana/MA | 2112803 | AL |
| IFMS | Amambai | Amambai/MS | 5000609 | FF |
| IFMS | Paranaíba | Paranaíba/MS | 5006309 | - |
| IFMT | Sinop | Sinop/MT | 5107909 | AL |
| IFPA | Cametá | Cametá/PA | 1502103 | AL |
| IFPA | Vigia | Vigia/PA | 1508209 | AL |
| IFPR | Arapongas | Arapongas/PR | 4101507 | - |
| IFPR | Astorga | Astorga/PR | 4102109 | - |
| IFPR | Barracão | Barracão/PR | 4102604 | FF |
| IFPR | Coronel Vivida | Coronel Vivida/PR | 4106506 | FF |
| IFPR | Goioerê | Goioerê/PR | 4108601 | FF |
| IFPR | Ponta Grossa | Ponta Grossa/PR | 4119905 | - |
| IFPR | Quedas do Iguaçu | Quedas do Iguaçu/PR | 4120903 | FF |
| IFPR | Toledo | Toledo/PR | 4127700 | FF |
| IFRO | Buritis | Buritis/RO | 1100452 | AL+FF |
| IFSC | São Lourenço do Oeste | São Lourenço do Oeste/SC | 4216909 | FF |
| IFSC | Tijucas | Tijucas/SC | 4218004 | - |
| IFSul | Jaguarão | Jaguarão/RS | 4311007 | FF |
| IFSul | Novo Hamburgo | Novo Hamburgo/RS | 4313409 | - |
| IFSul | Sapiranga | Sapiranga/RS | 4319901 | - |
| IFTO | Formoso do Araguaia | Formoso do Araguaia/TO | 1708205 | AL |
| IFTO | Tocantinópolis | Tocantinópolis/TO | 1721208 | AL |

Campi novos em região (AL/FF): 29. Nenhuma instituição passou de inelegível a elegível por essas inclusões (todas já eram elegíveis pela sede ou por outros campi); o efeito é só ampliar a lista de campi/municípios.

### (b) Campi de `ifes.json` NÃO encontrados na página oficial consultada

| Instituição | Município/UF | IBGE | Região | Observação |
|---|---|---|---|---|
| IFFarroupilha | Santa Maria/RS | 4316907 | - | mantido (INEP); não confirmado em página .edu.br — possível polo/oferta sem campus |
| IFMT | Jaciara/MT | 5104807 | AL | mantido (INEP); não confirmado em página .edu.br — possível polo/oferta sem campus |

### (c) Cobertura

Instituições com lista oficial cruzada (17): IFAC, IFAP, IFFarroupilha, IFMA, IFMS, IFMT, IFPA, IFPR, IFRO, IFSC, IFSul, IFTO, UFFS, UFMS, UFSM, UNIPAMPA, UTFPR.

Instituições SEM confirmação oficial além do INEP (104): todas as demais, incl. IFAM, IFRR, IFC, IFRS, UFPR, FURG, UFPEL, UFGD, UFMA, UFT, UNIR, UFAC, UFAM, UFPA, UFOPA, UFMT, UNIFAP, UFRR, UNILA, UNIFESSPA, UFRA, UFNT, UFR, UFSC, UFRGS, UFCSPA, CEFET-MG, CEFET/RJ, Colégio Pedro II etc.

### Pontos de atenção

- IFPR (sede PR, não AL): a página oficial traz 28 campi; o INEP só 20 municípios. Campi oficiais em FF ausentes do INEP: Barracão, Coronel Vivida, Quedas do Iguaçu, Goioerê (FF), Toledo.
- IFMA: 29 campi oficiais vs 19 municípios INEP; oficiais ausentes no INEP em AL: Carolina, Grajaú, Itapecuru Mirim, Presidente Dutra, Porto Franco, Rosário, Viana; Araioses fora da AL.
- IFMS: Amambaí (FF) e Paranaíba (fora de AL/FF) não constam no INEP; página oficial lista 12 campi (UFMS: 10, todos já no INEP).
- IFFarroupilha: 5 campi oficiais em FF ausentes no INEP (Caçapava do Sul, São Gabriel, Santiago, São Luiz Gonzaga, Uruguaiana); "Santa Maria" do INEP não aparece na lista de unidades.
- IFSul: Jaguarão (FF) ausente no INEP; IFSC: São Lourenço do Oeste (FF) ausente no INEP.
- IFMT: Sinop ausente no INEP; Jaciara (INEP) não consta na lista oficial; Campus São Vicente = Santo Antônio de Leverger (município inferido pelo analista, não declarado na página; conferir).
- Campi em municípios de fronteira que estão em FF mas **fora da AL**: PR, SC, RS, MS (e MA fora do 44°W não aplicável); nesses a elegibilidade depende de a regra ser AL ou FF (alternativa) ou AL e FF (cumulativa).

## 6. Campi em FF mas fora da AL, com distância à fronteira (km)

| Instituição | Campus | Município/UF | Dist. fronteira (km) |
|---|---|---|---|
| FURG | Rio Grande | Rio Grande/RS | 44.1 |
| FURG | Santa Vitória do Palmar | Santa Vitória do Palmar/RS | 0.0 |
| FURG | São Lourenço do Sul | São Lourenço do Sul/RS | 149.5 |
| UFFS | Cerro Largo | Cerro Largo/RS | 30.7 |
| UFFS | Chapecó | Chapecó/SC | 82.9 |
| UFFS | Erechim | Erechim/RS | 145.7 |
| UFFS | Laranjeiras do Sul | Laranjeiras do Sul/PR | 131.4 |
| UFFS | Realeza | Realeza/PR | 21.1 |
| UFGD | Dourados | Dourados/MS | 39.2 |
| UFMS | Aquidauana | Aquidauana/MS | 96.0 |
| UFMS | Naviraí | Naviraí/MS | 70.7 |
| UFMS | Ponta Porã | Ponta Porã/MS | 0.0 |
| UFMS | Corumbá | Corumbá/MS | 0.0 |
| UFPEL | Capão do Leão | Capão do Leão/RS | 95.4 |
| UFPEL | Pelotas | Pelotas/RS | 117.7 |
| UFPR | Palotina | Palotina/PR | 29.6 |
| UFPR | Toledo | Toledo/PR | 28.7 |
| UFSM | Frederico Westphalen | Frederico Westphalen/RS | 34.6 |
| UFSM | Palmeira das Missões | Palmeira das Missões/RS | 68.9 |
| UNILA | Foz do Iguaçu | Foz do Iguaçu/PR | 0.0 |
| UNIPAMPA | Alegrete | Alegrete/RS | 8.0 |
| UNIPAMPA | Bagé | Bagé/RS | 0.0 |
| UNIPAMPA | Caçapava do Sul | Caçapava do Sul/RS | 104.9 |
| UNIPAMPA | Dom Pedrito | Dom Pedrito/RS | 0.0 |
| UNIPAMPA | Itaqui | Itaqui/RS | 0.0 |
| UNIPAMPA | Jaguarão | Jaguarão/RS | 0.0 |
| UNIPAMPA | Santana do Livramento | Sant'Ana do Livramento/RS | 0.0 |
| UNIPAMPA | São Borja | São Borja/RS | 0.0 |
| UNIPAMPA | São Gabriel | São Gabriel/RS | 77.0 |
| UNIPAMPA | Uruguaiana | Uruguaiana/RS | 0.0 |
| UTFPR | Dois Vizinhos | Dois Vizinhos/PR | 57.3 |
| UTFPR | Francisco Beltrão | Francisco Beltrão/PR | 34.6 |
| UTFPR | Medianeira | Medianeira/PR | 14.5 |
| UTFPR | Pato Branco | Pato Branco/PR | 82.8 |
| UTFPR | Santa Helena | Santa Helena/PR | 0.0 |
| UTFPR | Toledo | Toledo/PR | 28.7 |
| IF Catarinense | Abelardo Luz | Abelardo Luz/SC | 118.0 |
| IF Catarinense | Concórdia | Concórdia/SC | 143.6 |
| IFFarroupilha | Alegrete | Alegrete/RS | 8.0 |
| IFFarroupilha | Caçapava do Sul | Caçapava do Sul/RS | 104.9 |
| IFFarroupilha | São Gabriel | São Gabriel/RS | 77.0 |
| IFFarroupilha | Frederico Westphalen | Frederico Westphalen/RS | 34.6 |
| IFFarroupilha | Jaguari | Jaguari/RS | 139.7 |
| IFFarroupilha | Panambi | Panambi/RS | 108.0 |
| IFFarroupilha | Santa Rosa | Santa Rosa/RS | 23.0 |
| IFFarroupilha | Santiago | Santiago/RS | 78.3 |
| IFFarroupilha | Santo Augusto | Santo Augusto/RS | 54.8 |
| IFFarroupilha | Santo Ângelo | Santo Ângelo/RS | 65.7 |
| IFFarroupilha | São Borja | São Borja/RS | 0.0 |
| IFFarroupilha | São Luiz Gonzaga | São Luiz Gonzaga/RS | 30.0 |
| IFFarroupilha | São Vicente do Sul | São Vicente do Sul/RS | 126.0 |
| IFFarroupilha | Uruguaiana | Uruguaiana/RS | 0.0 |
| IFMS | Amambai | Amambai/MS | 12.6 |
| IFMS | Aquidauana | Aquidauana/MS | 96.0 |
| IFMS | Corumbá | Corumbá/MS | 0.0 |
| IFMS | Dourados | Dourados/MS | 39.2 |
| IFMS | Jardim | Jardim/MS | 33.9 |
| IFMS | Naviraí | Naviraí/MS | 70.7 |
| IFMS | Ponta Porã | Ponta Porã/MS | 0.0 |
| IFPR | Assis Chateaubriand | Assis Chateaubriand/PR | 56.2 |
| IFPR | Barracão | Barracão/PR | 0.0 |
| IFPR | Capanema | Capanema/PR | 0.0 |
| IFPR | Cascavel | Cascavel/PR | 51.5 |
| IFPR | Coronel Vivida | Coronel Vivida/PR | 88.1 |
| IFPR | Foz do Iguaçu | Foz do Iguaçu/PR | 0.0 |
| IFPR | Goioerê | Goioerê/PR | 102.2 |
| IFPR | Palmas | Palmas/PR | 146.1 |
| IFPR | Quedas do Iguaçu | Quedas do Iguaçu/PR | 72.4 |
| IFPR | Toledo | Toledo/PR | 28.7 |
| IFPR | Umuarama | Umuarama/PR | 78.2 |
| IFRS | Erechim | Erechim/RS | 145.7 |
| IFRS | Rio Grande | Rio Grande/RS | 44.1 |
| IFRS | Sertão | Sertão/RS | 149.5 |
| IFSC | Chapecó | Chapecó/SC | 82.9 |
| IFSC | São Carlos | São Carlos/SC | 56.6 |
| IFSC | São Lourenço do Oeste | São Lourenço do Oeste/SC | 69.1 |
| IFSC | São Miguel do Oeste | São Miguel do Oeste/SC | 9.7 |
| IFSC | Xanxerê | Xanxerê/SC | 112.1 |
| IFSul | Bagé | Bagé/RS | 0.0 |
| IFSul | Jaguarão | Jaguarão/RS | 0.0 |
| IFSul | Pelotas | Pelotas/RS | 117.7 |
| IFSul | Santana do Livramento | Sant'Ana do Livramento/RS | 0.0 |

## 7. Não confirmado

- Microdados INEP/PNP/e-MEC/dados MEC não acessíveis; não foi possível confirmar campi de ~100 instituições por fonte própria além do INEP; campi de IFs só técnicos, em instituições sem página consultada (IFAM, IFRR, IFC, IFRS, etc.), podem faltar.
- Fronteira terrestre derivada de IBGE (Brasil) + Natural Earth (vizinhos), não de arquivo oficial da fronteira; acerto com a lista IBGE sugere precisão suficiente.

## Correção 03/11/2026 — IFAM
A página oficial www2.ifam.edu.br/campus lista 17 unidades em 15 municípios (Manaus ×3, São Gabriel da Cachoeira, Coari, Lábrea, Iranduba, Maués, Parintins, Tabatinga, Presidente Figueiredo, Itacoatiara, Humaitá, Manacapuru, Eirunepé, Tefé, Boca do Acre). Foram acrescentados 9 municípios que o INEP não trazia (campi técnicos): Eirunepé, Humaitá, Lábrea, Manacapuru, São Gabriel da Cachoeira, Tabatinga, Tefé, Boca do Acre e Iranduba. Manicoré e Santo Antônio do Içá aparecem em materiais do MEC como "novo campus" (anunciados), sem confirmação de funcionamento: NÃO incluídos até haver confirmação.


## Auditoria 03/11/2026 (campi técnicos e novos)
Ver auditoria-campi-2026-11-03.json. Incluído: IFRR Bonfim (em funcionamento). NÃO incluídos (anunciados/em implantação, sem confirmação de funcionamento): IFAM Manicoré e Santo Antônio do Içá; IFPA Alenquer, Barcarena, Redenção, Tailândia, Viseu; IFAC Feijó; IFMA Colinas, Balsas, Amarante do Maranhão; IFMT Água Boa, Canarana, Colniza; IFRR Rorainópolis; UFAM São Gabriel da Cachoeira; UFOPA Rurópolis; UFMT Lucas do Rio Verde; UFPA Capanema (credenciados em 26/11/2025). Fontes bloqueadas por verificação de robô (IFC, IFAM portal, IFRR) não foram contornadas.
