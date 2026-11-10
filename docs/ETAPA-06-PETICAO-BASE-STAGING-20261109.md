# Petição-base gov.br: armazenamento privado, ainda pendente de validação

Este incremento não comprova assinatura gov.br. Acrescenta recepção privada e imutável de PDF, intenção idempotente, leitura do arquivo exato e auditoria; o upload sempre retorna `validationState: pending` e `usableInPackage: false`. O contrato de pacote v2 recusa esse estado.

## Arquivos e fluxo

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/petition-base-schema.ts`: duas tabelas aditivas e proteção UPDATE/DELETE/TRUNCATE.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/petition-base-store.ts`: gate `GOVBR_BASE_ENABLED` desligado por padrão; Total, sessão ativa e confirmação extra; UUID de intenção capturado antes dos awaits; cópia dos bytes; replay retorna o mesmo artefato e conteúdo diferente com a mesma intenção é recusado.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/admin/documentos/base/route.ts`: upload multipart limitado antes do parsing, apenas file/requestId; nome original não vira caminho nem registro. Nenhum parâmetro pode atribuir validade.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/admin/documentos/base/[id]/route.ts`: download privado Total/stepup, bytes e SHA conferidos, attachment com nome fixo, no-store e nosniff. Sem rota pública.

## Provas atuais e limites

Rascunho recebeu 7 testes PostgreSQL/NextRequest, todos aprovados, e tipos estritos. Evidência local: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/govbr-base-draft/result.json`. A integração no candidato exige seu próprio reteste e ensaio de schema.

Ainda faltam verificação criptográfica gov.br vinculada ao titular e documento/petição corretos, promoção por prova confiável, seleção ativa versionada, snapshot dos dois anexos, integração ao envio e interface aprovada. Não aceitar nome, upload, autorização administrativa, QR ou JSON de cliente como prova. Não concatenar os PDFs assinados nem mudar bytes assinados. A retenção de rascunhos de contato não determina a retenção desses artefatos imutáveis.

Nenhuma unidade foi instalada, nenhum gate foi habilitado em runtime, nenhum email de lote foi enviado e nenhuma mudança foi publicada na VPS.
