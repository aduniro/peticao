# Histórico de problemas e decisões da plataforma

Registro solicitado pelo responsável pela plataforma em **06/11/2026**. Este documento acompanha problemas, propostas, validações e publicações separadamente. Uma proposta ou um teste local aprovado **não significa alteração publicada**.

Não registrar aqui nomes de assinantes, CPFs, nascimento, nome da mãe, endereços pessoais, tokens ou segredos. Evidências individuais permanecem nas bases e backups privados.

## Estado e prioridades

| ID | Prioridade | Problema ou necessidade | Estado em 06/11/2026 |
|---|---|---|---|
| PLAT-001 | Alta | Tentativa duplicada confirmada mostra “e-mail enviado”, embora nenhum envio ocorra | Diagnosticado em produção; correção pendente |
| PLAT-002 | Alta | Acesso seguro para “Verificar/Corrigir minha assinatura” | Pesquisa solicitada e documentada; arquitetura depende de decisão |
| PLAT-003 | Alta | Corrigir apoiador para servidor sem criar outra assinatura | Proposto; regras de vínculo e autenticação ainda não implementadas |
| PLAT-004 | Alta | Novas regras de nome × CPF e impedimento de aprovação com nome incompatível | Implementadas em desenvolvimento; publicação pendente |
| PLAT-005 | Alta | Correção de nome durante confirmação de cadastro antigo pendente | Texto aprovado; fallback em desenvolvimento; publicação pendente |
| PLAT-006 | Alta | Registros de preenchimento parcial e tentativas, com retenção de 30 dias | Escopo e aviso de coleta parcial aguardam decisão; coleta não ativada |
| PLAT-007 | Média | Histórico de tentativas de identidade dura sete dias em produção | Retenção de 30 dias preparada em desenvolvimento; publicação pendente |
| PLAT-008 | Alta | Reenvio do formulário apaga e recria cadastros pendentes | Comportamento identificado; preservação de ID/histórico requer ajuste |
| PLAT-009 | Média | Tratamento genérico de conflito SQL `23505` esconde o resultado da operação | Revisão pendente |
| PLAT-010 | Alta | Revisão humana das divergências históricas ainda não terminou | Em andamento pelo responsável; decisões locais preservadas |
| PLAT-011 | Alta | Política para substituir nomes nos documentos e tratar exceções cadastrais | Pendente; prévias atuais mantêm nomes registrados |
| PLAT-012 | Alta | Consolidar e regenerar PDFs/lotes para envio após revisão | Pendente; nenhuma autorização de envio nesta rodada |
| PLAT-013 | Média | Normalização de e-mails presume suporte a `+etiqueta` em todos os domínios | Identificado; revisar por provedor sem migração cega dos hashes |
| PLAT-014 | Alta | Avisos existentes e retenção real de respostas da API precisam ser compatibilizados | Decisão editorial pendente; não alterar avisos sem aprovação |
| PLAT-015 | Média | Novas assinaturas posteriores ao snapshot não têm número de CPF na cópia local | Limitação conhecida; dados disponíveis continuam chegando pelo hash |
| PLAT-016 | Média | Quatro CPFs do grupo consultado não foram encontrados pela API | Sem resolução cadastral; não declarar CPF inválido por isso |
| PLAT-017 | Alta | Definir descarte de dados derivados, exportações e backups de conferência | Pendente; expiração do cache não apaga automaticamente CSVs/SQLites |
| PLAT-018 | Alta | Publicação cumulativa, isolada das alterações ainda não publicadas do painel | Testes finais e escopo de release pendentes |

## Detalhamento e critérios de conclusão

### PLAT-001 — Duplicidade e mensagem de envio

**Evidência:** `site/src/lib/signatures.ts`, função `submit()`, detecta CPF ou e-mail já confirmado, registra `duplicate_attempt` e retorna sem envio. `site/src/lib/sign-flow.ts` devolve `ok: true`; `site/src/components/SignForm.tsx` anuncia envio. O comentário do código declara a intenção de evitar enumeração de participantes.

**Diagnóstico:** o banco bloqueia a duplicata; o contrato de resultado e a mensagem da interface confundem bloqueio com criação/envio. A checagem é global entre categorias. A auditoria consultada comprovou tentativas bloqueadas e preservação do registro original. Não foram encontrados grupos repetidos de CPF/e-mail no banco consultado.

