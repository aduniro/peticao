# Revisão local de cadastros

Abra a página com o comando completo:

```sh
/mnt/dev/cpfs/revisar-cpfs
```

A interface HTML usa o SQLite `/mnt/dev/cpfs/revisao/revisao.sqlite` e atende apenas em `127.0.0.1:8765`. O comando abre o navegador com autenticação local. Os arquivos de dados ficam em diretório privado, com permissões 700/600.

## Conferência e decisões

- Use as categorias para separar divergência forte, relevante, possível erro de digitação, ordem diferente, nome incompleto, nome insuficiente e consultas sem resultado.
- Compare o nome do formulário com nome, nascimento, mãe e sexo retornados pela API. Dados indisponíveis são identificados; nascimento e mãe digitados no desafio antigo não foram armazenados pelo aplicativo.
- Correspondências exatas, normalizadas e diferenças apenas de partículas começam aprovadas pelo critério anteriormente aceito. As demais aguardam revisão manual.
- **Aprovar** e **Rejeitar** salvam somente uma decisão local. Os rejeitados saem da lista ativa, permanecem na aba **Rejeitados** e podem voltar à revisão. Cada decisão mantém autor local, horário e revisão dos dados.
- **Detalhes e histórico** mostra datas, origem e decisões anteriores. A confirmação da assinatura é independente da revisão.

## Atualizações

**Atualizar dados da VPS** gera uma exportação somente leitura e baixa os resultados disponíveis, sem novas consultas pagas. Os arquivos de origem permanecem em `/mnt/dev/cpfs/revisao/fontes/`, com manifesto SHA-256. As decisões manuais são preservadas; mudanças nos dados comparados devolvem o caso à revisão.

Esta ferramenta não altera assinaturas, nomes, hashes, numeração ou PDFs em produção e não envia e-mails. Uma futura aplicação das decisões requer uma etapa separada.

## Verificação

```sh
cd /mnt/dev/peticao
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/cpf-review -p 'test_*.py'
node --check tools/cpf-review/app.js
```

## Recepção automática da VPS

O serviço local `peticao-cpf-review-sync.service` confere a fonte a cada **30 segundos** e recebe apenas alterações detectadas pelo fingerprint. A página consulta o SQLite a cada 5 segundos e atualiza a tabela após uma pausa na interação: filtros, página, seleção de texto e o diálogo aberto são preservados. Para carregar esta versão em uma aba que já estava aberta, atualize a página uma vez.

```sh
/usr/bin/systemctl --user status peticao-cpf-review-sync.service
/usr/bin/journalctl --user -u peticao-cpf-review-sync.service -n 10 --no-pager
```

A origem utiliza **uma transação PostgreSQL `REPEATABLE READ READ ONLY`** para assinaturas e cache, com limite de 15 segundos por consulta e 1 segundo para aguardar locks. O exportador tem somente operações de leitura e não usa o bridge que permite gravar cache. Nenhuma decisão, aprovação, rejeição ou campo local é enviado ao banco da VPS. A chave de criptografia fica no servidor e nunca aparece nos logs ou pacotes.

A importação confere SHA-256 do pacote, manifesto, nomes de arquivos, unicidade de IDs, ordem dos snapshots e integridade das bases SQLite. Novos registros e dados alterados são aplicados em uma transação local; decisões simultâneas aguardam essa transação e não são sobrescritas. As bases históricas estáticas só são reenviadas quando seu conteúdo muda. Dez snapshots novos do pipe são mantidos; fontes que existiam antes desta tarefa não entram nessa rotação.

- **Decisões manuais de nome×CPF** não são apagadas por enriquecimento de nascimento/mãe/sexo, mudanças de instituição/categoria/datas ou nova versão da regra do aplicativo.
- Uma mudança substantiva de grafia, ordem dos nomes ou hash do CPF devolve somente aquele caso à revisão. Variações apenas de caixa, acentos, espaços e partículas preservam a decisão (fingerprint `name-cpf-v3`). O histórico da decisão e a versão anterior dos dados permanecem guardados.
- Se o cache expirar, a última evidência cadastral local é preservada, identificada como histórica. Um retorno posterior contraditório é sinalizado; não apaga a evidência anterior.
- As regras automáticas da aplicação em produção são identificadas por digest e versão do build; a página não transforma uma mudança dessas regras em nova aprovação manual.
- Novos CPFs podem chegar como **hash e dados da API, sem o número em claro**. A VPS não guarda o número no banco do aplicativo. Nesses casos aparece “Número não disponível”; o pipe não tenta reverter hashes, não inicia recuperação e não faz consultas pagas.
- Se o computador desligar ou a conexão cair, a cópia local e as decisões permanecem utilizáveis. A recepção retoma quando houver sessão local e conexão SSH. O status da página mostra a última conferência e a defasagem.

