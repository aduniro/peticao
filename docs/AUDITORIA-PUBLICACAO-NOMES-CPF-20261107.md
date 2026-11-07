# Auditoria de publicação: nome/CPF e resolvedor

Conferência em 07/11/2026. Datas abaixo no fuso de Porto Velho (UTC−4), salvo indicação expressa. Inspeção somente leitura da VPS, comparação de hashes, histórico Git, pedidos desta conversa e registros de publicação. Nenhuma assinatura, regra ou configuração remota foi alterada.

## Conclusão

A validação estrita por quantidade de palavras está publicada. O resolvedor do nome de impressão não está publicado nem integrado à geração oficial dos PDFs. Há outros fluxos locais relacionados à conferência de cadastros antigos que também não estão na VPS. Não é correto dizer que todo o backend combinado já está em produção.

## Linha do tempo e situação atual

| Registro local | Pedido/alteração | Situação comprovada |
|---|---|---|
| 06/11, 12h06 — `f432311` | Checkpoint que já contém recuperação/conferência de confirmação antiga e histórico de tentativas por 30 dias | Código local; esses dois comportamentos não estão publicados. A data é do checkpoint, não prova de quando cada trecho foi originalmente escrito. |
| 06/11, 12h40 — `f0371d5` | Acesso do assinante e mudanças de perfil mediante confirmação de e-mail | Implementação local separada; não confundir com recurso já disponível na VPS. |
| 06/11, 13h45 — `677c2d3` | Recusa de erros de grafia e de fronteiras das palavras, com equivalências de compostos | Evoluiu para a regra posterior v6, atualmente publicada. Não reaplicar a versão anterior por ser um commit ainda visível no histórico. |
| 06/11, 13h45 — `16ceb95` | Priorizar nome completo da API, acentuação e distinguir sobrenome adicional de espaço indevido | Resolvedor local/revisão local; ausente na aplicação publicada. |
| 06/11, 14h36 — `f77b041` | Partículas retornadas pela API obrigatórias no nome impresso | Implementado na política e no resolvedor locais; ausente do fluxo oficial de PDF na VPS. |
| 06/11, 15h23 — `4e58c50` | Validação por quantidade de palavras, grafia exata e identidade adicional para correspondência parcial | Publicada. Os arquivos atuais coincidem com o local; a versão `2026-11-06.count-based-exact-name-v6` também está no build em execução. |
| 07/11, 13h56 — publicação de diagnósticos | Novos registros técnicos de cadastro e retenção própria | Publicada, preservando a regra nominal existente; não publicou o resolvedor. |
| 07/11, 14h23 — publicação de interação dos formulários | Foco, avisos e isolamento de categorias | Publicada; pacote de cinco arquivos, sem atualização das regras nominais do backend. |

A v6 já constava no snapshot da fonte publicada `e0f54e2`, registrado em 06/11 às17h33, e no snapshot `0483a20` de 07/11. Isso comprova sua presença nesses pontos; não determina a hora exata da primeira publicação. Na conferência atual, o marcador v6 aparece em `.next/server/chunks/8084.js`. O marcador do resolvedor `2026-11-06.api-particles-mandatory-v3` não aparece no build.

Um registro antigo em `.cache/cpf-name-candidate/validation.json` diz `published:false`; seu diretório remoto está em `backup_ready`. Ele descreve aquela tentativa antiga e não prevalece sobre as capturas posteriores e o build atual. Esse é um exemplo de por que a data e a evidência de execução precisam ser consideradas juntas.

## O que o backend publicado efetivamente exige

- API com duas palavras relevantes: duas correspondências; três: pelo menos duas; quatro: pelo menos três; cinco ou mais: pelo menos três.
- Todas as palavras fornecidas precisam corresponder exatamente, na ordem, a palavras da API. Acentos e caixa são normalizados; `de`, `da`, `do`, `das`, `dos` e `e` não são contados.
- Iniciais, grafia aproximada, palavras coladas/partidas, palavras extras e os termos proibidos são recusados. Apóstrofos e componentes de compostos separados por hífen/espaço têm tratamento próprio.
- Correspondência parcial exige conferência adicional de identidade. Acertar nascimento/mãe não supera incompatibilidade do nome.
- Apoiadores passam pela consulta nominal antes do desafio de nascimento/mãe; indisponibilidade não vira aprovação.

Os módulos `cpf-name.ts`, `cpf-check.ts` e `name-validation-policy.json` foram comparados por SHA-256 entre a VPS, o principal local e o candidato admin-v2. São iguais. Diferenças em `identity.ts`, `sign-flow.ts` e `signatures.ts` precisam ser analisadas semanticamente: parte corresponde a diagnósticos já publicados, parte a recursos locais diferentes; um hash diferente sozinho não demonstra regra nominal pendente.

