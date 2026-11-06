# Auditoria da interação dos formulários

Data: 06/11/2026. Estado: diagnóstico; nenhuma alteração do aplicativo ou publicação nesta etapa.

## Conclusão

A última correção excedeu o pedido: suprimiu a apresentação de todas as sugestões e explicações de e-mail, em todas as categorias, para eliminar um exemplo inadequado de Gmail no formulário de servidor. Também substituiu mensagens de situações diferentes por “E-mail inválido”. Isso retirou informação que o usuário havia solicitado expressamente ao Claude.

Os diagnósticos, sugestões e textos não foram apagados do backend ou dos arquivos de tradução: deixaram de ser renderizados. O problema principal está na apresentação em `site/src/components/SignForm.tsx`. Não há justificativa para restaurar toda a aplicação antiga ou desfazer as novas regras de nome/CPF para recuperar essa interação.

## Evidências consultadas

- Históricos JSONL das três sessões em `/home/barre/.claude/projects/-mnt-dev-peticao/`, com extração das mensagens do usuário pertinentes à interação. Foram separados pedidos reais de resumos automáticos, notificações e instruções de ferramentas. Mensagens duplicadas entre sessões foram consideradas uma vez.
- Commits `2d93f3e` (v1), `e705bda`/`c9a6cf1` (política de diagnóstico de e-mail), `9784afe` (merge do Claude), `67e6ed4` (avisos e modais), `952d0ca` (tratamento de rede) e `15992ac` (última alteração de blur/dicas).
- Formulário, máscaras, geografia, modais, traduções, diagnóstico/sugestões de e-mail e contrato de `/api/email/validar`.
- Leitura da fonte efetivamente em execução na VPS, sem configuração ou credenciais. SHA256 do `SignForm.tsx`: `5caa0a2b65c507804c66a6ea0ac8b5471319fad38fe173cccc6559c91dd37857`. Confirmados: botão de sugestão ausente, lista de provedores ausente, erro genérico presente e modal institucional ainda existente.
- Não foram feitos envios a assinantes, consultas pagas à API de CPF, alterações de serviço ou testes que escrevem no banco.

## O que o usuário havia pedido ao Claude

Os horários abaixo são os do histórico, em UTC.

1. **29/10, 16:58:** desafio de identidade, por nascimento ou mãe, ao clicar em Assinar para os casos previstos; não abrir esse desafio ao simplesmente sair de um campo.
2. **03/11, 09:35:** janela de confirmação de envio do e-mail após submeter a assinatura, com orientação sobre Spam.
3. **03/11, 22:19:** e-mails institucionais cadastrados não devem ser usados no formulário de apoiador; avisar para usar Servidor.
4. **04/11, 00:33:** destacar o campo de e-mail com erro; distinguir e-mail institucional inválido; mostrar dicas de provedores para apoiadores quando pertinentes. Testar localmente antes de publicar.
5. **05/11, 14:46:** política central que identifica o erro, apresenta correção e ajuda a digitar; “Você quis dizer…?” para provedores e domínios conhecidos, inclusive IFC e domínios aprovados manualmente na plataforma.

As instruções posteriores deste chat refinaram esse comportamento: não induzir servidor a usar Gmail, não abrir modais no blur, manter erro/borda vermelhos, preservar o preenchimento e reunir erros do envio em um único modal. Elas não autorizaram apagar indiscriminadamente sugestões corretas de outras categorias.

## Como a interação funcionava antes das minhas alterações recentes

