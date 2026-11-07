# Avisos administrativos aguardando aprovação

Regra do responsável: “ANTES DE ALTERAR QUALQUER AVISO OU INFORMAÇÃO QUE APAREÇA PARA O USUÁRIO, VOCÊ DEVE ME PERGUNTAR ANTES.” As propostas abaixo já foram perguntadas no chat e continuam **pendentes**. Este documento não as ativa na interface e não trata ausência de resposta como aprovação. O trabalho independente prossegue; a publicação não pode conter informação contraditória.

## AV-1 — Minha conta

Proposta: “Pelo menos 12 caracteres. Ao trocar a senha, todas as sessões serão encerradas. Entre novamente com a nova senha.”

Motivo: a troca agora revoga as sessões atomicamente; o aviso anterior precisa refletir esse comportamento. Nenhuma redação alterada até a aprovação.

## AV-2 — Resposta de contato sem resultado confirmado

Proposta: “Não foi possível confirmar o resultado do envio. Para evitar duplicação, a mensagem não será reenviada automaticamente. Confira o histórico antes de enviar outra resposta.”

Motivo: timeout ou falha após possível aceite não significa rejeição pelo provedor; o backend conserva a reserva e não reenvia automaticamente.

## AV-3 — Estados do histórico de contato

Propostas: “Aguardando envio”, “Aguardando o texto”, “Envio em andamento”, “Aceita pelo provedor”, “Resultado a conferir” e “Recusada”.

Motivo: o histórico antigo distingue apenas enviada/agendada/falhou e classifica incorretamente os estados novos. Aceite pelo provedor não equivale a entrega na caixa de entrada. Linhas antigas precisam conservar a identificação de histórico anterior, sem inventar estados que não foram gravados.

## AV-4 — Convites e redefinições no painel

Propostas: “Solicitação registrada. O e-mail está na fila de envio.” e “Não foi possível confirmar o envio do e-mail. Confira a situação do usuário antes de tentar novamente.”

Motivo: o resultado interno agora distingue aceite, fila e pedido sem envio. O handler administrativo antigo ainda não consome esse resultado; não declarar a interface corrigida. A recuperação pública mantém a resposta uniforme existente e não expõe a existência da conta.

## Limites

Não inclui mudanças de textos do formulário público, identidade, privacidade ou assinatura. Os modelos de e-mail existentes foram preservados. A autorização geral do plano não será interpretada como aprovação dessas novas redações específicas.

## AV-5 — Resultado indeterminado na Central de Ações

Proposta: “Não foi possível confirmar o resultado da ação. Verifique a situação do serviço antes de tentar novamente.”

Perguntado antes da alteração; ainda pendente. O backend distingue esse estado e impede repetição de pedido externo incerto. O componente ainda não recebeu o novo texto: não liberar enquanto o código de estado não tiver apresentação clara e o fluxo de conciliação estiver concluído. O histórico/controle de conciliação também precisa de integração própria, sem edição arbitrária de registros.


## AV-6 — Descrição e dicas da janela na Central

Proposta submetida ao dono: usar a descrição exata retornada pela simulação e os rótulos “Início da janela (vazio = padrão exibido na simulação)” e “Fim da janela (vazio = padrão exibido na simulação)”. Ainda pendente; nenhum texto/descrição foi alterado na tela.

Evidência: o componente mostra `a.efeito` estático, mesmo quando `saida.efeito` representa as datas escolhidas. Além disso, as dicas atuais indicam 04h/12h enquanto os instantes padrão `2026-11-04T04:00:00-03:00` / `2026-11-04T12:00:00-03:00` são exibidos pelo backend como 03h/11h em `America/Porto_Velho`. A captura `visual-actions/actions-1280.png` mostra a divergência com as datas preenchidas e o JSON da simulação. A janela configurada e o público-alvo não devem ser alterados silenciosamente.
