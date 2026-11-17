# Etapa 4 — criação administrativa de indicações

Bloco local de07/11/2026. Candidato seguinte, preservando94c9cc0 na prévia3031/Tailnet. Não foi feito deploy ou merge com a VPS.

## Correção

A rota criava o código e gravava a auditoria em operações separadas. Agora `admin-referrals.ts` usa uma transação para a alocação e o evento, com autoria nominal. Confere novamente ID/e-mail/atividade/nível Edição ou superior e mantém o bloqueio compartilhado da conta até o commit. O gerador seguro e o formato de sete caracteres foram preservados. Colisão de código usa ON CONFLICT e no máximo cinco tentativas, sem deixar a transação abortada. O token de gerenciamento permanece somente em hash no banco; não é retornado pela nova operação nem gravado na auditoria.

O endpoint mantém os mesmos campos, redirect303 e mensagens existentes. Conta nominal é necessária para autoria; o helper recusa ID zero, conta desativada ou rebaixada e e-mail divergente. Nenhuma classe, estrutura visual, texto público ou regra de assinatura mudou. Não há DDL novo.

## Evidência

-7/7 direcionados: criação/auditoria, falha com rollback, conta atual, colisão, HTTP/origem/permissões e regressão das indicações pessoais/cartaz.
-476/476 cumulativos, zero falhas/ignorados: `stage02-referrals-cumulative.log`.
-Build e tipos serializados aprovados: `stage02-referrals-{build,typecheck}.log` e `stage02-referrals-validation.json`.
-HTTP compilado local: sessão real,401/403, origem recusada, mensagens/redirect mantidos, falha de auditoria injetada com500 esperado e rollback completo, recuperação posterior, rebaixamento recusado e cadeia íntegra.
-Assinatura fictícia confirmada e pendente preservadas integralmente; nenhuma mensagem/fila criada. Runtime3033 e PostgreSQL54346 encerrados. Prévia3031 permanece no candidato essencial anterior.

Roteiro versionado: `tools/admin-qa/referrals.mjs`. Evidências privadas sem segredos: `.cache/admin-audit-20261106/runtime-stage02-referrals/referrals.json`, `stage02-referrals-http.log` e `stage02-referrals-http-supervisor.log`. Usaram-se banco novo, credenciais fictícias e entrega dev, sem participantes ou consulta CPF.

## Limites e continuidade

Esta operação não torna requisições HTTP repetidas idempotentes: repetir uma criação ainda pode gerar códigos distintos. Edição/arquivamento de indicações e as demais entidades continuam pendentes. Não marca a Etapa4 ou todo o painel concluídos. Próximo: fechar atomicidade das demais escritas existentes e integrar interfaces conforme os textos aprovados. Publicação e integração com a VPS continuam dependendo de autorização explícita do dono.