| Situação | Comportamento anterior encontrado no código |
|---|---|
| Pessoa digita e-mail e sai do campo | Normalização e diagnóstico de sintaxe; consulta remota nos casos aplicáveis. Erros e orientações aparecem junto ao campo, sem modal de validação automático no blur. |
| Domínio parece digitado errado | Exibe “Você quis dizer…?” e endereço sugerido. |
| Pessoa aceita a sugestão | Botão “Usar este” preenche o e-mail sugerido e o revalida. Não corrige silenciosamente. |
| Erro de estrutura/provedor | Pode mostrar o que está errado, a correção e um exemplo. Essas explicações foram implementadas pelo Claude a pedido do usuário. |
| Provedor inválido no formulário de apoiador | Mensagem específica e lista de provedores comuns, quando aplicável. |
| E-mail institucional no formulário de apoiador | Aviso específico “Este e-mail é institucional: assine pelo formulário de Servidor.”; após envio, modal “Use o formulário de Servidor”, com ação “Ir para o formulário de Servidor”. |
| Servidor com e-mail pessoal | Aviso para usar institucional ou assinar como apoiador. |
| E-mail inválido/inexistente detectado ao enviar | Modal específico de e-mail; fechamento volta ao campo de e-mail. |
| Envio aceito | Modal de confirmação e orientação sobre Spam. |
| CPF com 11 dígitos e verificador inválido | Erro local e contorno; envio impedido antes de consultar CPF Brasil. |
| CPF incompleto | A condição antiga só avaliava o destaque com exatamente 11 dígitos. A ausência de aviso para CPF incompleto era uma lacuna anterior, não uma regra que precisasse ser preservada. |

O diagnóstico original possuía um exemplo genérico `seunome@gmail.com`, sem conhecimento da categoria. Isso explica a sugestão inadequada no formulário de servidor. O ajuste correto precisa considerar a categoria ao apresentar a orientação, preservando sugestões institucionais e de apoiador que continuam pertinentes.

## O que mudou indevidamente

### 1. Modais passaram a abrir no blur — commit `67e6ed4`

Foram acrescentadas chamadas de `showFieldNotice()` ao `onBlur` e à resposta de `checkRemote()`. Isso ampliou o disparo dos modais além do envio do formulário. O comportamento anterior não exigia essa mudança. Essas chamadas já foram removidas no último deploy; não devem voltar.

### 2. Todas as sugestões de e-mail desapareceram — commit `15992ac`

O trecho que mostrava erros específicos, `explainFix`, “Você quis dizer…?”, “Usar este” e `f.emailProviders` foi substituído por um único texto `f.emailInvalid`.

Essa substituição não foi limitada à categoria servidor nem a sugestões de Gmail. Atingiu também apoiadores, estrangeiros e correções de domínios institucionais. Foi uma ampliação indevida de escopo. Os estados `sugg`/`fix` continuam sendo calculados, mas a interface não os apresenta.

### 3. Situações distintas passaram a parecer o mesmo erro

A API ainda retorna `apoiador_institutional_email`, `server_email_not_institutional`, `email_institutional_invalid`, `email_provider_invalid` e `email_typo`. A interface atual mostra “E-mail inválido” para todos.

Na última imagem, o e-mail pode ser válido e reconhecido como institucional; o problema é a categoria escolhida. A pessoa precisa da orientação de formulário correto que já existia. O modal institucional não foi apagado, mas sua existência após envio não compensa perder a explicação junto ao campo.

### 4. Detalhes do modal de e-mail também foram retirados

O acréscimo de diagnóstico ao modal `bad` foi removido para todas as categorias. Isso foi além de impedir um exemplo de Gmail no formulário de servidor. Sua recomposição deve obedecer às categorias e aos textos que já foram aprovados, sem reinserir a indução indevida.

### 5. Os testes não protegeram o comportamento anterior

O roteiro da correção verificou o erro genérico e a ausência de sugestões em servidor e apoiador. Isso validou a interpretação ampla que eu havia implementado, em vez de comprovar a preservação das sugestões solicitadas anteriormente. Faltou a comparação obrigatória com a interação existente e o caso “institucional no formulário de apoiador”.

## O que não desapareceu e o que permanece incerto

