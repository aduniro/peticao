# Etapa2 — rascunho compartilhado por contato

Modelo escolhido pelo dono em08/11: um rascunho por contato, autoria e versão,
retenção máxima30dias, sem envio automático. Backend em `a1f225b`; integração no
editor e ensaio compilado fazem parte deste mesmo bloco, ainda em validação.

## Persistência e proteção

Tabela aditiva `contact_drafts`, sem alterar assinatura, mensagem original ou
histórico de respostas. Assunto e corpo são cifrados por AES-256-GCM com contexto
vinculado ao UUID do rascunho. Campos parciais são permitidos; salvar não monta
prévia, não cria resposta e não enfileira e-mail. A auditoria contém somente
identidade do contato/rascunho, revisão e ator, sem texto ou cifra.

GET/POST `/api/admin/contato/rascunho` exigem Total, sessão real, confirmação
extra, origem e limite de taxa. Conta/nome do ator são relidos na transação;
autoria enviada pelo navegador não é aceita. Corpo limitado a32KiB, assunto150
caracteres, mensagem5000. Leitura é `no-store` e só retorna conteúdo após auditoria.

Cada mutação exige a revisão lida. Concorrentes sobre a mesma revisão produzem
um vencedor e um conflito; nunca sobrescrita silenciosa. Descarte/expurgo removem
somente a cifra, conservando identidade e revisão como tombstone. O expurgo e sua
auditoria são atômicos. Salvar normalmente não renova a validade. Um novo ciclo
após expiração/descarte exige ação explícita com revisão atual, conserva a
sequência de revisões e ganha novo prazo máximo30dias.

## Editor e estados

O editor carrega o rascunho ao abrir e informa autoria/revisão. Salvar e descartar
são ações explícitas; não há autosave nem autosend. Em conflito, mantém o texto
digitado e mostra a versão salva, permitindo escolher qual manter. Resposta
perdida provoca uma leitura de conferência, nunca repetição automática do POST.
Confirmação extra pode ser feita em outra aba sem perder o texto desta.

AV2/AV3 aprovados: resultado incerto não é chamado de falha nem sugere reenvio;
aceite do provedor não é entrega. O histórico identifica registros legados e
usa o estado durável, sem inferir resultado pelos booleanos antigos.

## Evidência obtida

- Primeira rodada dirigida:12/12, saída0,
  `/tmp/admin-contact-drafts-yi_9ujg7/validation.log`.
- Rodada com contrato browser-safe e estados:14/14, saída0,
  `/tmp/admin-contact-drafts-3ymvzvmb/validation.log`.
- Ensaio de schema: saída0 no mesmo diretório, `schema.log`. Fixtures publicadas
  de06/11 e diagnósticos07/11 preservados. São14 tabelas aditivas; identidade,
  cifra, revisão, autoria, prazo e tombstone do rascunho sobrevivem replay e
  bootstrap antigo, sem descriptografar ou enviar.

Os testes cobrem concorrência, campos/atores forjados, revogação, stepup/origem,
limite de corpo, rollback por falha de auditoria, expiração antes do cron,
descarte e novo ciclo. Logs locais em `.cache/qa-contact-drafts-20261108/`, fora Git.

`tools/admin-qa/contact-drafts.mjs` prepara teste real do editor React em duas
sessões e seis larguras, perda da resposta após commit, conflito, expurgo e
preservação das demais tabelas. Ainda não é evidência de execução: falta rodá-lo
contra build integrado, conferir capturas e registrar o resultado.

Não houve deploy, merge, provedor real, acesso ao banco real ou modificação de
revisão local de CPF/nome. Este bloco não conclui o painel integral.
