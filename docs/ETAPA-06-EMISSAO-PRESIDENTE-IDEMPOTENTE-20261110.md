# Emissão do acesso do presidente por intenção

## Problema demonstrado

Duas chamadas da mesma intenção emitiam dois pares de credenciais e revogavam o primeiro acesso. Reprodução: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794291399231634555/result.json` (um caso falhou,20 ignorados pelo filtro). Não é uma execução completa de21 casos.

O primeiro reteste da correção encontrou uma junção incorreta de `await` no próprio teste; essa falha foi preservada em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794291523624294862/result.json`. A escrita foi corrigida antes da rodada aprovada. Não se deve atribuir esse erro ao aplicativo.

## Contrato vigente no candidato

`POST /api/admin/presidente/desafio` exige Total/stepup, origem, JSON limitado e campos exatos: batchId, requestId, expectedDocumentVersion e expectedProfileFingerprint. O fingerprint é fornecido pelo GET de perfil já protegido; vincula revisão, responsável, CPF protegido, nome e e-mail da conta. Nenhum CPF bruto é exposto por esse campo.

O UUID é escopado pelo emitente. Documento e perfil são rechecados no início e na admissão durável. Repetição ou alteração do mesmo pedido não rotaciona token/senha, validade ou tentativas; somente a primeira emissão recebe as credenciais aleatórias. Não se tenta reconstruí-las ou retorná-las no replay.

`GET /api/admin/presidente/desafio?requestId=UUID` permite recuperação de metadados pelo mesmo ator Total/stepup. Retorna identificação do desafio/lote, versão, estado, datas, expiração, se o vínculo ainda corresponde e eventual UUID do recibo consumido. Nunca retorna token/senha/CPF/nascimento. Não renova o prazo, não verifica identidade nem envia mensagens. Falhas são400/403/404/503 conforme a causa. Resultado perdido não autoriza emissão automática de uma nova intenção.

Uma nova emissão explicitamente solicitada recebe novo UUID e pode revogar o acesso anterior ainda pendente, como no contrato existente. Chamadores internos antigos sem intenção mantêm compatibilidade; a rota HTTP exige os campos novos. Não existe frontend ativo que use o fluxo novo neste incremento.

## Persistência e replay

Duas colunas nullable em president_challenges preservam os registros legados sem inventar intenções: request_id e request_fingerprint. CHECK mantém o par, índice único protege emitente/UUID. Em registros com intenção, metadados, identidade, credenciais protegidas, documento e datas não podem ser reescritos; somente estado/tentativas/lease/recibo/horário de confirmação continuam mutáveis pela máquina existente. DELETE/TRUNCATE não apagam a identidade desses pedidos. DDL reaplicável conserva campos e microsegundos. O total continua35 tabelas aditivas; não foi criado banco novo ou alterada a VPS.

## Evidências do código staged sobre bd9c7ea

- Teste dirigido corrigido:1 aprovado,20 ignorados pelo filtro, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794291844097541076/result.json`.
- Rodada completa do presidente:23/23, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794292180814777578/result.json`.
- Tipos:exit0, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794292172468896213/result.json`.
- Atualização/reaplicação de esquema, incluindo pedido com UUID e datas fracionárias:exit0, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/schema-1794292172407029902/result.json`.

Os testes incluem concorrência, primeiro token ainda utilizável, tentativas preservadas, perfil incorreto, recuperação sem segredos, outro Total recebendo404, nomes de parâmetros estritos, revogação, imutabilidade e preservação do documento. Não confundir estes23 com a cumulativa903 anterior, de outras fontes. Build exit0, fontes e commit estáveis: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/build-1794292390777624618/result.json`. Os manifestos das quatro verificações foram comparados com as fontes antes do commit.

Sem novo aviso público, alteração visual, assinatura real, envio real, deploy ou merge. Próximo passo: interface de acesso e recibo, formato do PDF em decisão e ligação segura ao documento, sem modificar bytes já assinados.