## Pendências encontradas

### 1. Resolvedor e nome oficial do PDF

Os arquivos `name-print-policy.ts`, `name-print-policy.json` e `name-dictionary.json` existem no principal local, mas não na fonte da VPS nem no candidato isolado do admin-v2. A ferramenta local de revisão usa sua própria integração Python.

Além da ausência na VPS, o helper TypeScript local não é chamado pelos escritores de assinatura ou pelo PDF: suas referências atuais são o próprio módulo e testes. Portanto, copiar os arquivos e publicar não basta.

Hoje o cadastro grava `input.name` em `signatures.name`, após a formatação do formulário. A consulta dos lotes lê essa coluna e o PDF imprime `r.name`. Não há substituição automática pelo nome completo da API nem inserção garantida das partículas da API. Essa exigência central continua pendente de integração, incluindo preservação do nome declarado, retorno original, decisões de revisão e documentos anteriores.

### 2. Cadastros antigos ao confirmar

O principal local possui `confirmation-check.ts`, chamado pelas rotas locais de confirmação. Ele prepara conferência do CPF correspondente ao hash e correção controlada do nome, com prova do estado original e desafio quando necessário.

A rota publicada `/api/confirmar` chama `confirmFull` diretamente, sem esse gate. A regra nova de cadastro não equivale a revalidar automaticamente todas as confirmações antigas. O fluxo de recuperação não foi publicado.

O tratamento local também reforça o desafio de identidade no WhatsApp. Na versão publicada, a chamada adicional depende de `identityMode()==="required"`; não afirmar que o backend a força independentemente desse modo. Esta auditoria não habilitou WhatsApp.

### 3. Exceção de sobrenome por casamento

A política JSON descreve declaração explícita, identidade adicional e revisão. Entretanto, o validador rejeita palavras extras e não existe fluxo executável de declaração/revisão ligado a essa exceção. Está pendente de implementação; não é um pacote pronto que apenas esquecemos de publicar. A ausência de tolerância automática evita tratar qualquer erro de grafia como casamento.

### 4. Notificação das divergências maiores

`tools/cpf-review/name_alerts.py` mantém uma fila local, mas declara `email_sent=0` e `delivery=not_enabled_before_deploy`. Não é remetente. Falta integrar a entrega de alertas ao responsável e testar autoria, deduplicação e retomada. Não há esse envio automático de produção pelo resolvedor.

### 5. Registro do método de identidade

Há uma diferença local relacionada à evidência da verificação: o principal dá precedência a `extra.identityMethod`; na VPS um domínio institucional pode substituir esse método por `email_institucional`, mesmo quando o fluxo precisou do desafio adicional. A correção local de precedência não está publicada. Isso é distinto de alterar a comparação nominal.

### 6. Histórico de tentativas versus cache

O cache de consulta de 30 dias, incluindo nome/nascimento/mãe/sexo, já está publicado. Os diagnósticos novos também têm retenção própria de 30 dias. Já `identity_attempts` continua com limpeza de registros acima de sete dias na VPS; o principal local contém extensão para30 dias. São três mecanismos diferentes, não uma única configuração.

## Registro das solicitações e próxima sequência

Esta conferência retoma os pedidos desta conversa sobre preferência pelo nome integral da API, partículas obrigatórias, sobrenomes adicionais, divergências por e-mail, casamento, validação quantitativa e correção de confirmação antiga. Aprovação dos textos e autorização de um pacote anterior não significam que todos esses recursos foram publicados.

O admin-v2 continua prioritário. Seu primeiro candidato essencial está validado no commit `94c9cc0`, com471 testes, build/tipos/migração e100 cenários de navegador, mas preserva o backend nominal publicado; não resolve silenciosamente as pendências acima. **Sem deploy sem permissão explícita.**

A auditoria dos formulários estrangeiros foi registrada na fila como `auditoria-estrangeiros-cpf`. Será análise separada, sem regra nova nas versões do app. Usará a base já disponível e consultas de CPFs já existentes nesse conjunto; não buscará CPF de terceiros apenas pelo nome. Comparação nominal exploratória não será tratada como identidade confirmada. Relatório será enviado somente ao dono em HTML.

Evidência técnica: `.cache/admin-integration/name-policy-audit-20261107.json`, snapshots citados, registros remotos de publicação e fontes/Git mencionados. Nenhuma chamada real à API de CPF ou alteração de assinantes foi feita nesta auditoria.
