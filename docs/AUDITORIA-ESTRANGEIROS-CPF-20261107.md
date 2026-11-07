# Auditoria isolada de cadastros e tentativas estrangeiras — 07/11/2026

Os cinco nomes preservados em cadastros estrangeiros não encontraram candidatos na base própria pelos critérios definidos. Três endereços usados em tentativas recusadas também aparecem em cadastros de apoiador com CPF já conhecido. Os nomes desses três cadastros são compatíveis com seus próprios retornos históricos de CPF, mas o nome digitado na tentativa estrangeira não foi preservado. Isso não comprova nacionalidade, autoria da tentativa ou fraude.

## Escopo e fontes

Leitura da VPS em transação PostgreSQL `REPEATABLE READ READ ONLY`, com `statement_timeout=15s`; snapshot iniciado em **2026-11-07T22:00:28.507197Z**. Foram consultados somente os campos necessários de `signatures`, recusas de `request_log` e agregados de `signup_diagnostics`. Nenhum segredo foi exibido, e nenhum método da aplicação que escreva auditoria ou schema foi executado.

A base própria de comparação foi `/mnt/dev/cpfs/revisao/revisao.sqlite`, aberta diretamente com `mode=ro`, sem importar helpers de conexão que executam migrações. Snapshot de origem registrado nessa base: **2026-11-07T21:41:56.072Z**. Os dados pessoais ficaram exclusivamente em `.cache/foreign-audit-20261107/`, diretório modo 700 e arquivos modo 600. Este relatório não contém nomes, endereços, CPF, IP, hashes de participantes ou identificadores individuais.

## Cobertura disponível

| Fonte | Cobertura observada | Limite |
| --- | --- | --- |
| Cadastros estrangeiros atuais | 5 nomes: 1 confirmado e 4 pendentes | Categoria declarada não comprova nacionalidade |
| Recusas do fluxo estrangeiro | 23 eventos, 15 hashes distintos de e-mail | Eventos e endereços não equivalem a pessoas |
| Associação das recusas a cadastros próprios | 3 endereços associados a 3 cadastros de apoiador, cobrindo 6 eventos | É associação de endereço, sem comprovação do nome digitado na tentativa |
| Recusas sem nome preservado recuperável nas fontes consultadas | 12 endereços, 17 eventos | Não há nome para comparação nominal |
| Sobreposição entre os 5 cadastros estrangeiros e os 15 endereços recusados | 0 | O conjunto cobre 20 endereços distintos, não necessariamente 20 pessoas |
| Diagnóstico de navegador estrangeiro | 2 traces com início, toque de campo, ocultação e saída | Sem submit registrado nessa coleta; não são somados como pessoas |
| Histórico da revisão | 1 cadastro estrangeiro inativo | Mesmo nome e endereço de cadastro estrangeiro ativo; não amplia os 5 nomes |

O `request_log.detail` das recusas guarda domínio, país declarado e motivo técnico, sem nome. Os motivos observados foram 13 `not_university_email`, 6 `not_university_email (not_academic)` e 4 `foreign_brazilian_email`. `signup_diagnostics` registra códigos, contagens e metadados técnicos, sem valores de nome/CPF/mãe/nascimento; contato cifrado é condicionado ao envio consentido. Não foram inventados nomes para preencher essa lacuna.

## Comparação e critérios

Foram analisados **8 nomes de cadastro**: os 5 diretamente disponíveis e os 3 associados por endereço às recusas. Cada nome foi comparado ao nome declarado e, quando disponível, ao nome retornado pela API já existente em **12.302 registros próprios de categorias brasileiras**, com **12.302 hashes de CPF distintos**. Desses, **12.298 têm nome de retorno API**; 4 não têm essa evidência. Total: **196.800 pares direcionais de nomes**, sem gerar ou enumerar números de CPF.

“Categorias brasileiras” identifica os fluxos servidor/apoiador usados como base, não a nacionalidade comprovada dos titulares. Nomes de cadastros apoiador ligados à tentativa são fontes indiretas: não foram tratados como nomes comprovadamente digitados nela.