**Proposta:** resultado interno explícito, mensagem verdadeira e tratamento de privacidade integrado ao acesso autenticado. Não anunciar envio quando ele não ocorreu. Separar criação, pendência, confirmação anterior, fila e conflito concorrente.

**Aceite:** testes cruzando servidor/apoiador, mesmo CPF com outro e-mail, mesmo e-mail com outro CPF, concorrência e mensagem exibida; nenhuma nova assinatura, alteração de categoria ou reenvio indevido nas duplicatas confirmadas. Respostas anônimas não devem revelar dados de participantes.

### PLAT-002 — Verificar/Corrigir minha assinatura

**Solicitação:** botão público na página inicial e acesso simples, com autenticação que impeça alterações por terceiros que conheçam CPF, nascimento ou mãe.

**Regra de segurança proposta:** dados cadastrais são identificadores ou evidências de compatibilidade; não são senha nem autorização de edição. Separar consulta, autenticação, validação cadastral e autorização de cada mudança.

**Atenção ao código atual:** `/meu/[token]` é um painel de cartaz/indicações. O token em `referrers.manage_token_hash` é um segredo de posse; a consulta atual não estabelece uma sessão de edição com expiração/reautenticação. Código público, QR, inscrição e link de indicação não podem autorizar alterações.

**Estudo:** [Alternativas e proposta de acesso seguro](docs/ACESSO-E-CORRECAO-DE-ASSINATURAS.md). Ainda não implementar login/recuperação nem publicar textos novos sem decisão do responsável.

**Aceite:** autenticação e recuperação resistentes a tomada de conta; escopo restrito por assinatura; reautenticação para alteração; sessão curta, proteção CSRF e contra enumeração; testes de acesso cruzado, replay, token vencido, roubo de sessão, cadastro de passkey e recuperação sem downgrade.

### PLAT-003 — Correção de categoria e dados profissionais

Permitir solicitação autenticada de apoiador para servidor no mesmo registro, preservando ID, inscrição, `created_at`, `confirmed_at`, consentimento original e hash do CPF. Guardar categoria anterior, novos dados, autor/método e horário da correção. Revalidar instituição, cargo, campus e critérios regionais.

Definir a política para quem usa e-mail pessoal porque o institucional falhou. CPF conferido não comprova vínculo profissional. Não marcar e-mail ou vínculo institucional como verificado quando houve apenas declaração. E-mail novo deve ser confirmado antes da substituição; perda de acesso ao antigo exige recuperação segura.

### PLAT-004 e PLAT-005 — Nome × CPF e confirmação antiga

Regras autorizadas: ignorar caixa, acentos, espaços e partículas; exigir palavras completas, grafia compatível e ordem; nomes parciais dependem de nascimento ou mãe; nascimento/mãe corretos não compensam nome incompatível. WhatsApp exige desafio em todos os casos brasileiros; estrangeiros continuam sem CPF.

O retorno da API não separa prenomes/sobrenomes; casos ambíguos podem exigir completar o nome. Equivalências como “Segundo”/“II”, troca de sobrenome e nome social não podem ser inventadas por similaridade.

Texto do fallback para pendentes aprovado em 06/11/2026, com título “Confira seus dados para concluir a assinatura” e botão “Conferir dados e continuar”. Desenvolvimento atual usa o link válido, confere o mesmo CPF, preserva o nome anterior na auditoria e confirma/corrige em transação. Não é autorização para abrir edição de assinaturas confirmadas por CPF/DOB/mãe.

**Validação já realizada em desenvolvimento:** suíte do candidato com 182 testes; regressões específicas subsequentes e 26 testes cumulativos do fallback/conferência passaram. São etapas distintas, não uma contagem única de testes inéditos. Falta executar a suíte final sobre o pacote definitivo e decidir a autenticação/recuperação antes da publicação conjunta.

### PLAT-006 e PLAT-007 — Tentativas e preenchimentos parciais

Hoje `events` registra visitas, cliques e início de formulário, respeitando DNT/GPC; não conserva tudo o que foi digitado. A auditoria de duplicidade não guarda categoria/nome tentados. `identity_attempts` conserva hash do CPF, método, resultado e horário; a limpeza de produção usa sete dias. Registros já removidos não podem ser reconstruídos por mera ampliação do prazo.

Preparada em desenvolvimento a retenção de tentativas de identidade por 30 dias, mantendo limite de cinco erros em 24 horas. Nascimento e mãe digitados no desafio não foram incluídos nesse histórico.

