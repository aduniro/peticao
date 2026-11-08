# Intenção idempotente para criação de indicação

Preparação local de 08/11/2026. Complementa a criação transacional existente. Ainda não está ligada ao formulário nem à rota; não declarar duplicidade HTTP corrigida antes dessa integração e do QA.

A biblioteca aceita UUIDv4 de intenção, vinculado ao administrador atual e ao HMAC do rótulo normalizado. Repetição da mesma intenção e conteúdo devolve o mesmo código, sem outra auditoria ou renovação de datas. Outro conteúdo com a mesma intenção é recusado. Outra conta possui espaço de intenções independente e precisa manter permissão de Edição. A biblioteca sem intenção preserva o uso anterior por CLI.

`admin_referral_requests` guarda apenas o vínculo de conta, intenção, impressão digital, referência e horário. Criação do código, vínculo e auditoria usam a mesma transação; falha não consome intenção nem deixa código sem evento. Nenhum envio, alteração de assinatura ou reuso de código pessoal.

Há três regressões novas preparadas para concorrência/repetição, rollback e parâmetros/autoria. O ensaio estrito de migração foi ampliado para13 tabelas aditivas e preservação dos metadados de intenção com microssegundos. Esses testes ainda não foram executados: a suíte de retenção usa o banco de QA neste momento. Não disputar esse banco durante a validação em sequência.

Próximos gates: executar testes/migração, definir o transporte de intenção da interface preservando rascunho em falhas, integrar rota/formulário e validar HTTP real. Aparência e textos existentes ainda não mudaram. Nenhuma autorização de deploy ou merge com a VPS.
