
## Sequência alterada pelo responsável após Dispersão
Decisão expressa: ao concluir o módulo Dispersão, seguir diretamente para a seção Assinaturas. Materiais de divulgação permanece no escopo integral, mas adiado. Nenhuma autorização de publicação ou mudança na VPS decorre desta decisão.

## Entregas e reenvios — decisões sob a autorização do Goal

Pergunta considerada: deduplicar a lista de Entregas por email? Decisão: preservar cada cadastro por ID e manter endereços históricos avulsos somente quando não houver cadastro, com totais separados e unidade explícita. Não presumir pessoas únicas. Manter24colunasCSV e formatoCSV padrão da rota existente; JSON explícito para a nova interface. Detalhes e validação em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/docs/ETAPA-11-EMAILS-ENTREGAS-20261110.md`.

Pergunta considerada: manter indicadores por melhor sinal histórico junto da nova lista cronológica? Decisão: o resumo de pendentes na página E-mails usa os mesmos totais globais da lista, sem segunda classificação; distingue aceite de entrega e não presume spam por falta de abertura. Classes e fontes preservadas; textos funcionais com MUDAR AQUI.

Pergunta considerada: como evitar reenvio duplicado e confirmação com link anterior à correção de email? Decisão de projeto AINDA EM DRAFT: comando identificado/CAS, recuperação só por leitura e transporte admitido uma única vez. Reenvio ao mesmo endereço pode preservar hashes antigos apenas até a expiração original; troca de destinatário usa nova geração e revoga challenges antigos de email e WhatsApp, inclusive A→B→A, preservando consentimento/telefone cifrado e evidências. Nenhuma mudança em confirmFull/SQL será integrada antes da revisão de transação e testes adversos. Plano: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/emails-reenvios-next-draft/DECISOES-CONTRATO-REENVIOS.md`. Não há alteração de produção, envio real, ou autorização de deploy.