**Decisão pendente:** foi apresentada uma opção inicialmente desmarcada para autorizar rascunho protegido por até 30 dias, inclusive sem envio, com CPF apenas em hash e sem nascimento/mãe digitados. O usuário ainda não aprovou esse texto/escopo. Alternativa: registrar somente eventos e estados dos campos, sem conteúdo pessoal. Não ativar coleta silenciosa antes do envio.

**Aceite:** retenção e limpeza testadas; conteúdo protegido e acesso restrito; escopo explícito, minimizado e aprovado; sem senhas, tokens, segredos ou desafios pessoais nos logs; navegação/erro local distinguidos de requisição efetiva e assinatura confirmada.

### PLAT-008 e PLAT-009 — Pendência, concorrência e histórico

O formulário reenviado pode excluir registros `pending` correspondentes por CPF/e-mail e inserir outro ID. Isso explica cadastros refeitos, mas não comprova expiração do link nem conserva todos os valores anteriores.

Proposta: correção versionada do mesmo cadastro e reenvio controlado de token; não fundir pessoas diferentes por conflito de e-mail/CPF. Tratar conflitos únicos pelos índices esperados e reler o estado antes de declarar o resultado; não mascarar qualquer `23505` como sucesso. Preservar o resultado correto durante envio simultâneo e falhas de entrega.

### PLAT-010 a PLAT-012 — Revisão, nomes e documentos

A revisão humana continua no SQLite local. Rejeição é recuperável; nenhuma decisão local deve alterar automaticamente a VPS. Novos dados e regras não substituem decisões manuais. Mudança substantiva de nome/ordem/CPF sinaliza somente o registro afetado, com evidência anterior preservada.

Definir aplicação das decisões e eventual nome de exibição antes de corrigir em lote. Preservar nome originalmente informado, evidência da comparação, CPF em hash e horários. As prévias já geradas são snapshots e mantêm os nomes do aplicativo; não equivalem a documentos finais enviados. Regenerar versões após consolidação, sem renumerar assinaturas ou modificar documentos já assinados/enviados.

Antes do envio oficial, verificar configuração efetiva de destinatários, assinatura e validador. Essas condições não foram rechecadas nesta pesquisa e não devem ser presumidas resolvidas. Nenhum envio autorizado por este registro.

### PLAT-013 — Equivalência de e-mails

`dedupEmail()` remove pontos somente em `gmail.com`/`googlemail.com`, o que não deve ser generalizado para domínios próprios/Workspace. Mantém a grafia digitada para entrega; a forma canônica é usada no hash de deduplicação. Endereços institucionais com/sem pontos podem ser pessoas diferentes.

A função também remove `+etiqueta` de todos os domínios. Revisar essa hipótese por provedor e separar endereço de entrega, endereço verificado e chave canônica. Não alterar hashes existentes cegamente: avaliar compatibilidade, colisões e migração/versionamento antes da mudança. Domínios ou provedores em comum nunca bastam para vincular contas.

### PLAT-014 e PLAT-017 — Informação ao usuário e ciclo de vida dos dados

Os avisos preservados afirmam que respostas cadastrais não são gravadas em cache, enquanto a aplicação publicada conserva respostas da API criptografadas por 30 dias. Isso precisa de decisão explícita de compatibilização. A autorização do texto de correção de nome não aprova automaticamente mudanças nos demais avisos.

Mapear também os dados derivados: cache da aplicação, consultas históricas, SQLite de revisão, CSVs, snapshots e backups. A limpeza de uma tabela de cache não remove esses outros arquivos. Definir retenção por finalidade e descarte verificável, preservando evidência e backups enquanto necessários e autorizados. Nunca alterar o `HASH_PEPPER` para tentar resolver retenção ou duplicidade.

### PLAT-015 e PLAT-016 — Cobertura e dados indisponíveis

O grupo de recuperação concluído tem 11.214 CPFs: 11.210 retornos cadastrais e quatro “não encontrado”. Esse resultado privado da API não prova inexistência do CPF na Receita.

Assinaturas posteriores podem ter dados da API vinculados pelo hash e ainda não ter número de CPF recuperado na cópia local. O aplicativo não mantém esse número em claro. A sincronização sinaliza a ausência; não inventa o número nem faz consultas pagas ou recuperação criptográfica por conta própria.

