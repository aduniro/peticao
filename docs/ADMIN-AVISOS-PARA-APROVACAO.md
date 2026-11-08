# Avisos administrativos aguardando aprovação

Regra do responsável: “ANTES DE ALTERAR QUALQUER AVISO OU INFORMAÇÃO QUE APAREÇA PARA O USUÁRIO, VOCÊ DEVE ME PERGUNTAR ANTES.” As propostas abaixo foram perguntadas no chat; o status individual indica quais foram aprovadas e quais continuam **pendentes**. Este documento não as ativa na interface e não trata ausência de resposta como aprovação. O trabalho independente prossegue; a publicação não pode conter informação contraditória.

## Decisões vigentes recebidas em08/11/2026

Pergunta nativa `call_95ede63ed05d4fe39193934dd4f388ff`:

- Item0: “Aprovar este grupo de textos” aprova AV2, AV3, AV4, AV9, AV11 e AV12.
- Item1: “A única coisa que eu gostaria de mudar é a senha, que tem que ter pelo menos8 caracteres.12 caracteres é demais!” aprova AV1 com mínimo8, e AV5, AV6, AV7, AV13 e AV14 como apresentados. A validação administrativa e seus avisos devem concordar no mínimo8, preservando senhas/hashes existentes, revogação de sessões e confirmação extra.
- Item2: “Compartilhado por contato, com autoria e versão” decide AV16: um rascunho compartilhado por contato, proteção contra sobrescrita e retenção máxima30dias. Sem envio automático. A pergunta reservou os textos específicos do editor para apresentação antes da integração visual; eles continuam pendentes.

Essas decisões substituem os estados de espera dos relatos históricos abaixo.
Não equivalem a implementação ou teste concluídos e não autorizam deploy, merge,
envio real ou alteração de textos públicos/privacidade.

## AV-1 — Minha conta (aprovado em08/11/2026 com mínimo8)

Texto aprovado com alteração expressa do dono: “Pelo menos 8 caracteres. Ao trocar a senha, todas as sessões serão encerradas. Entre novamente com a nova senha.”

Motivo: a troca agora revoga as sessões atomicamente; o aviso anterior precisa refletir esse comportamento. Nenhuma redação alterada até a aprovação.

## AV-2 — Resposta de contato sem resultado confirmado (aprovado em08/11/2026)

Proposta: “Não foi possível confirmar o resultado do envio. Para evitar duplicação, a mensagem não será reenviada automaticamente. Confira o histórico antes de enviar outra resposta.”

Motivo: timeout ou falha após possível aceite não significa rejeição pelo provedor; o backend conserva a reserva e não reenvia automaticamente.

## AV-3 — Estados do histórico de contato (aprovado em08/11/2026)

Propostas: “Aguardando envio”, “Aguardando o texto”, “Envio em andamento”, “Aceita pelo provedor”, “Resultado a conferir” e “Recusada”.

Motivo: o histórico antigo distingue apenas enviada/agendada/falhou e classifica incorretamente os estados novos. Aceite pelo provedor não equivale a entrega na caixa de entrada. Linhas antigas precisam conservar a identificação de histórico anterior, sem inventar estados que não foram gravados.

## AV-4 — Convites e redefinições no painel (aprovado em08/11/2026)

Propostas: “Solicitação registrada. O e-mail está na fila de envio.” e “Não foi possível confirmar o envio do e-mail. Confira a situação do usuário antes de tentar novamente.”

Motivo: o resultado interno agora distingue aceite, fila e pedido sem envio. O handler administrativo antigo ainda não consome esse resultado; não declarar a interface corrigida. A recuperação pública mantém a resposta uniforme existente e não expõe a existência da conta.

## Limites

Não inclui mudanças de textos do formulário público, identidade, privacidade ou assinatura. Os modelos de e-mail existentes foram preservados. A autorização geral do plano não será interpretada como aprovação dessas novas redações específicas.

## AV-5 — Resultado indeterminado na Central de Ações (aprovado em08/11/2026)

Proposta: “Não foi possível confirmar o resultado da ação. Verifique a situação do serviço antes de tentar novamente.”

Perguntado antes da alteração; ainda pendente. O backend distingue esse estado e impede repetição de pedido externo incerto. O componente ainda não recebeu o novo texto: não liberar enquanto o código de estado não tiver apresentação clara e o fluxo de conciliação estiver concluído. O histórico/controle de conciliação também precisa de integração própria, sem edição arbitrária de registros.


