# Auditoria de fontes — nome oficial no PDF

Inspeção somente de fontes e políticas em 09/11/2026 UTC. Candidato: `aa57ce7`, `/mnt/dev/peticao/.cache/admin-integration/candidate-stage02-domains`. O principal local e o resolvedor independente foram consultados como fontes, sem copiar resultados para o app. Não foram executados SQL, imports de módulos, API, testes, exportadores, decriptação, consulta VPS ou leitura de SQLite/CSV/logs de pessoas. Esta auditoria não atualiza conclusões sobre o estado remoto de produção.

## Conclusão verificável

Não há campo de nome oficial/normalizado de impressão em `signatures` no candidato. O fluxo grava o nome declarado já formatado em `signatures.name`, lê a mesma coluna para os lotes e imprime `r.name`. O retorno nominal da API é usado para conferir identidade, mas não é transportado como escolha de impressão. O cache guarda o nome retornado; o cache não constitui aprovação de impressão. O único `selected_name` aprovado encontrado pertence ao mecanismo de revisão local separado, não ao PostgreSQL do candidato.

Assim, até um nome parcial legitimamente admitido pelo desafio de identidade continua parcial no PDF. Acentos/partículas do formulário permanecem os disponíveis no nome salvo; não há garantia de incorporar nomes do meio/partículas existentes apenas na API. Nenhum valor individual foi consultado para esta conclusão.

## Caminho atual no candidato

| Ponto | Evidência de código | Efeito |
|---|---|---|
| Normalização de cadastro | `site/src/lib/signatures.ts:77` | `titleCaseName(clean(raw.name,120))`; capitalização não recupera nomes/acentos ausentes. A grafia literal anterior à formatação não é preservada por uma coluna independente. |
| Conferência nominal | `identity.ts:116–119`, `identity.ts:75–84`, `sign-flow.ts:158–170,186–198` | Compara o retorno e devolve `nameCheck`; não devolve nome completo para `submit`. Parcial exige desafio, sem equivaler a nome de impressão escolhido. |
| Persistência | `signatures.ts:218,222` | Grava `input.name` e selo `cpf_name_check`; não guarda decisão de impressão. |
| Reserva/lista | `batches.ts:33,85,88,95–97` | Consulta `name`, calcula hash da lista e congela os mesmos valores. |
| Renderização | `pdf.ts:181–182` | Imprime `clean(r.name,font)`, sem resolvedor. `clean`, linhas 46–59, pode transliterar/substituir caracteres não cobertos pela fonte; não prova a grafia civil. |
| Retomada | `batch-preparation.ts:20–32` | Snapshot/hash precisam coincidir; recalcular nomes mudaria o documento reservado. |

`name` em outras tabelas (universidades/contatos/admin) ou `referrers.display_name` não é nome oficial do signatário. A presença de um selo CPF match também não contém uma grafia escolhida.

## Fontes disponíveis e sua proveniência

**Cache do candidato:** `cpf-cache.ts:17–25,31–39,64–66`, `cpf-cache-crypto.ts`, `cpf-check.ts:66–71`. O payload cifrado contém `nome`, mãe, nascimento e sexo, com contexto vinculado ao hash do CPF e TTL de 30 dias. `nome` é o campo cadastral limpo nas pontas, não um nome acentuado/revisado. O esquema de cache não persiste o nome do provider por registro nem uma versão de política de impressão; não se deve inventar essa proveniência. Não se deve copiar o payload biográfico inteiro para justificar apenas um nome.

No principal local existe `cachedCpfRecordByHash` (`site/src/lib/cpf-cache.ts:43–47`), ausente no candidato. É uma leitura interna com TTL/decriptação e falha fechada, não resolvedor nem decisão. Pode orientar um adaptador futuro que exponha apenas o nome à revisão autorizada, sem alterar a fonte CPF ou chamar API. Não foi chamado nesta auditoria.

**Política central e TypeScript local:** `docs/POLITICA-CENTRAL-NOMES.md`, JSON `2026-11-06.api-particles-mandatory-v3`, dicionário `2026-11-06.curated-1` e `site/src/lib/name-print-policy.ts`. Preferem API completa; incluem nomes do meio/partículas obrigatórias; exceção para palavras completas adicionais do declarado, sem contar iniciais/espaços indevidos. Divergências maiores exigem revisão/notificação; decisões CPF são independentes. A documentação posterior substitui a regra antiga de empate favorável ao digitado.

