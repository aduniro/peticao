# E-mails: entregas e histórico de sinais

Etapa seguinte à consulta de pendentes aceita100% LOCAL. Objetivo: listagem integral e exportação de entregas/aberturas/cliques/devoluções, com sinais cronológicos e proveniência explícita. Não conclui reenvios, sincronização nem histórico individual de mensagens nesta primeira coorte.

## Problemas confirmados

CSV antigo corta em50000 com sucesso; página vazia perde total; cadastro sem sinal fica fora da base; filtro provedor ignora eventos sem envio aceito; melhor sinal histórico pode esconder evento adverso posterior. Nome da página atual chama endereço de pessoa e vínculo por email não comprova a confirmação atual.

## Decisões reversíveis

- Preservar todos os cadastros como linhas independentes por ID, mesmo com email compartilhado. Endereços apenas históricos entram como avulsos explicitamente, somente quando nenhum cadastro tem aquele endereço. Totais separam registros/cadastros/pendentes/confirmados/endereços avulsos; não chamar a união de pessoas.
- Evidência agregada por endereço e todos os tipos de mensagem; vínculo com confirmação corrente não comprovado. Último sinal cronológico usa a mesma regra pura da consulta de pendentes; aceite do provedor não vira entrega.
- Filtro provedor recorta as evidências exibidas para o provedor selecionado; lista de provedores do histórico completo permanece metadata. Contagem legado mail_log.sent e tentativas aceitas journal separadas, sem inventar mensagens únicas ou somar espelhos.
- Preservar24cabeçalhos CSV, BOM/escaping/fórmula/datasBrasília; acrescentar estado aceito sem afirmar entrega. Conferir total/recordKeys/bytes/SHA antes200; nenhum corte silencioso em50000.
- Rota existente sem formato continua CSV; JSON apenas com formato=json. Filtros legados permanecem reconhecidos, duplicatas/valores inválidos rejeitados.
- Sessão/conta Edição atuais, RR para todos os indicadores da consulta e reautorização antes de liberar. Auditoria de arquivo preparado em transação própria com rollback se expiração durante escrita.
- Preservar fontes/classes/layout; novos textos funcionais com MUDAR AQUI. Contatos WhatsApp somente com consentimento e permissão; indisponibilidade de cifra distingue ausência, sem expor ciphertext.

## Divisão autorizada

Backend/contrato/store/CSV em draft de assinaturas_review; UI/client em draft de presidente_ui_audit, contrato compartilhado antes implementação. Root integra SSR/HTTP, testa e registra aceite. campanha_audit audita reenvios em draft separado, sem mudar esta coorte ou executar envios/provedores.

## Validação exigida

Puros: parser, estados, DTO, leitor limitado, CSV24 maior50000,escaping e fontes incompletas. PG fictício:50001+, totais em página vazia, múltiplos cadastros/avulsos, provider apenas negativo, cronologia/microssegundos, consentimento/cifra, permissões/concorrência/expiração/auditoria. Next compilado: filtros/paginação/CSV integral, respostas antigas/perdidas/401403, seis larguras e invariantes de dados, sem DNS/provedores/envios.

Implementação em andamento; nenhum aceite final por este documento. Sem publicação, merge ou alteração VPS.

## Integração root em andamento

SSR/GET de Entregas passam a compartilhar parser/store/CSV novos (aguardando drafts finais). CSV mantém endpoint/filename; arquivo materializado e auditado com sessão atual antes200. SSR preserva arrays de parâmetros para rejeitar duplicatas, confere ator novamente antes de serializar contatos e monta EntregasConsulta com contexto da sessão.

Resumo de pendentes em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/admin/emails/page.tsx` passa a usar exatamente os totais globais do readmodel de pendentes já consultado, eliminando a segunda classificação por melhor sinal. Decisão: distinguir último aceite/entrega/abertura/clique/adverso/sem registro; não inferir spam pela falta de abertura. Somente textos e fonte dos indicadores alterados, com MUDAR AQUI; classes/fontes mantidas. Data do agregado legado mostrada separadamente como atualização desse agregado, sem afirmar atualização de todos os provedores. Testes desta reconciliação ainda pendentes.

## Primeira coorte de testes e diagnóstico

PG comum terminou17/21,4falhas e zero ignorados em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/delivery-store-1794324821602908467/result.json`; fonte/HEAD/runtime estáveis. Duas falhas de sincronização vinham do probe exigir trecho de query truncado em1023bytes pelo pg_stat_activity; teste agora observa o prefixo da consulta real após autorização. Outro teste tinha import namespace DNS incompatível com mock.method; passou a importar o objeto default como a coorte anterior.

A falha50001 foi do prazo real: prévia serializava cada cadastro em JSON só para medir seu tamanho, duplicando trabalho da consulta. Perfil demonstrou4.5s de prévia e estouro de10s antes da projeção. Patch limpo porSHA690ce31 mantém50001,10s e todos os budgets, usando somente comprimentos/limite conservador de escape JSON no preflight. Mantém o limite real de bytes após leitura. Provas: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-delivery-admin-next-draft/PREFLIGHT-DIAGNOSTICO.md`. Perfil dirigido passou2/2 (4ignorados explicitamente): página4.9s, página vazia3.3s, exportação3.4s. Ainda exige revalidação do conjunto integrado.

UI3fontes portadas porSHA de `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/emails-entregas-ui-next-draft/entrega.json`. Tipos globais aprovados em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794325286582330001/result.json`;8/8puros cliente em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/delivery-client-1794325286604775786/result.json`. Fixture UIHTTPfictício seis larguras0 e estilos/fontes/padding/bordas iguais ao baseline; não substitui Next/PG.

## Revalidação após otimização

Conjunto backend21/21 aprovado, zero ignorados, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/delivery-store-1794325497388250559/result.json`; HEAD/fontes/runtime estáveis. Inclui50001, paginação vazia com total correto, CSV24integral, consentimento/cifra, provedor sem aceite, journal/log distintos, snapshot concorrente, expiração durante leitura e quatro auditorias com validade inicial/expiração durante escrita/rollback.

Interface já passou8/8puros e tipos globais; artefato da fixture em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/emails-entregas-ui-next-draft/browser-fixture/result.json`. Revisão independente de SSR/GET/UI não encontrou outro defeito concreto. Falta build de produção estável e ensaio Next compilado. Seis fontes QA portadas porSHA dos manifestos `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-delivery-compiled-next-draft/manifest.json` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/emails-entregas-ui-next-draft/compiled-helper-manifest.json`. Nenhum aceite final por testes parciais.