- Os textos `f.emailHintServer`, `f.emailHint`, `f.emailHintForeign`, `inst.*`, `ef.*`, `f.emailProviders`, `f.emailSuggest` e `f.emailUse` continuam disponíveis. Os helpers de diagnóstico e sugestões também permanecem.
- A alteração visual recente de `GeoFields.tsx` acrescentou `aria-invalid` à caixa regional; não mudou as sugestões de instituição, campus, UF ou cidade. As máscaras e o modal de identidade não foram reescritos por esse patch.
- O backend de e-mail não foi modificado pelo pacote `15992ac`, que publicou somente o componente do formulário.
- Não encontrei chamada para limpar nome/e-mail/CPF no caminho de erro do formulário. O erro de rede não tratado era confirmado; uma remontagem/recarregamento da página poderia perder estado, mas não há evidência suficiente para atribuir toda perda relatada a uma causa única. Não vou apresentar essa hipótese como diagnóstico comprovado.
- A dica antiga do apoiador “Se usar o e-mail institucional, a assinatura é mais rápida” ainda existe e entra em tensão com a regra posterior que encaminha institucional para Servidor. É uma inconsistência herdada, não uma autorização para substituir todos os avisos por erro genérico. Qualquer revisão desse texto deve ser apresentada ao responsável.

## Alterações solicitadas que devem permanecer

1. Regras de nome/CPF e label “Nome Completo” explicitamente aprovados; não desfazer regras de backend para recuperar dicas.
2. Mensagem curta de nome aprovada, sem ensinar detalhes sobre partículas ou os mínimos de correspondência.
3. Contorno vermelho e aviso junto aos campos inválidos, inclusive quando estão focados.
4. CPF incompleto/inválido destacado após sair do campo, sem modal nesse momento.
5. Modais de validação somente após Assinar; um único modal para os erros daquela tentativa, com foco no primeiro campo incorreto de cima para baixo.
6. Preservação do preenchimento em falhas; tratamento de rede e liberação da nova tentativa, sem reenvio automático.
7. Ajuda, sugestões úteis e comportamentos de categorias anteriores preservados, salvo a alteração específica solicitada.

## Recomposição delimitada a preparar depois deste relatório

- Recuperar da versão anterior os blocos de orientação, sugestões e “Usar este”. Não voltar o componente inteiro, pois isso perderia correções autorizadas.
- Filtrar a apresentação por categoria: servidor recebe orientação institucional e sugestões institucionais pertinentes; apoiador mantém correções de provedores quando cabíveis; estrangeiro mantém orientação de universidade/país.
- Manter “E-mail inválido” como alerta curto para sintaxe/provedor realmente inválido. Não esconder o motivo específico de categoria incorreta. Preservar dicas úteis fora da mensagem vermelha genérica e sem fornecer exemplo incompatível com a categoria.
- Restaurar o aviso e a ação já existentes para e-mail institucional no formulário de apoiador, respeitando a regra atual de não abrir modal no blur.
- Não modificar automaticamente o domínio, não trocar categoria sem ação do usuário e não sugerir instituição ou provedor sem evidência suficiente.
- Testar a matriz anterior e a atual: estrutura inválida, domínio incompleto, provedor digitado errado, instituição digitada errado, institucional em apoiador, pessoal em servidor, estrangeiro, blur, envio, erros simultâneos, foco e preservação dos dados.
- Comparar o candidato com a produção e com os commits de referência antes de qualquer publicação. Não alterar textos adicionais, políticas cadastrais, consentimentos, cache ou painel administrativo por conveniência desta correção.

## Regra de execução registrada

**Alterar apenas o comportamento solicitado. Tudo que já existe permanece por padrão.** Antes de editar a interação, identificar o pedido, o fluxo anterior, o trecho exato que mudará e os cenários que devem continuar iguais. Mudanças em avisos/informações ao usuário precisam de autorização específica, salvo o texto exato já aprovado. Teste deve provar também a preservação do que não foi pedido para mudar.

Este relatório não declara o formulário corrigido. Aplicação, deploy e integração do admin permanecem parados nesta etapa; foram realizadas somente leitura, documentação e envio do diagnóstico ao responsável.