**Regra vigente:** execução direta de `classifyCpfName`, em `site/src/lib/cpf-name.ts`, com a política `2026-11-06.count-based-exact-name-v6`. Ignora caixa, acentos e partículas da/de/do/das/dos/e; exige palavras digitadas exatas, na ordem, e pelo menos 2 palavras relevantes quando API tem 2 ou 3; pelo menos 3 quando tem 4 ou mais. Conserva também as restrições de caracteres, limites e palavras proibidas do código. `partial` exige desafio adicional de identidade; não é aprovação. Os SHA-256 de código e JSON de política foram conferidos iguais no checkout local e na VPS, sem copiar código entre eles.

**Triagem exploratória flexível:** execução somente analítica de `tools/recovery/cpf_compare.py`. Seleciona coincidência exata/normalizada, variação de partículas, mesmas palavras fora de ordem, subsequência compatível com ao menos duas palavras completas e extremos compatíveis (permitindo iniciais), ou possível digitação incorreta com igual quantidade de palavras, similaridade total ≥ 0,88 e similaridades por posição ≥ 0,72. A normalização exploratória também separa pontuação. Exige ao menos duas palavras em cada nome. Essa regra serve para indicar revisão manual; não aprova identidade e não foi incorporada a nenhuma versão da aplicação.

## Resultados

| Grupo | Nomes | Com candidato pela regra vigente | Com candidato pela triagem flexível | Candidatos adicionais da triagem |
| --- | --- | --- | --- | --- |
| Nomes diretamente dos cadastros estrangeiros | 5 | 0 | 0 | 0 |
| Nomes de apoiadores associados às recusas por endereço | 3 | 3 | 3 | 0 |

Os únicos três candidatos são os próprios cadastros de apoiador que forneceram os nomes associados: não surgiu um segundo titular de CPF compatível em nenhum desses casos. Contra o nome declarado, houve três correspondências completas. Contra o nome do retorno API, houve **duas `complete` e uma `partial`**. A última é apenas compatibilidade nominal com omissão de palavras, sujeita ao desafio de identidade vigente. Isso não verifica retrospectivamente a autoria da tentativa, nem comprova que o desafio tenha sido realizado nela.

Todos os três nomes de retorno usados nos candidatos vieram de **evidência histórica já disponível**, com consultas originais em 05–06/11/2026. **Consultas novas à API de CPF: zero.** Não houve busca externa por nome nem tentativa de descobrir CPF. O apêndice privado apresenta nomes, fontes, comparação explicável, datas dos retornos e CPF mascarado; não exporta mãe, nascimento, e-mail ou IP.

Ausência de candidato significa somente ausência de compatibilidade nesse conjunto e nesses critérios. Homônimos continuam possíveis mesmo nas correspondências completas; os 12 endereços recusados sem nome permanecem inconclusivos. Não se pode concluir que os cinco cadastros sejam estrangeiros de fato nem que os três associados sejam brasileiros ou tenham cometido fraude.

## Capacidade da API e nacionalidade

A [documentação pública da CPF Brasil](https://www.cpf-brasil.org/documentacao/), verificada nesta auditoria, descreve consulta por CPF previamente conhecido (`GET /cpf/{11digitos}`), retornando CPF, nome, sexo, nascimento e nome da mãe. Não documenta busca reversa por nome nem campo de nacionalidade. A integração existente (`site/src/lib/cpf-check.ts`) também oferece somente consulta por CPF. Não foi presumida capacidade adicional nem feita consulta autenticada para testar nomes.

A [Receita Federal admite inscrição de estrangeiros no CPF](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/cadastros/cpf/assuntos-relacionados/perguntas-e-respostas). Portanto, possuir CPF, ou ter nome compatível com um retorno de CPF, não demonstra nacionalidade brasileira. A associação por endereço tampouco demonstra intenção de contornar o formulário.

## Preservação, evidência e comunicação

Nenhuma aplicação local/VPS, regra, schema, assinatura, decisão ou revisão foi alterada. Não houve merge, deploy, contato com participante ou sincronização de código. Somente este relatório técnico é versionado; scripts, agregados e evidências identificáveis ficam no diretório privado citado. O Vigia registra a tarefa `auditoria-estrangeiros-cpf` de forma independente do trabalho prioritário de admin-v2.

A notificação de conclusão, em HTML e com apêndice privado, é destinada exclusivamente a operator-78ffa47eeb@example.invalid`, conforme autorização expressa. Aceite do provedor não comprova entrega; recibo técnico fica no artefato privado.