Os três arquivos de impressão existem no principal local e estão ausentes no candidato. A busca de referências no principal encontrou o helper apenas no próprio módulo e em testes. O helper oferece sugestão com `policyVersion`, origem e divergências; não implementa persistência/aprovação. `accentedName`, linhas 16–25, aplica preferências/correções do dicionário: chamar esse helper diretamente durante o PDF converteria sugestões em grafias individuais sem aprovação. O resultado TypeScript também não carrega a versão do dicionário nem a análise de ambiguidade por palavra que o Python fornece.

**Revisão local Python:** `tools/cpf-review/name_dictionary.py`, `name_policy.py`, `name_review.py`, `preview.py`, `name_alerts.py`. As sugestões incluem análise/alternativas/proveniência, `dictionary_version`, `policy_version` e `requires_approval=True`. O dicionário pode incorporar observações locais privadas (linhas 49–53); esses arquivos privados não foram abertos e o módulo não foi importado.

`name_decisions.selected_name` é uma escolha literal humana, com revisor, versão, revisão da origem e histórico. A revisão vincula CPF hash + nome declarado armazenado + nome API (`name_review.py:6–7`), detecta fonte/política desatualizada e usa CAS antes de gravar. A prévia local só usa nome aprovado e atual, preservando metadados/versionamento (`preview.py:45–74`), mas é expressamente não oficial. Esses valores poderiam ser candidatos a importação revisada e vinculada à origem, nunca autopromoção por aparecerem como aprovados em outra base. A fila de divergências retorna `email_sent=0`, não é remetente.

**Resolvedor independente:** `/mnt/dev/resolvedor-nomes/{AGENTS.md,README.md,resolvedor/names.py,resolvedor/store.py,resolvedor/provider.py,resolvedor/upstream_worker.py}`. O README esclarece que AGENTS foi copiado do workspace original; a estrutura atual está no README. O código compara nomes normalizados sem acentos e classifica possíveis incompletos/divergências; não aplica a política central de impressão. `classify_response` exige nome da certidão e CPF efetivamente retornado correspondente, mas o estado `resolvido` não significa aprovação humana de uma grafia nem comprovação de casamento. `consultas.nome_retornado`, evidências e versão do upstream são campos de resultados isolados, não colunas do app. Nenhum desses resultados foi lido nem o provider executado.

A correção local de confirmação antiga (`confirmation-check.ts`, `signatures.ts:287–299` no principal) pode mudar o nome declarado mediante prova do estado anterior. É outro fluxo local; não adiciona campo de impressão, não chama `resolvePrintName` e não deve ser portado nesta frente para preencher a lacuna silenciosamente.

## Próximo marco implementável, condicionado às decisões abaixo