## AV-6 — Descrição e dicas da janela na Central (aprovado em08/11/2026)

Proposta submetida ao dono: usar a descrição exata retornada pela simulação e os rótulos “Início da janela (vazio = padrão exibido na simulação)” e “Fim da janela (vazio = padrão exibido na simulação)”. Ainda pendente; nenhum texto/descrição foi alterado na tela.

Evidência: o componente mostra `a.efeito` estático, mesmo quando `saida.efeito` representa as datas escolhidas. Além disso, as dicas atuais indicam 04h/12h enquanto os instantes padrão `2026-11-04T04:00:00-03:00` / `2026-11-04T12:00:00-03:00` são exibidos pelo backend como 03h/11h em `America/Porto_Velho`. A captura `visual-actions/actions-1280.png` mostra a divergência com as datas preenchidas e o JSON da simulação. A janela configurada e o público-alvo não devem ser alterados silenciosamente.

## AV-7 — Histórico e conciliação da Central (aprovado em08/11/2026)

Propostas perguntadas no chat, ainda pendentes: “Histórico de ações”, “Conferir resultado” e “A conferência consulta o resultado do executor; não executa a ação novamente”. Não inseridas na interface. O backend pode prosseguir sem ativar novos textos. O resultado da publicação deverá distinguir pedido aceito, publicação concluída e resultado inconclusivo, sem rotular falha do deploy como ausência de efeitos.

## AV-8 — Triagem no Contato (aprovado em07/11/2026)

Aprovação explícita recebida por pergunta nativa: “Aprovar estes textos”. Autorizados somente “Análise automática”, “Reanalisar”, “Evidências”, “Sugestão de resposta” e “Revise a análise antes de responder. Nenhuma resposta é enviada automaticamente”. Não autoriza outros AVs, envio automático, deploy ou merge com a VPS. A integração visual local desses cinco textos está em validação. Os dados estruturados e as sugestões são apresentados como revisão; nenhuma proposta é confirmação ou ação executada. Não amplia aprovação dos demais avisos.

## AV-9 — prévia protegida de mensagens (aprovado em08/11/2026)

Perguntado no chat após preparar o backend e o ensaio visual com mensagem fictícia. Botão aprovado: “Ver prévia protegida”. Aviso aprovado: “Esta prévia oculta links, imagens e códigos e simplifica a formatação. O e-mail original foi preservado.” A máscara de exibição usa `[restrito]`. A integração visual local pode prosseguir; aprovação não equivale a implementação, validação ou deploy.

## AV-10 — recuperação de fila com aceite comprovado (aprovado em 07/11/2026)

Botão proposto: “Concluir fila sem reenviar”. Aviso proposto: “A fila será concluída com base no aceite já registrado pelo provedor. Nenhum e-mail será reenviado. Isso não comprova entrega ao destinatário.”

Submetidos ao dono antes de qualquer mudança visível, por solicitação nativa assíncrona. Resposta explícita recebida: “Aprovar estes textos”. Aprovação restrita ao botão e aviso acima; não aprova os demais AVs nem o deploy. Backend permite apenas concluir metadados com prova exata e Total + confirmação extra; não reenvia, não altera assinatura e não libera resultado incerto. A interface não foi ativada. Contrato em `ETAPA-03-RECUPERACAO.md`.

## AV-11 — complementos da tabela de recuperação (aprovado em08/11/2026)

Aprovados: colunas “ID”, “Tipo”, “E-mail”, “Data do aceite”; botões “Cancelar”, “Carregar mais”; falhas “Falha de rede. Confira o estado da fila antes de tentar novamente.” e “Não foi possível concluir a fila. Atualize a página para conferir o estado atual.” Submetidos novamente por pergunta nativa assíncrona e aprovados explicitamente no grupo de e-mail. A aprovação anterior do AV-10 não foi ampliada automaticamente.

## AV-12 — erro de paginação da recuperação (aprovado em08/11/2026)

Aprovado: “Não foi possível carregar a lista. Tente novamente.” Submetido novamente por pergunta nativa no grupo de e-mail. A falha deve conservar os itens já carregados. O componente preparado pode ser integrado e validado localmente.

### Registro da aprovação do grupo de e-mail

Em08/11/2026 o dono respondeu à pergunta nativa `call_95ede63ed05d4fe39193934dd4f388ff`, item0, com “Aprovar este grupo de textos”. A pergunta listava integralmente AV2, AV3, AV4, AV9, AV11 e AV12. Autoriza somente esses textos e sua integração/teste no candidato. AV1, AV5, AV6, AV7, AV13, AV14 e a decisão AV16 continuam independentes e pendentes. Não altera textos públicos ou privacidade, não autoriza envios reais, deploy ou merge.

