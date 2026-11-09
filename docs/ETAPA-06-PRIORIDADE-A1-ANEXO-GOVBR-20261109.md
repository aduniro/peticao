# Prioridade imediata: documentos e aprovação de lotes

Solicitação do responsável em 09/11/2026: priorizar este módulo para uso na manhã seguinte, reativar os agentes e apresentar quatro prévias visuais. O prazo desejado não substitui a homologação dos fluxos nem autoriza deploy.

## Decisões confirmadas nesta rodada

- O A1 disponível é **e-CNPJ da ADUNIR**, e não e-CPF do presidente.
- A aceitação organizacional deve conferir o CNPJ do titular; `valid: true` sem essa identidade não comprova a exigência.
- Está aprovado **planejar** a petição-base assinada pelo gov.br como anexo fixo, imutável e reutilizado em todos os envios. Cada lote mantém seu próprio ofício e lista. Essa assinatura cobre somente a base.
- As quatro prévias são demonstrações sem assinatura criptográfica: A1, confirmação própria do presidente, ambas e gov.br. Não usar certificado, senha, pessoa ficticiamente apresentada como signatário real, ou marca de validação efetiva.

## Estado observado antes das novas alterações

O snapshot integrado `8cdd97a` passou 670 testes, schema de 22 tabelas aditivas, tipos, build e cinco grupos HTTP no Node 20. Esse marco é incremental, não conclusão do painel.

O módulo já possui download e upload do PDF do lote, histórico binário, aprovação por código e bloqueio de envio em produção sem ICP-Brasil. O upload exige correspondência estrutural com o arquivo original e consulta um validador externo configurável. `signPdf` implementa somente o modo de teste: **carregamento e assinatura direta com A1 ainda não existem**. Os controles de assinatura própria e gov.br do portal ainda estão desativados.

Não apresentar inspeção estrutural, JSON de fixture ou selo visual como verificação criptográfica. O serviço real precisa conferir os bytes, a assinatura, sua cobertura, a cadeia e o titular esperado.

## Sequência prática

1. Conferir o fluxo já existente de lote congelado, download, assinatura externa, upload, validação, revisão e aprovação explícita. Identificar dependências de homologação. Manter o mesmo binário no histórico, na aprovação e no envio.
2. Corrigir a admissão do resultado do validador: JSON e tipos limitados, `valid === true`, CNPJ esperado obrigatório. Testar omissão, titular diferente, resposta inválida e indisponibilidade sem liberar o lote.
3. Entregar quatro prévias usando o layout atual e dados fictícios, renderizadas e inspecionadas. Nenhuma prévia ativa o recurso ou comprova validade jurídica.
4. Definir a integração A1: uso externo pelo titular e upload do PDF, ou um assinador protegido com confirmação explícita por lote. O certificado e a senha não vão para Git, logs, e-mail, chat ou o próprio PDF. O arquivo final deve ser validado antes da aprovação.
5. Para assinatura própria combinada com A1, renderizar o bloco e vincular suas evidências antes da assinatura criptográfica final. Não alterar o PDF assinado para inserir um selo depois. Identificar separadamente hash do documento-base e hash final; evitar autorreferência.
6. Planejar o pacote de envio com base gov.br como anexo separado: registrar versão e hash da base, incluir essa referência no snapshot de preparo/aprovação e congelar o conjunto de anexos. Um retry não seleciona silenciosamente uma versão mais recente. Base assinada não aprova listas futuras.
7. Integrar os controles pendentes e executar testes de permissões, concorrência, bytes e hashes, falha do validador, assinatura/cobertura, aprovação e transporte de desenvolvimento; depois validar visualmente. Solicitar autorização antes de qualquer publicação.

## Limites preservados

Não copiar a imagem de uma assinatura para alegar assinatura de outro PDF. Não concatenar ou regravar arquivos assinados supondo que a validação será preservada. Não atribuir qualidade ICP-Brasil a uma confirmação do app ou a uma assinatura gov.br. Não alterar assinaturas existentes, regras públicas de cadastro, produção ou a prévia somente leitura.

Novos avisos administrativos continuam sujeitos à aprovação prévia estabelecida pelo responsável. A proposta para identidade ausente é “O validador não comprovou o e-CNPJ da ADUNIR.”, ainda pendente na criação deste registro.
