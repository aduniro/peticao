# Etapa 1 — falhas de rede na tabela de pendentes

07/11/2026. Candidato local; sem deploy e sem alteração de textos, fonte, dimensões, classes ou estrutura visual.

## Falha e comportamento

A função `chamar` de `PendentesTable` tratava JSON inválido, mas não rejeição de `fetch`. Um erro de rede podia escapar do handler e deixar o estado ocupado sem liberação. O transporte agora retorna falha estruturada, faz uma única tentativa, conserva o erro já fornecido pela API e nunca aceita HTTP de erro como sucesso. Não repete gravação ou reenvio automaticamente após resposta perdida.

O componente mantém os avisos e alternativas já existentes. O e-mail digitado permanece no editor após falha; linha e seleção não são atualizadas como sucesso. Uma guarda síncrona por ID impede que Enter repetido ou duplo clique envie a mesma ação novamente antes da atualização do estado React. A guarda também cobre seleção em lote sobre uma linha ocupada; linhas independentes continuam operáveis. A política visual e o fechamento do diálogo de lote permanecem como antes.

Isso não transforma uma falha de rede em prova de que o servidor não executou: não há repetição automática, e conciliação durável de todos os caminhos de reenvio continua uma exigência separada. Não acrescenta timeout arbitrário à operação de lote. A proteção transacional da correção é a descrita em `ETAPA-04-CORRECAO-EMAIL.md`.

## Validação

Três testes de transporte passaram: rejeição de rede sem exceção/repetição, corpo inválido/HTTP de erro sem falso sucesso, erro de conflito preservado e POST vazio/sucesso válidos. Passaram **460/460 cumulativos** (`stage01-pending-network-cumulative.log`). A primeira rodada passou migração, build e tipos, mas o Playwright não iniciou por exigir Node 20+, enquanto o roteiro usou Node 18. O fallback preservou o artefato anterior e restaurou a prévia. A repetição privada `run-pending-network-node24-qa.py` usa Node 24.22.1 já instalado somente para o harness; app/build continuam no Node 18 previamente testado, sem trocar dependências ou runtime de produção. QA em seis larguras ainda em execução; não atribuir resultado de navegador antes de observá-lo.

O roteiro `tools/admin-qa/pending-network.mjs` usa banco separado, contas e assinatura fictícias; aborta deliberadamente os pedidos de reenvio e lote, e só deixa a correção de e-mail atingir a API real local. Nenhum pedido a participante ou API CPF. Metadado histórico de e-mail é fixture inserida no banco, não um envio realizado. O resultado do navegador deve ser registrado depois de observado, sem confundir testes unitários com prova visual.

## Retomada em 07/11 — navegador concluído

A nova execução `run-pending-network-resume-qa.py` usa TMPDIR curto e banco fictício novo. Ensaio de migração, build e tipos passaram nesta retomada. O navegador passou em 320, 390, 768, 992, 1280 e 1920 px: rejeição de rede, retenção do rascunho, salvamento posterior na API local, bloqueio de cliques repetidos, seleção conservada e ausência de envio. Não houve exceção de página ou transbordamento horizontal. Captura mobile inspecionada. Evidências: `.cache/admin-audit-20261106/runtime-pending-network-resume-20261107/pending-network.json` e logs `stage01-pending-network-resume-*`. Os 460 cumulativos acima são históricos; a próxima rodada cumulativa ocorrerá após incorporar as publicações posteriores. Nenhuma alteração na VPS ou na revisão de CPFs.
