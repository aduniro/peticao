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
