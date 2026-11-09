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

## Validação integrada do primeiro candidato

O principal executou `--contracts mail-recovery mail-preview contact-drafts`
contra o build integrado: saída0 em
`/tmp/admin-consolidation-k2jdskrz/validation.log`, com
`contact-drafts.json` positivo. Duas sessões e o editor React real comprovaram
conflito sem perder texto, escolha explícita da versão, resposta perdida depois
do commit conciliada por GET sem repetir POST, prazo fixo, expurgo, novo ciclo,
descarte e revogação. Contatos originais, assinaturas e tabelas de envio foram
preservados; nenhuma mensagem enviada ou texto na auditoria.

Capturas em320/390/768/992/1280/1920px. O agente do bloco inspecionou390 e1280:
controles legíveis e dentro da largura, sem trocar fontes, cores ou layout
global. A barra fixa capturada no meio do documento completo corresponde ao
scroll do ensaio, não a uma nova regra de posicionamento deste bloco. Evidências
copiadas com prefixo `baseline-` e manifesto SHA256 no diretório de QA local.

## Complemento — cifra indisponível

Uma falha de decifragem não é rascunho vazio. O backend conserva a cifra e retorna
`unavailable`; o editor agora mostra aviso, mantém o texto local e impede salvar
ou montar prévia até carregar corretamente ou descartar explicitamente. Em
conflito, uma versão indisponível também não pode ser sobrescrita sem resolução.

Rodada dirigida atual:15/15, saída0 em
`/tmp/admin-contact-drafts-_qfheu8y/validation.log`. A nova regressão comprova que
ler uma cifra fictícia inválida não muda a linha nem a revisão e não envia.
O contrato de navegador foi ampliado para simular a falha, conferir os controles
bloqueados, tentar carregar sem escrita e restaurar a cifra para recuperar o
conteúdo. Essa ampliação ainda precisa da próxima rodada de build/HTTP; o
baseline anterior não certifica automaticamente esse complemento.

Não houve deploy, merge, provedor real, acesso ao banco real ou modificação de
revisão local de CPF/nome. Este bloco não conclui o painel integral.