## AV-13 — conflito na correção administrativa de e-mail (aprovado em08/11/2026)

Proposto ao dono por pergunta nativa: “O cadastro foi alterado durante a conferência. Atualize a página e tente novamente.” Sem aprovação inferida. A correção transacional usa por enquanto a mensagem já existente “Não foi possível salvar.” O novo texto não foi incorporado à interface. Contrato em `ETAPA-04-CORRECAO-EMAIL.md`.


## AV-14 — legenda legível da triagem (aprovado em08/11/2026)

Perguntado após a aprovação do AV-8, antes de adicionar legenda/novas mensagens. Campos propostos: “Categoria”, “Processamento”, “Diagnóstico”, “Prioridade” e “Histórico”. Estados: “Em fila”, “Em análise”, “Concluída”, “Falha técnica”, “Inconclusivo”, “Revisão necessária”, “Confirmação posterior ao relato”, “Normal” e “Alta”. Categorias: “Confirmação por e-mail”, “Link expirado”, “E-mail recusado”, “Nome/CPF”, “Pedido de remoção”, “Pedido de correção”, “Campus”, “Erro no formulário” e “Dúvida”. Falhas: “Não foi possível atualizar a análise. Reabra este painel para conferir o estado atual.” e “Os dados mudaram. Solicite uma nova análise.”

Objetivo: substituir códigos no resumo por legenda compreensível, preservando evidências técnicas completas e os limites do diagnóstico. Não altera o formulário público, não aprova identidade nem conclui que a mensagem chegou ao destinatário. Até resposta explícita, a interface usa os textos do AV-8 e dados estruturados recebidos, sem essas novas legendas. Não aprova outros AVs, envio, deploy ou merge com a VPS.

## AV-15 — remetentes arquivados e conflito de versão (aprovado em08/11/2026)

Pergunta nativa enviada em08/11 antes de alterar textos: “Arquivados”, “Restaurar”, “Remetente restaurado.” e “Este registro mudou desde que a página foi aberta. Atualize a página antes de tentar novamente.” Resposta explícita: “Aprovo os textos e escolho 30 dias”. O contexto eram estes quatro textos e a pergunta separada de retenção. Autoriza integrar e testar estes controles no candidato; não aprova outros AVs, avisos públicos, WAHA, envio, deploy ou merge com a VPS.

## AV-16 — rascunho compartilhado (modelo aprovado em08/11/2026; textos pendentes)

Pendência registrada no handoff e reafirmada expressamente na tarefa Contato.
Os textos exatos da proposta anterior não constam neste catálogo; esta nota não
reconstrói um aceite nem os substitui por mensagens novas.

Nesta sessão foi emitida pergunta nativa sobre a decisão necessária ao backend:
rascunho único compartilhado por contato com autoria/versão, individual por
administrador/contato ou manter pendente. Ainda sem resposta observada. A pergunta
explicita que30dias já foram aprovados, mas textos/interface continuam dependendo
de aprovação específica. Não interpretar retenção/AV15 como aceite de AV16.

Enquanto isso, foi implementada e validada a consulta independente somente leitura
de histórico/campi/triagem (`ETAPA-02-HISTORICO-CONTATO.md`), sem persistir rascunho,
conectar controles, alterar texto/estética ou enviar respostas automaticamente.

## AV-17 — resultado de envio de lote a conferir (aprovado)

Na continuação de08/11, o bloqueio de repetição automática após reserva/resultado
incerto foi reforçado. O aviso legado “falha(s), tente novamente” pode sugerir
uma repetição que o backend não autoriza com segurança.

Pergunta nativa submetida: substituir somente esse trecho por “Resultado do envio
a conferir. Verifique o histórico antes de tentar outra ação.”. Em08/11 o
principal transmitiu a decisão explícita do dono: “APROVAR ESSE AVISO DOS LOTES”.
Autoriza esse texto, preservando as contagens existentes e fontes/layout, sem
pontuação dupla. Aplicado somente ao resumo com falhas. Não altera o texto do
e-mail, formulário público, assinatura digital ou restante do resumo de aceites.
Não aprova outros AVs, deploy ou merge. A aprovação é posterior a `8436fa2`;
naquele snapshot cumulativo o AV17 ainda constava pendente.
