# Etapa 4 — criação atômica de usuários administrativos

Candidato local seguinte à versão essencial, em07/11/2026. Não foi feito deploy nem merge com a VPS. O layout e os textos da página de usuários não mudam.

## Problema e correção

O ensaio anterior, com banco fictício, provocou falha no evento `admin_usuario_criado`: a operação lançou erro, mas uma conta sem auditoria permaneceu. Agora criação e evento usam a mesma transação. Falha em qualquer gravação reverte ambas; o convite só é solicitado pela rota depois do commit bem-sucedido.

A rota passa ID/e-mail da sessão, e o helper confere novamente atividade e nível Total dentro da transação. A conta fica bloqueada para alteração até o commit. A ordem do bloqueio7003 é a mesma das mudanças de nível/desativação. Autoria do evento vem da conta conferida; um campo `por` divergente não substitui essa autoria. A API não pode cair no modo CLI caso a sessão desapareça entre as leituras. Bootstrap por CLI continua suportado, sem criar endpoint de bootstrap.

O hash da senha é calculado antes de obter os bloqueios. Nenhuma senha/hash é incluída no evento. Duplicidade usa `ON CONFLICT(email) DO NOTHING`; falha de outro tipo não é mascarada como e-mail duplicado. Campos, redirects e avisos existentes são mantidos. Sem DDL novo.

## Validação concluída deste bloco

17/17 testes direcionados passaram, incluindo três regressões novas: falha de auditoria com rollback e recuperação; operador desativado/rebaixado/ID ou e-mail divergente; criações simultâneas que deixam uma conta e uma auditoria. A cadeia de auditoria permanece íntegra. Evidência: `stage02-users-atomic-targeted.log` em `/mnt/dev/peticao/.cache/admin-audit-20261106/`.

**481/481 cumulativos**, build e tipos passaram, em sequência. O roteiro `tools/admin-qa/user-creation.mjs` atravessou o handler compilado e passou: sessão real, confirmação extra, origem, falha injetada sem conta/convite, recuperação, duplicidade sem segundo convite e assinatura fictícia preservada. As saídas foram conferidas: `stage02-users-atomic-validation.json`, `stage02-users-atomic-http-supervisor.log` e `runtime-stage02-users-atomic/user-creation.json`. Banco novo, provedores dev e destinatários fictícios; nenhum acesso aos participantes. Runtime3033/54346 encerrado; essencial3031/Tailnet preservado.

## Limites

Este bloco fecha somente a criação. Alteração de nível, ativação/desativação e redefinição ainda precisam da revisão final de autoria atual no momento da escrita. Não transforma convite e criação em uma única transação externa; falha de entrega após commit conserva a conta e segue o tratamento existente. A página ainda mostra o aviso de sessões cuja revisão depende de AV-1; nenhum texto foi alterado por inferência. Não conclui a Etapa4 ou o painel completo.
