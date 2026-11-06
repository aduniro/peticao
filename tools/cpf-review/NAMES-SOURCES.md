# Dicionário de sugestões de nomes

O corpus inicial contém **840 grafias candidatas**, selecionadas editorialmente,
com foco em nomes brasileiros/portugueses e famílias europeias que usam o alfabeto
latino. Não é um cadastro civil, não é exaustivo e não identifica a grafia legal de
uma pessoa. Uma forma sem acento pode corresponder a várias formas legítimas.

## Fontes e limites de reutilização

- [IRN — composição do nome](https://irn.justica.gov.pt/Servicos/Cidadao/Nascimento/Composicao-do-nome)
  e [lista de nomes próprios](https://irn.justica.gov.pt/Portals/33/Regras%20Nome%20Proprio/Lista%20Nomes%20Pr%C3%B3prios.pdf):
  referências de grafias documentadas. A lista apresenta, por exemplo, variantes
  com e sem acento. A licença de reprodução integral não foi estabelecida;
  **não foi feita importação integral**. Rogério consta na página 62.
- [CSO — notas sobre nomes irlandeses](https://www.cso.ie/en/releasesandpublications/ep/p-ibn/irishbabiesnames2021/backgroundnotes/):
  trata Sean e Seán como grafias distintas; serve de evidência contra a recuperação
  automática de uma única grafia a partir de letras sem acento.
- [Wikidata — licenciamento](https://www.wikidata.org/wiki/Wikidata:Licensing):
  dados estruturados são CC0. Tentativas de obter um corpus retornaram 502 e 429;
  **nenhuma entrada deste arquivo é apresentada como importada do Wikidata**.
- [Unicode UAX #15](https://www.unicode.org/reports/tr15/): NFC representa sequências
  canonicamente equivalentes. Não descobre acentos ausentes nem torna `ł/l`, `ø/o`,
  `ß/ss` ou `æ/ae` a mesma letra.

As entradas atuais são uma seleção editorial independente de candidatos, não uma
cópia desses bancos. `source=editorial-curation` significa exatamente isso; não
constitui corroboração oficial por entrada. Versões futuras podem incorporar dados
públicos com licença identificada, origem por entrada e revisão explícita.

## Padrões tratados

- Agudos, graves, circunflexos, til, trema, cedilha e combinações europeias, incluindo
  caron, breve, ogonek, macron e duplo agudo, são representados por grafias reais
  candidatas: José, Antônio, João, Müller, Jiří, Răzvan, Dąbrowski, Kārlis, Ernő.
- Letras próprias de alfabetos nacionais são preservadas: Łukasz, Søren, Guðni.
- Apóstrofos e hífens permanecem no nome. `D'ALLGNOL` não vira `Dall'Agnol`:
  isso mudaria letras, e não apenas acento ou apresentação.
- Compostos e partículas permanecem na sequência original. O resolvedor não tenta
  adivinhar a separação civil entre prenome e sobrenome.
- Marques/Marquês, Coelho/Coêlho e Macedo/Macêdo conservam alternativas. Formas
  já acentuadas permanecem, salvo a sugestão explícita de possível erro Rogêrio →
  Rogério. Nenhuma alteração é aprovada automaticamente.

## Uso e versionamento

`name_dictionary.suggest(record)` recebe `name` e `nome_api` e devolve os dois nomes
resolvidos, proposta, alternativas, motivos, análises de grafia e `dictionary_version`.
A versão inclui SHA-256 do corpus; mudanças no arquivo não podem passar despercebidas.
Não há rede, escrita em banco ou alteração do registro fornecido durante a resolução.

O nome mais completo é escolhido **inteiro**, pelo número de palavras relevantes.
Em empate, prevalece o digitado. Diferenças de palavras/ordem são casos especiais
para decisão individual. Não há fusão automática de sobrenomes. A proposta sempre
exige aprovação independente da decisão sobre CPF.

Teste:

```sh
cd /mnt/dev/peticao
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/cpf-review -p test_name_dictionary.py
```

## Evidência local separada

`/mnt/dev/cpfs/revisao/name-observations.json` contém somente tokens acentuados
observados no preenchimento, com contagens agregadas. É privado (600), não integra
Git, não contém nomes completos, IDs nem CPFs e não é uma fonte oficial. O caminho
acompanha `CPF_REVIEW_DATA_DIR` quando configurado. As grafias observadas alimentam
**alternativas**, nunca preferências baseadas em frequência. Uma observação isolada
não acrescenta automaticamente um acento desconhecido ao nome da API.

O digest da versão inclui esse arquivo. Ausência do arquivo não impede o uso do
corpus público. A cobertura agregada, sem identificação de assinantes, fica em
`/mnt/dev/cpfs/revisao/nomes-cobertura.json`; reflete um snapshot, não prova de nome civil.
