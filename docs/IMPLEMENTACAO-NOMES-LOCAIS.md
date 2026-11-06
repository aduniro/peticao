# Implementação da revisão de nomes — 06/11/2026

Prioridade 1: consolidar nomes para impressão **localmente**, mantendo independentes
as decisões nome×CPF e nome de impressão. Originais digitados/API são imutáveis.

## Etapas e preservação

1. Ponto de partida registrado no commit `f432311`; nenhum export de assinantes,
   SQLite ou segredo deve entrar no Git.
2. Backup consistente: `/mnt/dev/cpfs/backups/nomes-20261106T160644Z/revisao.sqlite`.
   Continha 39 decisões manuais; novas decisões legítimas continuam sendo recebidas.
3. Dicionário público curado, observações locais privadas e sugestões versionadas,
   com ambiguidades e proveniência explícitas. Não é recuperação determinística.
4. Tabelas aditivas de decisões/histórico de nomes e lotes, sem reutilizar as
   colunas de decisão CPF. Previews congelados, concorrência e desfazer auditados.
5. Editor com alternativas/literal/instrução, ações por categoria e prévia PDF
   local. Fonte VPS continua somente leitura; exportador inclui campos públicos
   necessários para futuras listas. Não modifica a aplicação pública.

## Decisões confirmadas no planejamento

- Política híbrida de acentos: preservar variantes plausíveis; erro provável
  pode ter sugestão documentada, nunca substituição já aprovada sem revisão.
- Mais completo significa palavras relevantes, sem mesclar nomes. Casos
  especiais são individuais; empate favorece o digitado.
- IA interpreta instruções em lotes nesta conversa, sem API externa integrada.
- Recusa do nome não recusa CPF. Nova prévia exige nome aprovado e atual.
- Preservar todos os originais, versões, IDs, inscrição e horários.

## Sequência posterior de pendências

Após validar a prioridade 1: revisão humana restante e prévia dos lotes; fechamento
dos CPFs sem retorno/número; validação cumulativa das regras e fallback já em dev;
coleta opcional de rascunhos por 30 dias (consentimento específico aprovado no plano,
sem CPF em claro/nascimento/mãe digitados); duplicidade/resposta verdadeira;
normalização de e-mail e retenção; discrepância nos avisos de privacidade;
consolidação final e preparação de release mínimo sobre produção.

A última etapa é **Verificar/Corrigir minha assinatura**. A escolha atual substitui
a preferência inicial do estudo: login por e-mail+senha ou nome+CPF+mesma senha;
senha inicial aleatória enviada ao e-mail confirmado, sem expiração nem troca
obrigatória. URL fixa sem senha no link. Recuperação confirma e-mail com autorização
curta de uso único e permite definir nova senha, revogando a anterior somente após
concluir. Nome/CPF e dados biográficos não autorizam alterações sozinhos.

Mudanças de categoria/dados exigem confirmação pelo canal previamente confirmado;
WhatsApp só aparece quando configurado e com número confirmado. Apoiador que é
servidor pode manter e-mail pessoal; declaração profissional e confirmação
institucional são distintas. Não reutilizar tokens públicos de cartaz/QR para editar.
Preservar IDs, inscrição e datas originais; alteração de e-mail exige fluxo reforçado
e recuperação assistida quando os canais forem perdidos. Interface segue visual
Admin-2, com autenticação separada. Nenhuma dessas pendências está concluída apenas
por constar deste documento.

## Atualização normativa posterior

A escolha anterior de empate favorecendo o digitado foi substituída por instrução
expressa: API completa por padrão; digitado apenas com nomes completos adicionais,
sem contar espaços indevidos ou iniciais. Ver `docs/POLITICA-CENTRAL-NOMES.md`.
Validação estrita e exceção controlada de casamento seguem política própria,
sem alterar decisões CPF nem confundir proposta de impressão com prova de identidade.
