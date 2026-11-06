# Política central de nomes para impressão

Determinada expressamente pelo responsável em 06/11/2026. Fonte normativa única:
`site/src/content/name-print-policy.json`. Aplica-se à seleção do nome para
impressão, independentemente do aceite de identidade/CPF.

1. A preferência é **sempre pelo nome completo retornado pela API**, com sugestão
   de acentuação. Omissões, abreviações e nomes do meio ausentes no formulário não
   encurtam o nome de impressão.
2. A única exceção preferencial é o nome declarado com **nomes completos
   adicionais**. Conservar a versão mais extensa, sugerindo correções apoiadas na
   API e acentos, com revisão individual das diferenças. Uma inicial não conta
   como um nome completo adicional.
3. Incluir nomes do meio e partículas — de, do, dos, das e variantes. Toda
   partícula retornada pela API é obrigatória no nome impresso, mesmo que o usuário
   a tenha omitido ou digitado outra partícula naquela posição. Partículas do nome
   digitado podem ser aproveitadas somente com alinhamento inequívoco aos mesmos
   nomes. Nunca inventar partículas nem sobrenomes ausentes de ambas as fontes.
   Não fundir nomes de pessoas distintas.
4. Divergências maiores exigem revisão do responsável e notificação por e-mail;
   não entram em aceite automático. Uma notificação não constitui aprovação.
5. Conservar nome digitado e retorno original da API. A política não altera CPF,
   hash, número de inscrição, horários ou decisões anteriores de CPF.
6. Escolhas de impressão antigas incompatíveis com esta política devem ser
   sinalizadas para nova revisão, com histórico preservado. Não substituir
   silenciosamente uma decisão administrativa. Nomes já aprovados e compatíveis
   permanecem aproveitáveis.

API e dicionário não demonstram sozinhos a grafia civil de cada acento. Casos
ambíguos continuam disponíveis para decisão do responsável. Estrangeiros sem
consulta CPF utilizam o nome declarado, com conferência própria.

## Implementação compartilhada

- Política e dicionário público em `site/src/content/`.
- Aplicação: `site/src/lib/name-print-policy.ts`.
- Revisão local: `tools/cpf-review/name_policy.py` e `name_dictionary.py`.
- O caminho anterior `tools/cpf-review/name-corpus.json` aponta para o dicionário
  central, mantendo compatibilidade enquanto a revisão está aberta.

A regra anterior que favorecia o nome digitado em empate foi substituída.
Notificações de produção serão configuradas sem enviar e-mails reais nos testes
nem alterar o pipe somente leitura de dados da VPS.

## Validação de cadastro: grafia estrita, sem reparos

Instrução posterior do responsável: `site/src/content/name-validation-policy.json`
é a política central de **validação**, distinta da proposta de nome de impressão.
Cada palavra digitada deve corresponder a palavra completa da API, na ordem,
normalizando acentos/caixa e ignorando as partículas declaradas nessa política.
Não há distância de edição, aceitação de typo, inicial, palavra extra, colagem ou
separação indevida. Pontuação não cria um espaço que o usuário deixou de digitar.

Assim, `Sant Ana` não valida contra `Santana`, nem nomes colados contra palavras
separadas. O resolvedor de **impressão** pode sugerir `Santana` com apoio na API;
essa sugestão não autoriza a identidade. Nascimento/mãe corretos não compensam
incompatibilidade do nome. Omissões continuam no fluxo anterior: palavras completas
em ordem, âncora exigida e desafio adicional; a impressão usa o nome cadastral
completo. Hífens podem separar componentes de um nome/sobrenome composto, mas todos os componentes devem ter grafia exata em relação à API.

Nenhum cadastro antigo é modificado ou revalidado retroativamente por essa mudança
de código. O deploy permanece sujeito à aprovação final da integração.

### Correção posterior: mudança de sobrenome por casamento

A instrução foi completada pelo responsável: inclusão ou substituição de sobrenome
após casamento é exceção controlada. Não deduzir casamento de qualquer diferença
nem aprovar um typo com essa justificativa. Preparar declaração explícita,
conferência adicional de identidade e revisão/notificação ao responsável; o
registro da exceção não equivale a correspondência nominal exata da API.
Compostos como Brum-Bittencourt permitem hífen/espaço entre componentes com
grafia idêntica; palavras coladas ou partidas dentro de um componente não passam.
O fluxo específico da exceção deve integrar o candidato e seus testes antes de
qualquer publicação. O validador estrito não concede essa exceção silenciosamente.
