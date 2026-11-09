# Contato em conjunto: preparação e prévia por destinatário

## Origem e escopo

O pedido original no `LOG-2026-11-04-planejamento-admin-v2.md`, itens5 eEtapa3
(linhas10/138–140 na captura), exige responder individualmente/emconjunto, mesma
resposta com `{nome}`, cópia ao dono e transporte transacional existente. A matriz
de escopo integral registra fluxo por destinatário/intenção como lacuna. Este
marco entrega somente preparação/prévia texto: não inventa envio alternativo,
não implementa rich/IA, não altera frontend/textos, esquema, VPS ou emissores.

Foram inspecionados `contact-drafts`, `contact-replies`, estados de entrega e rota
individual. Rascunho compartilhado possui revisão/retensão própria; resposta tem
rodada, selo de conteúdo/configuração, reserva durável e tratamento de incerteza.
O módulo novo reutiliza a validação/montagem de prévia existentes; não chama
`enviarResposta`, dispatcher, reserva, worker ou gravação de rascunho.

## Contrato

`prepareContactGroupPreview` e
`POST /api/admin/contato/grupo/previa` exigem conta Total, sessão ativa e confirmação
extra atual; a biblioteca revalida isso no snapshot de leitura. A API conserva
origem/taxa, limita corpo a32768bytes e rejeita campos arbitrários/modo de envio.
Seleção de1a20IDs únicos, template assunto/corpo e prova esperada opcional.
Templates seguem limites existentes150/5000; expansão que ultrapassar o limite
é recusada por destinatário, sem truncar silenciosamente o nome ou a resposta.
A única variável substituída é `{nome}`, pelo primeiro nome já usado no fluxo
individual; o texto não é executado ou tratado como editorHTML.

O snapshot consistente reúne contatos limitados, última rodada/metadados de
resposta, sinal de histórico ativo/incerto, revisão/estado do rascunho e supressão.
O conteúdo do rascunho não é lido, aplicado ou sobrescrito. Até3metadados da última
rodada por destinatário são carregados; a síntese de histórico anterior conserva
incerteza/atividade, sem copiar payloads. Contato cujo contexto excede4000caracteres
é sinalizado como incompleto e não fornece selo. SQL tem timeout de3s por consulta.

Cada destinatário apresenta entrada expandida e prévia texto com o selo existente.
O card existente aparece apenas como metadado de existência/assunto; nenhumHTML
ou arquivo é acrescentado à resposta. Cópias eReply-To vêm exclusivamente da
configuração atual e ficam vinculadas à prévia; ausência/configuração inválida
da cópia ao dono bloqueia elegibilidade, sem criar um destino automaticamente.

Mesmoe-mail em dois casos selecionados é sinalizado em ambos, sem escolher caso,
deduplicar silenciosamente ou unificar conversas. Supressão, destinatário inválido,
histórico ativo/incerto e fonte incompleta bloqueiam a prévia. Nova rodada após
resposta anterior exige `newRound:true` por contato e rodada esperada exata;
preparação nunca cria a rodada. Revisões de rascunho/resposta esperadas, se
informadas, são verificadas sem substituir a decisão do operador.

A provaHMAC liga ator/sessão, seleção canônica, template, fontes, metadados,
revisões, cópias e selos individuais. Repetição em estado igual é idempotente
como **leitura**; ordem equivalente de seleção produz a mesma prova. Alteração
com prova esperada retorna409 e nenhuma escrita. Não existe ledger de envio de
grupo nem promessa de reserva durável: `groupReserved:false`, `automaticSend:false`.
A prova de grupo não é aceita como comando de envio e não acrescenta autorização
à rota individual. As guardas/estados do envio existente continuam indispensáveis
no momento de uma futura ação explícita.

## Validação

**25/25 testes passaram**, zero falhas/cancelados/ignorados: oito regressões novas
mais respostas e rascunhos existentes. Cobrem personalização/selos/cópias/card,
repetição e seleção equivalente, prova obsoleta por fonte/seleção/texto/revisão,
vínculo a outro Total e configuração de cópia, destinatário duplicado/supressão,
incerteza, nova rodada explícita, sessão/nível/identidade/stepup atuais, limites,
401/403/409/413 e snapshot sem escrita de contato/rascunho/resposta/assinatura/
fila/mensagem/auditoria. `fetch`fake na prévia observou0chamadas. Os testes de
envio existentes usam transportes fictícios; nenhum emissor real foi ativado.
Tipos da árvore isolada:0. Nenhum build/navegador necessário para este backend.

Execução final `/tmp/admin-contact-group-b282keqb/`; primeira rodada24/24 em
`/tmp/admin-contact-group-ym6vgmir/`. Cópias/checksums privados em
`.cache/qa-contact-group-20261109/`. Fontes estáveis em cada execução;
PostgreSQL54356fictício encerrou e porta ficou livre. Não houve DDL.

## Continuidade necessária

Seleção/interface e textos precisam da integração e aprovações correspondentes.
Uma eventual confirmação/envio em conjunto requer contrato próprio de intenção
por destinatário, resultados parciais/reconciliação sem reenvio e autorização
atual no instante da reserva, reutilizando o executor existente. Não apresentar
esta prévia como envio em lote concluído ou como autorização de divulgação para
endereços externos; o escopo é responder a casos de contato selecionados.