Banco: `/mnt/dev/cpfs/revisao/revisao.sqlite`.
Estado da conexão/checkpoint: `/mnt/dev/cpfs/revisao/sync-state.json`.
Backup anterior ao pipe: `/mnt/dev/cpfs/backups/revisao-pipe-20261106T143836Z/revisao.sqlite`.

## Nomes para impressão — revisão independente

A coluna **Nome para impressão** abre um editor próprio. Compare os originais e
as sugestões de acentuação; escolha a proposta, o nome digitado, o nome da API ou
um texto literal. Aprovar/recusar um nome não muda a decisão do CPF. Recusar a
sugestão deixa a impressão aguardando outra escolha. Os originais e o histórico
são preservados. Mudanças materiais nos nomes de origem exigem nova conferência;
enriquecimentos cadastrais não desfazem decisões de CPF.

O dicionário é versionado e contém candidatos, não provas da grafia civil. Consulte
`/mnt/dev/peticao/tools/cpf-review/NAMES-SOURCES.md`. O nome mais completo é
escolhido inteiro, pelo número de palavras relevantes; a API prevalece em empate; o digitado só é preferido com nomes completos adicionais.
Sobrenomes adicionais/diferentes e inversões ficam para decisão individual.

Os botões de lote exigem uma categoria e mostram uma prévia. Consideram os filtros
atuais em **todas as páginas**, somente pendentes; não sobrescrevem decisões já
salvas. Casos especiais não entram em lotes de nomes. A prévia expira em 15 minutos;
qualquer conflito cancela a transação inteira. **Desfazer último lote** também
verifica decisões posteriores e mantém histórico.

Instruções livres para IA são separadas do texto literal. Salve para revisão e
use **Exportar instruções** para trazê-las a esta conversa. A interpretação nunca
aprova automaticamente. Para importar um JSON de propostas revisadas:

```sh
/usr/bin/python3 /mnt/dev/peticao/tools/cpf-review/name_instructions.py --import-proposals /caminho/absoluto/propostas.json
```

Cada item exige `id`, `revision`, `name_revision`, `version`, `literal`,
`explanation` e `uncertainty`, usando as revisões do lote exportado. O editor mostra
a interpretação; **Usar proposta interpretada** apenas preenche o campo literal,
que ainda precisa de aprovação. Não executa instruções como comandos.

**Gerar prévia local** cria arquivos novos em `/mnt/dev/cpfs/revisao/previas/`, com
seleção congelada e manifesto SHA-256. Entram apenas confirmadas com decisão de
CPF aprovada (não aplicável a estrangeiros) e nome aprovado e atual. Nenhum nome é
truncado ou perde acentos silenciosamente: caracteres sem cobertura da fonte
bloqueiam a geração. O PDF é uma lista de conferência, marcada **NÃO ENVIAR**;
não substitui os lotes oficiais, não publica mudanças e não contém CPF,
nascimento, mãe, sexo, e-mail ou IP. Nenhum PDF anterior é sobrescrito.

### Dependências da prévia

A geração usa `reportlab` e `fonttools`; os testes também usam `pypdf`. Nesta
máquina foram verificados ReportLab 5.0.1, fontTools 4.46.0 e pypdf 4.0.2.
Nenhuma dependência da aplicação foi alterada para essa prévia local.

Cada decisão de nome conserva a versão do dicionário e uma cópia da sugestão
apresentada. Atualizar o corpus não substitui um nome aprovado anteriormente.

### Auditoria anterior à mudança de e-mails

O código em DEV passa a preservar `+etiqueta` fora do Gmail pessoal. Antes de
publicar, refaça a auditoria somente leitura; o relatório contém endereços e deve
ficar privado. Não migra hashes nem autoriza uma migração automaticamente:

```sh
/usr/bin/python3 /mnt/dev/peticao/tools/cpf-review/audit_email.py --output /mnt/dev/cpfs/revisao/auditoria-email-nova.json
```

## Política central atualizada

A sugestão principal usa o nome completo da API + acentos. A exceção do digitado
mais extenso exige nomes completos adicionais, não iniciais nem espaços inseridos
num sobrenome da API (`Sant Ana` não é maior que `Santana`). Preservar partículas
comprovadas. Regras: `/mnt/dev/peticao/docs/POLITICA-CENTRAL-NOMES.md`.

O botão **Aprovar nome** em cada linha aprova exatamente o texto exibido, sem abrir
a janela e sem alterar CPF. Casos com instrução IA pendente precisam primeiro da
interpretação; conflitos de outra aba não sobrescrevem a decisão mais nova.

Escolhas antigas incompatíveis com a nova preferência ficam sinalizadas para
revisão, mantendo o texto/histórico anterior e o aceite do CPF. A nova prévia não
inclui um nome que aguarda essa revisão. Isso não reescreve PDFs já gerados.
