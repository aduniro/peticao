# Etapa 06 — histórico binário dos documentos

## Problema observado e escopo

O plano `ETAPA-06-PORTAL-PRESIDENTE-PLANO-20261108.md` exige preservar PDFs anteriores e versionar correções sem reconstruí-las. O pedido original permanece no item 1.8 e no bloco PDF do `LOG-2026-11-04-planejamento-admin-v2.md`. O preparo já recusava publicar quando o lote tinha PDF. Contudo, `attachSignedPdf` substituía `signed_pdf` após validação/CAS, descartando o arquivo anexado anteriormente.

Esta unidade mantém os mesmos bytes correntes, validação estrutural, adapter ICP, revisão CAS, aprovação e regras de envio. Acrescenta retenção transacional de versões. Não aplica assinatura própria, QR, carimbo, texto ou objeto aos PDFs; não oferece verificação pública nem modifica avisos da interface.

## Persistência e autoria

A tabela aditiva `batch_document_versions` é a 19ª da base consolidada `44ade26`. Cada registro contém UUID, lote/ordinal, variante original ou assinada, bytes, SHA-256, hash da lista, classificação/nota conhecidas, origem, autor conhecido, quem capturou e instante da captura. A serialização usa o lock do lote e um ordinal único por lote. A função de inserção confere o hash dos bytes, e a auditoria participa da mesma transação.

- No preparo, guarda exatamente `signed.bytes` que o código já publicava em `batches.pdf`, sem inventar outra versão unsigned. Autor vem do snapshot original; `recorded_by` identifica quem concluiu/recuperou o preparo. Agendador permanece sem autoria humana fabricada.
- Antes de um novo upload válido, guarda os bytes originais e assinados ainda disponíveis que não estejam no histórico. Esses registros são `legacy-observed`, com autor antigo desconhecido (`NULL`) e captura de agora. A classificação antiga do original fica desconhecida se não havia registro próprio; a classificação do último upload ainda armazenado é preservada.
- Cada upload admitido grava uma nova versão com autor real e metadados do validador existente. Mesmo arquivo anexado novamente constitui nova admissão, sem apagar a anterior. A observação do estado corrente não duplica uma variante de bytes já preservados.

O trigger rejeita UPDATE, DELETE e TRUNCATE ordinários. Isso não impede um proprietário/administrador de alterar o DDL; não se promete imutabilidade contra poderes administrativos. Nenhuma variante já perdida é recuperada, e nenhum horário antigo é inferido a partir da captura atual. Não existe backfill de documentos durante o bootstrap: um legado só é capturado quando há nova anexação admitida. Lotes antigos sem novo upload continuam sem histórico retroativo; o download corrente anterior permanece disponível.

## Leitura protegida

`GET /api/admin/lotes/[id]/versoes` lista metadados em páginas de 50, com cursor `antes`. Não inclui bytes ou registros de assinantes em JSON. `GET /api/admin/lotes/[id]/versoes/[versao]` devolve somente a versão daquele lote, com SHA-256, nome fixo, attachment, no-store e nosniff. Ambos exigem Total e stepup; a camada transacional revalida conta ativa/identidade Total. Listagem e download têm auditoria nominal. Falha da auditoria ou divergência de hash impede o download. Não há link público, interface nova ou envio automático.

## Validação e reversão

Comando próprio: `python3 tools/admin-qa/batch-local.py --tests history`, sem build global. PostgreSQL temporário exclusivo, configuração vazia, identidades e bytes fictícios e mail dev. O runner confere os hashes das fontes antes/depois. São seis casos novos além dos 56 anteriores: imutabilidade/bytes/acesso; uploads sobre legado sem autoria inventada; ordinais concorrentes/observação idempotente; rollback da auditoria e download fechado; bytes/autoria do preparo; rotas com sessão/stepup, seleção e cabeçalhos. A bateria anterior continua cobrindo cancelamento, revogação durante validador, CAS e congelamento após aprovação.

Checker aditivo preserva todos os asserts anteriores de domínios, desafio, indicações e mensagens. Acrescenta replay/old bootstrap preservando bytes, metadados, autor nulo, capturador e microssegundos, com recusa de UPDATE/DELETE/TRUNCATE. Evidências finais ficam em `.cache/qa-document-history-20261109/`; `origem.txt` aponta o diretório temporário. O resultado executado e os tipos dirigidos constam nos logs, sem alegar build global ou homologação ICP real.

Rollback de código não remove tabela, trigger ou registros. O código antigo pode continuar substituindo o documento corrente sem capturar uploads futuros; portanto a retenção só continua garantida no fluxo integrado desta unidade. Não executar DROP, remover trigger ou restaurar dados sobre o histórico como parte de uma reversão. Não houve migração real, deploy, conexão VPS, envio externo ou leitura de assinantes reais.

Ainda faltam interface do histórico, comprovação visual compilada dos novos endpoints se necessária ao produto, UI externa do desafio e decisões aprovadas sobre QR/representação da confirmação. Este backend retém e recupera variantes concretas; não conclui sozinho todo o módulo DOCUMENTOS.

Resultado executado: **62/62**, zero falhas, cancelados ou ignorados; saída 0. Checker de 19 tabelas: PASS, inclusive histórico binário/trigger e todas as provas anteriores. Tipos dirigidos: seis raízes, 581 arquivos importados, zero diagnósticos. Diretório original: `/tmp/admin-batch-local-9f0x3ds4/`.
