# Código de aprovação: uma emissão por intenção

## Falha reproduzida

Duas chamadas da mesma solicitação geravam dois códigos e e-mails. A reprodução preservada está em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/package-delivery-1794287814453984355/result.json`: 27/28 aprovados, com 2 mensagens onde deveria haver 1. A espera prolongada dessa rodada foi diagnosticada como WalSync no PostgreSQL fictício durante o catálogo inicial, não como execução de um subagente.

## Funcionamento

Os formulários de Lotes/Presidente passam um UUID oculto. No fluxo v2, também enviam a versão do documento e UUID/digest do pacote revisado. O endpoint recusa campo desconhecido, repetido ou ausência de UUID. Os controles visíveis, textos, fontes e layout permanecem os mesmos.

O registro de preparo já existente na auditoria encadeada funciona como diário da intenção, serializado pelo lock administrativo. Não há nova tabela nem código de seis dígitos em texto claro nesse diário. O HMAC v4 vincula documento, pacote, emissor, UUID, aprovador e conjunto de destinatários. O número é derivado por HMAC com domínio separado e segredo existente, permitindo reconstruir a mesma mensagem sem armazenar o número no diário. Não se altera HASH_PEPPER.

Repetição ativa conserva hash, validade e contador de erros. Mensagem usa a mesma chave durável e singleAttempt: não há fallback/reenvio de resultado incerto. Repetição simultânea pode receber recusa de transporte já em andamento, mas não cria outro e-mail. Intenção antiga, consumida, expirada ou substituída não restaura código. Pedido explicitamente novo tem novo UUID e respeita cinco emissões por lote/15 minutos, incluindo contagem persistente da auditoria; replay não consome uma emissão nova. O evento de código enviado também é registrado uma vez por hash.

Na aprovação, destinatários e aprovador devem continuar correspondendo ao contexto do código. Outro usuário Total autorizado pode usar o código: autoria de emissão não equivale a exclusividade de aprovação. Retries aprovados continuam vinculados ao pacote original pela auditoria de aprovação, mesmo com outra seleção de base mais recente. O extrato de conciliação fornece o contexto original como metadado para o formulário.

Chamadores internos antigos com dois argumentos conservam o comportamento legado para compatibilidade; a rota HTTP e os formulários novos exigem UUID. Não apresentar essa compatibilidade como autorização para burlar a política do fluxo v2. Não houve envio real ou mudança na VPS.

## Testes e limitações

A primeira rodada da correção encontrou erro de escrita no próprio teste (`awaitrequestApprovalCode`); o código do teste foi corrigido, preservando as evidências de falha em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794288154917816559/result.json` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/package-delivery-1794288153765761387/result.json`.

Rodada do código staged sobre e6efb47, com fontes e commit estáveis:

- 32/32 testes de aprovação/entrega/recuperação, incluindo handler HTTP real: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/package-delivery-1794288255709017311/result.json`.
- Tipos aprovados: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794288256840719355/result.json`.
- Build aprovado: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/build-1794288293494433094/result.json`.

Não confundir HEAD-base com as fontes staged; os manifestos SHA identificam o código exato testado. Conferir esses hashes após o commit. Códigos, PDFs e destinatários são fictícios, transporte dev.

Ferramentas promovidas do ensaio privado anterior:

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/govbr-compiled-local.py`.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/govbr-compiled-scenario.mjs`.

O novo ensaio deverá perder a resposta do formulário nativo de código e repetir exatamente seu UUID/corpo, além de testar os controles gov.br reais, diário de validação, dois anexos exatos e seis larguras. Só declarar aprovado após consultar o novo resultado. Sintaxe Python/JavaScript já conferida, sem afirmar execução do navegador antes dela acontecer.

Pendências de aceite: executar esse ensaio compilado, avaliar índices/custo das buscas de intenção na auditoria sob volume real, guarda de rollback para emissores antigos e pacotes v2, homologações criptográficas e regressão cumulativa do candidato final. Não houve deploy, merge ou conclusão integral do painel.
