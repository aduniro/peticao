# Recuperação administrativa e inventário próprio — 10/11/2026

## Escopo desta coorte

Histórico protegido por lote de confirmações consumidas e PDFs próprios, disponível em uma sessão nova sem recuperar senha ou código. A consulta usa Total e step-up, paginação de20 registros com ordenação SQL por microssegundos/UUID, campos explícitos e auditoria. O download histórico verifica novamente a integridade. A habilitação informativa de um recibo não substitui a autorização e o CAS da geração/A1.

Edição local do responsável deve bloquear novas emissões, exposição de credenciais, geração e A1 próprio enquanto não houver configuração confirmada. As consultas históricas continuam disponíveis. Limpar o campo editado não confirma o perfil: salvar ou consultar explicitamente a configuração é necessário, seguido de nova consulta aos recibos.

Operação A1 expirada pode ser encerrada por ação explícita, somente quando autorização e lease estiverem vencidas pelo relógio do banco. A ação vincula lote, job, documento, modo e revisão; consome um nonce separado e deixa auditoria recuperável. Ela não assina, promove, apaga arquivos nem envia. A revisão avançada e a lease removida impedem o worker antigo de publicar.

A recuperação da interface distingue intenção de assinatura, intenção de encerramento e resultado efetivamente confirmado. Resposta perdida exige consulta. Trocar de intenção é ação explícita, após evidência recente compatível; não há POST automático. Se uma revisão avançou antes do encerramento, a UI precisa oferecer abandono somente da intenção local obsoleta, sem declarar que o encerramento ocorreu.

## Aparência e escopo preservados

Usar classes administrativas existentes e comentários MUDAR AQUI para textos. Nenhum CSS, fonte ou formulário público alterado. Upload manual continua aceitando o original assinado; documento próprio combinado usa A1 automático. Os novos parágrafos das páginas administrativas apenas esclarecem essa origem.

## Evidências e limites

Rascunhos isolados de inventário:33 testes passaram, tipos passaram e fixture React passou. Encerramento backend:60 testes de regressão e2 negativos dirigidos passaram. Essas provas não substituem a execução do conjunto integrado após os ports.

A primeira compilação integrada anterior ao inventário/recuperação passou em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-compiled-1794305364212557740/execution.json`, HEAD9811f81, build de aplicação3ebd381. Provou canvas visível, confirmação/geração com resposta perdida, admission/claim A1 combinado e perfil com CAS. Não executou assinatura real nem worker/validador no fluxo compilado.

Validação desta nova coorte: pendente. Registrar resultados reais abaixo após fontes congeladas. Certificado real e-CNPJ da ADUNIR não foi disponibilizado; homologação real continua separada. Nenhum deploy, merge ou sincronização com a VPS autorizado por esta etapa.


## Validação integrada dirigida

- Tipos passaram, fontes e runtime estáveis: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794306537648300429/result.json`.
-209/209 testes passaram, sem omitidos; fontes e202 assets estáveis: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794306537726264712/result.json`. Duração342,4s, incluindo espera de I/O do host.
- Após essa execução, revisão encontrou duplicação de gerador próprio quando o mesmo recibo era aberto pelo acesso e pelo histórico. Corrigida apenas na interface, preservando backend: prop informa o recibo já montado e mantém consulta/download. Um novo cenário React dirigido passou; repetir tipos e compilado com a correção. Não atribuir esse último ajuste aos209 testes anteriores.
- Harness de fechamento avançado agora envia Origin no probe autenticado e exige fencing da revisão2 real do lease fictício. Paginação gov.br tem nova extensão de navegador para45 registros/cursor micros/perda GET/atualização concorrente; execução ainda pendente.


## Aceite local concluído

Build e tipos finais passaram no app `f71b3f1899bd6831936ac3282b34f177d7ddb6ec`, com fontes e202 assets estáveis. Os commits seguintes deste bloco alteraram somente o executor de QA, preservando todos os bytes de aplicação daquele build.

- Presidente compilado completo: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-compiled-1794308117751089726/execution.json`, exit0, QA HEAD `24368284d1be2e1a052f18361643f50a3791b402`.
- Todas as fases passaram: ownPDF, histórico corrente em sessão nova, A1 combinado (admission/claim), recuperação CAS e encerramento expirado, administração com CAS e histórico após alteração do perfil. O fechamento antigo foi recusado, lease vigente foi invalidada e nenhuma assinatura seguinte ocorreu automaticamente. Worker, validador e certificado reais não foram usados; mensagens/envios reais permaneceram ausentes. Contextos próprios e originais continuaram separados.
- Govbr compilado: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/govbr-compiled-1794307484897049516/execution.json`, exit0, QA HEAD `c891c3788e86d3b5a6e9fed44916a16fc5513d65`. Upload/validação de contrato fictício, seleção versionada, preparação, aprovação, código com resposta perdida, envio dev e paginação45registros mais inserção concorrente passaram. Seleção/pacote preservados; nenhum retry automático.
- Root inspecionou capturas móveis do histórico e da paginação. Seis larguras verificadas pelo cenário principal; metadados/hashes, ausência de overflow e ausência de erro de página registrados nos resultados.

As primeiras rodadas compiladas revelaram defeitos DO HARNESS, preservados nas evidências: regexUUID incompleta em dois helpers; igualdade textual de headers ignorava composição global+local; BrowserResponse body já descartado pelo CDP após navegação; sequência intensa atravessava o limite compartilhado real de60s. Corrigidos nos testes, com captura antecipada dos bytes reais e espera de61s nas fronteiras de cenários. Nenhum limitador, privilégio, origem ou guarda da aplicação foi relaxado.

Este aceite é local. Certificado e-CNPJ da ADUNIR, homologação do validador e adaptador real govbr continuam dependências operacionais. Não equivale a autorização de publicação nem conclusão integral de todos os módulos. Próxima implementação: Indicações, na seção Campanha.
