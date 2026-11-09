# Etapa 06 — verificação de metadados do documento

## Origem e critérios aprovados

O pedido original (`LOG-2026-11-04-planejamento-admin-v2.md`, item 1.8 e linhas 154–156) prevê hash e QR de verificação no PDF. Ele não torna automaticamente públicos os PDFs, os dados de pessoas ou as variantes anteriores. O principal aprovou, antes da implementação, dois controles: ativação global desligada por padrão e liberação explícita Total/stepup por UUID/hash. Também aprovou whitelist sem PII/binários, identidade da versão imutável exata já aprovada e `onlineValidationPerformed=false`.

Esta unidade implementa o backend e a API JSON desses critérios. Não cria uma interface, aviso, objeto QR, carimbo ou novo PDF, nem modifica bytes anteriores. O gerador de URL não gera uma imagem QR e não insere nada em documentos. Nenhum controle foi ativado em ambiente real e nenhum registro real foi liberado.

## Dois controles e vínculo exato

1. `DOCUMENT_VERIFICATION_PUBLIC` precisa ser exatamente `1`. Ausente ou qualquer outro valor mantém a consulta fechada antes de buscar o banco.
2. `setDocumentPublication` exige conta Total ativa, sessão vigente, confirmação extra e revisão CAS. Grava uma autorização para aquele UUID/hash em `settings`, com auditoria atômica. Não existe rota pública de escrita nem interface/CLI de ativação nesta unidade. Desabilitar exige revisão atual; falha da auditoria não libera o registro.

A consulta exige o último evento de liberação correspondente à revisão, UUID e hash atuais. Alterar diretamente uma configuração, ou restaurar uma revisão anterior após revogação, não corresponde ao evento mais recente e não reabre a consulta.

A elegibilidade exige uma versão da tabela imutável, cujo hash é recalculado a partir dos bytes armazenados. A variante deve ser a realmente selecionada pelo envio: assinada se existente, original em caso contrário. Os bytes, a lista e os hashes atuais do lote devem coincidir; não pode existir versão posterior daquela variante. A captura deve anteceder a aprovação, cujo timestamp precisa ser ISO canônico. O lote deve ter `approved_at`, estado compatível e exatamente um evento `batch_approved`, com `documentVersion` calculada pelo contrato existente e `sentSha256` iguais à revisão/binário atuais. Aprovação ausente ou ambígua, documento alterado/cancelado e rascunho não passam. Um recibo de confirmação própria não substitui essa aprovação.

Aprovar um envio não autoriza publicidade por si só. A liberação administrativa explícita continua necessária. O backend não inicia transporte, provider de identidade, validador ICP ou serviço de assinatura.

## Whitelist e URL

`GET /api/documentos/verificar/[versao]?sha256=<hash>` devolve apenas UUID da versão, SHA-256, tamanho dos bytes, variante, indicador de aprovação registrada e classificação registrada da assinatura, acompanhada de `onlineValidationPerformed:false`. Classificação desconhecida vira `unknown`; notas e textos externos não entram na resposta. Nenhum nome, CPF, email, autor, destinatário, assinatura individual, timestamp, lista, auditoria bruta ou binário é retornado. Não há endpoint de download público.

O endpoint usa JSON/no-store/nosniff/noindex, limite por IP e 404 com o mesmo corpo `{ok:false}` para controle desligado, liberação ausente/revogada, IDs/hashes inválidos ou vínculo não comprovado. O limite de taxa responde 429. Falhas do banco também fecham a consulta, sem expor detalhes.

`documentVerificationUrl` recebe uma origem HTTPS configurada, UUID e hash. Rejeita credenciais, path/query/fragment, portas alternativas e endereços locais/IP; constrói caminho fixo e parâmetro escapado. Não usa Host ou forwarded headers da requisição e não faz requisições de rede. Não se considera a URL uma autorização independente dos dois controles.

## Provas e limites

Comando isolado: `python3 tools/admin-qa/batch-local.py --tests verification`. Cinco casos novos cobrem controles desligados, liberação explícita, whitelist, autoria/sessão/stepup/CAS, revogação, rollback da auditoria, settings forjados, aprovação divergente/ambígua, bytes/lista/revisão alterados, URL segura e rota JSON. São acrescidos aos 62 casos anteriores, em PostgreSQL temporário próprio e com identidades/documentos fictícios, sem envio externo. O runner preserva os hashes dos fontes e executa também o checker aditivo existente, sem DDL nova nesta unidade.

Evidências finais: `.cache/qa-document-verification-20261109/`, com origem, fontes e logs. A classificação histórica registrada não é validação online de ICP-Brasil ou gov.br, e a API não certifica identidade de pessoas. Não houve ativação pública, servidor publicado, PDF modificado ou build global. UI externa, representação da confirmação e QR no PDF continuam sujeitos aos textos e decisões pendentes do principal/dono.

Rollback de código não remove histórico nem liberação armazenada; remover o controle global de ambiente mantém a API fechada. A função de revogação permanece uma ação administrativa explícita/auditada. Não alterar registros reais, DDL, credenciais ou documentos como parte do teste.

Resultado final executado: **67/67**, zero falhas/cancelados/ignorados, saída 0; checker aditivo de 19 tabelas PASS. Tipos dirigidos: três raízes e 577 arquivos importados, zero diagnósticos. Origem: `/tmp/admin-batch-local-u9i357h0/`. A primeira checagem de tipos detectou TS2345 no parâmetro de UUID da fixture (inferência de template literal); a anotação foi corrigida para string e a bateria completa repetida sobre a fonte final. O log inicial também foi preservado para rastreabilidade.