1. Criar um store PostgreSQL de fontes nominais e decisões de impressão separado das decisões CPF: fonte imutável com nome declarado **armazenado** (não alegar que recuperou o literal perdido), nome cadastral, hash da origem/CPF, captura/proveniência real e política/dicionário; decisão versionada com literal aprovado, revisor, estado e revisão CAS. Minimizar/cifrar evidência nominal privada e não prolongar retenção do payload biográfico inteiro. Usar histórico aditivo, sem sobrescrever aprovações humanas.
2. Portar política/dicionário como geradores de sugestões rastreáveis, não como fonte automática de identidade ou grafia civil. Preservar aprovações compatíveis; incompatibilidades da política devem gerar nova revisão com histórico. Retornos sem acento podem produzir alternativas, nunca certeza inventada. Estrangeiros seguem nome declarado com conferência própria, sem consulta CPF criada por este módulo.
3. Implementar leitura autorizada de cache existente e entrada explícita, revisada, de decisões locais por manifesto/versionamento. Validar ID/hash/revisão com o cadastro corrente, detectar origem ausente/desatualizada/discordante e não aplicar nada sozinho. Não abrir SQLite ativo dentro da aplicação nem chamar o resolvedor externo no fechamento do lote.
4. Integrar seleção **aprovada e atual** antes da reserva de novos lotes: rows recebem o literal escolhido e prova da decisão; nomes e referências de decisão ficam congelados no snapshot/list hash. Não usar `COALESCE(selected_name,signatures.name)` para alegar que toda a lista usa a política. Não excluir silenciosamente pessoas sem decisão.
5. Manter PDFs preparados, anexos/histórico binário e snapshots antigos intactos. Mudança futura de nome só entra em documento novo explicitamente criado; retomada usa o snapshot reservado. Nenhum backfill de grafia antiga. Conferir cobertura dos caracteres aprovados antes de renderizar um novo contrato, evitando transformar uma escolha literal em outro nome pela limpeza da fonte.
6. Provar o marco com PostgreSQL fictício e PDF real fictício: API completa/partículas, adicionais completos versus iniciais, acentos ambíguos, revisão humana preservada, fonte/hash/CAS revogados, cache ausente/expirado sem API, estrangeiro, decisão local não importada automaticamente, falha de auditoria e bytes de documentos/snapshots anteriores invariáveis. Migração aditiva/rollback sem importar dados reais. Só depois interface e notificações aprovadas; nenhuma chamada de API/envio real faz parte do QA.

## Precisões necessárias antes de alterar o código

- **Origem da decisão:** o próximo marco deve apenas suportar nova revisão administrativa do candidato, ou também receber um manifesto de decisões locais explicitamente aprovado pelo dono? Nenhuma importação de estado real está autorizada por esta auditoria.
- **Sem decisão atual:** um novo preparo deve parar com diagnóstico de pendências, ou o dono quer manter temporariamente um modo legado claramente separado? Bloquear novos preparos ou escolher fallback sem essa decisão criaria comportamento não confirmado. Nunca excluir assinantes silenciosamente.
- **Retenção:** preservar o nome cadastral original para a decisão/PDF cria evidência nominal além do cache de 30 dias. Definir retenção/acesso desse nome mínimo e das decisões; não ampliar automaticamente a retenção de mãe/nascimento/sexo nem inferir autorização do cache.

A existência do código local não autoriza promover fontes, formular novos acentos, reabrir decisões CPF, enviar notificações ou modificar os formulários. O próximo commit pode ser um store funcional com revisão transacional e integração de novas reservas, após estas precisões e coordenação do slot DDL; não apenas contrato/fake.

## Rastreabilidade da inspeção

Foram lidos os arquivos de políticas/docs citados; no candidato, `signatures.ts`, `sign-flow.ts`, `identity.ts`, `cpf-name.ts`, `cpf-check.ts`, `cpf-cache.ts`, `cpf-cache-crypto.ts`, `name-case.ts`, `batches.ts`, `batch-preparation.ts`, `pdf.ts` e esquema de `db.ts`; no principal, os módulos de impressão/revisão/cache/confirmacão citados; no resolvedor, somente os seis fontes/documentos enumerados. Algumas leituras foram por seções/ocorrências relevantes, não auditoria integral de todos os módulos. Nenhum runtime, registro pessoal, exportado, SQLite, comprovante, segredo, observação privada ou histórico pessoal foi aberto. Não há prova empírica sobre pessoas/quantidades ou grafias reais neste relatório.

SHA-256 das fontes públicas inspecionadas no principal:

- `site/src/content/name-print-policy.json`: `127c8b0df91932c7ae82eba3cc6b171bcfe808d3d352c227964c8bfc6147425f`
- `site/src/content/name-dictionary.json`: `9387dc37b31f69cb749551c9ca97a0cc00dedefdc90c61558d01a20dcf98d572`
- `site/src/lib/name-print-policy.ts`: `179f28e44946516dc45348efe648ae4cd08a97ee1d08b7941ec521e779215cac`
- `tools/cpf-review/name_policy.py`: `bee6fbf66fe2b90701a08908f02da03398ea187f169cd666633bc8acfea20e84`
- `tools/cpf-review/name_dictionary.py`: `4a12ed35f4d5ba0a5001fcd9491f8d04f41c436702841cd4a416dd6a6e0fc8c6`
