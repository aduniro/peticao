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

## Aceite de Entregas — 100% LOCAL

Ensaio Next68771 terminou0: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-delivery-compiled-1794328375784183219/execution.json`. QAHEAD2fe6860ff82a4a8be809803f79a9a02cba34a9fa/buildapp38283fd3700bd1774350bd50c2cc9e0020bb2e8d; mapa integral da aplicação e202arquivos runtime iguais, fontes/HEADestáveis. Portas54390/3077/3078 fechadas após execução.

-50001cadastros +3endereços avulsos; IDs mantidos mesmo com email compartilhado, inventário/totais separados, páginas vazias conservam total. Provider apenas em evento aparece; filtro recorta sinais sem atribuir ao provedor errado; aceite de journal não vira entrega nem soma fictícia a envios legados.
-CSV24colunas/50004linhas/9095327bytes, SHA256 `3d306e05f51b13176ada37e7ddce413311da6ffd702c91fb7da99c55e00d2b68`. DefaultCSV, formatoCSV explícito e download browser idênticos; filtros uma/zero linhas e fórmulas/aspas/novas linhas/telefoneleading+ protegidos.
-28GETs browser e19capturas; falha deliberada de página/retry manual, resposta antiga ignorada, SSRduplicatas/CSVinválido sem fallback,401limpa contatos, Leitura403, sessão expirada/anônimo401 e origem inadequada403. WhatsApp só com consentimento/cifra disponível.
-Razão16384unidadesUTF16 comemoji intacta em seis larguras, sem overflow de página. Screenshot inspecionado `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-delivery-compiled-1794328375784183219/delivery-history-emoji-320.png`.
-50001registros completos sem alteração (zero backfill seq/verify_code), mensagens/filas/eventos/referrers/lotes/checks preservados, auditoria de preparo válida, guard instalado e zero tentativas DNS/provedores/externos/mutação.

Ensaios anteriores preservados:27015 retornou503 noCSV, causa não comprovada e não reproduzida nos três ensaios seguintes;41031 passouCSV e revelou expectativa QA errada sobre apóstrofo protetor de telefone;92591 passouHTTP/CSV e revelou expectativa QA errada de busca substring (orphan também corresponde a prepared-orphan). Corrigidas somente asserções, sem alterar dados, busca da aplicação, limites, guardas ou critérios de segurança. Ensaio final comprova substring2avulsos e filtro de provedor que desambigua para1. Não atribuir503 ao rebootVPS: todo ensaio é local/fictício.

Este aceite cobre **Conferir entregas, aberturas e cliques registrados**. Histórico individual completo, fila/reenvios e cobertura/sincronização dos provedores permanecem coortes seguintes do módulo. Sem deploy/merge/VPS.