### PLAT-018 — Publicação e testes cumulativos

A aplicação local contém alterações ainda não publicadas do painel. Preparar release mínimo sobre a versão realmente em produção, com manifesto, backup, testes cumulativos, compilação, smoke tests e rollback de código. Não restaurar banco antigo sobre novas assinaturas legítimas durante rollback.

Na avaliação de duplicidade e na pesquisa de autenticação, o usuário pediu diagnóstico antes de modificar. A publicação principal permanece pendente de fechamento do escopo. Não confundir a ativação da ferramenta local de revisão com deploy da aplicação pública.

## Entregas relacionadas já concluídas

- **Cache cadastral da aplicação:** retenção criptografada de 30 dias publicada; segredo separado do pepper; comparação refeita a cada tentativa; sem conservação permanente de aprovações/recusas no cache.
- **Coleta complementar:** grupo de 11.214 concluído; arquivos finais conferidos e baixados para `/mnt/dev/cpfs/complemento-20261106T115500Z/resultados-1793974882834295607`.
- **Recepção contínua da revisão:** serviço local `peticao-cpf-review-sync.service`, a cada 30 segundos, com PostgreSQL em `READ ONLY`, sem escrita remota ou chamadas pagas. Página atualiza após recebimento e pausa a troca de linhas durante interação.
- **Preservação das decisões:** migração local `name-cpf-v3`, 21 testes aprovados, integridade SQLite e preservação de decisões/históricos conferidas. Caixa, acentos, partículas, dados complementares, categoria e mudança de regra não reiniciam a revisão. Evidências anteriores permanecem versionadas.
- **Documentação do receptor:** `/mnt/dev/peticao/tools/cpf-review/LEIAME.md`. Backups privados em `/mnt/dev/cpfs/backups/`.

## Histórico cronológico de decisões — 06/11/2026

1. Solicitadas regras automáticas de nome com menor fricção e sem aprovação administrativa caso a caso.
2. Autorizada implementação/testes/publicação; mantido desafio nascimento ou mãe para brasileiros no WhatsApp. Preparação ocorreu em desenvolvimento.
3. Identificada necessidade de fallback para confirmação de pendentes antigos; texto explicativo aprovado.
4. Solicitada ampliação de tentativas/preenchimentos para 30 dias; apresentada coleta opcional e explícita; aprovação desse escopo ainda pendente.
5. Diagnosticada resposta enganosa nas duplicatas; responsável pediu avaliação antes de modificar.
6. Solicitado e concluído receptor VPS → SQLite local, preservando decisões e sem escrita no banco do servidor.
7. Proposta correção autenticada de apoiador para servidor, mantendo registro e datas; vínculo profissional não se confunde com identidade CPF.
8. Solicitada pesquisa ampla para “Verificar/Corrigir minha assinatura”, com acesso público seguro, alternativas e recuperação de conta; estudo em documento vinculado.
9. Confirmada a distinção entre endereço para entrega e forma usada na deduplicação; registrada generalização indevida de `+etiqueta` para revisão.

## Como manter este histórico

Atualizar o estado de cada ID e acrescentar decisões datadas, evidências de testes e identificador de deploy quando houver publicação. Preservar a descrição dos problemas anteriores. Fechar um item somente depois de validar o comportamento no ambiente correspondente. Não registrar uma preferência como autorização de implementação/publicação.

## Instrução para a próxima resolução via PlanMode — 06/11/2026

Por solicitação expressa do responsável, conservar a proposta de **“Verificar/Corrigir minha assinatura”** e apresentá-la **completa**, não apenas em resumo, quando ele solicitar a resolução destas pendências via **PlanMode**.

A proposta integral está em `/mnt/dev/peticao/docs/ACESSO-E-CORRECAO-DE-ASSINATURAS.md`. Na retomada, ler este histórico e o estudo, apresentar o conteúdo integral da proposta com alternativas, vantagens, desvantagens, recuperação de acesso, migração dos cadastros antigos e decisões ainda necessárias; em seguida, elaborar o plano de resolução cumulativo das pendências relacionadas.

Incluir no planejamento a correção autenticada de apoiador para servidor, a resposta de duplicidade, a distinção entre conferência cadastral e autorização de edição, a preservação de registros/datas/histórico e a revisão da normalização dos e-mails. Este registro não autoriza implementação ou publicação automática das alternativas ainda não decididas.
