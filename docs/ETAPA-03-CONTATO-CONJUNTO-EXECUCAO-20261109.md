# Contato em conjunto: confirmação durável e execução

Continuação explícita do marco `deec662`, somente backend. A confirmação precisa
selecionar destinatários aprovados; uma prova de prévia nunca é autorização.
Nenhum frontend/texto, rich/IA, credencial, serviço, VPS ou deploy foi alterado.

## Intenção e reserva antes do transporte

`reserveContactGroup` recebe UUIDv4 por ator, entrada da prévia, prova e lista
explícita de IDs aprovados (subconjunto único de1a20casos selecionados). A intenção
canônica liga seleção, template, prova e aprovados. `contact_reply_groups` guarda
ator/requestID/fingerprint/prova/IDs/data; `contact_reply_group_items` guarda os
vínculos exatos contato/resposta/rodada. Esses ledgers não duplicam corpos,
e-mails ou rascunhos: o payload permanece em `contact_replies`, com sua retenção.

A transação usa ordem estável de travas: gestão de conta, conta/sessão atuais,
intenção, rascunhos por ID, contatos por ID e linhas dos rascunhos. A conta precisa
ser Total ativa e a sessão possuir confirmação extra vigente, verificada também
antes/depois das reservas usando relógio atual. A provaHMAC não substitui isso.
A prévia é recomposta na mesma transação sob as travas das fontes. Todos os casos
aprovados devem permanecer elegíveis e com o mesmo contexto antes da primeira
reserva; qualquer divergência retorna conflito sem reservar parte do grupo.

O núcleo de reserva de `enviarResposta` foi extraído para
`reserveContactResponseWith`. O fluxo individual continua usando esse mesmo
núcleo e seu dispatcher anterior; seus contratos e testes não foram substituídos.
Texto e card, destinatário, assunto, conteúdo, cópia ao dono, Reply-To, selo e
rodada são congelados pelos mecanismos existentes. Card continua bloqueado até
aceite do texto e segue agendamento de aproximadamente1minuto. Não há transporte
na transação: ledger, itens, reservas e auditorias comprometem juntos ou revertem.

Depois do commit, `executeContactGroup` chama somente `dispatchContactReply` dos
IDs reservados, com até3execuções concorrentes. O próprio executor existente
reserva a tentativa, respeita supressões/guardas atuais e mantém resultados
incertos sem nova tentativa automática. Não foi copiado outro transporte nem
adicionado um emissor. Uma queda após commit deixa itens duráveis para o worker
existente; isso é a primeira tentativa autorizada, não um reenvio pela interface.

## Repetição e resultado perdido

O mesmo requestID/entrada retorna o grupo reservado e os estados atuais, sem
chamar o dispatcher novamente. MesmoUUID com entrada divergente retorna409.
Outro requestID com contexto antigo não cria rodada duplicada. As travas do
contato e os selos do núcleo existente também impedem duplicação ao concorrer
com uma resposta individual.

`POST /api/admin/contato/grupo/confirmar` exige Total+confirmação extra, origem,
limite de taxa, corpo limitado e campos fixos. Não contém configuração de emissor
ou autorização implícita derivada do texto. `GET .../grupo/resultado?requestId=...`
é a recuperação após resposta perdida: snapshot somente leitura, mesmo ator
atualmente autorizado, sem reservar, reivindicar job ou emitir mensagem.

Resultado é por destinatário, com IDs de resposta/rodada, estado e código seguro
de texto/card. `delivery:not_inferred` impede confundir aceite do provedor com
entrega. Incerto, preparado e recusado continuam distintos. Não há promessa de
que a chamadaHTTP aguardará a entrega, nem POST automático de recuperação.

## Concorrência e retenção

A revisão encontrou uma janela concreta: o expurgo pode modificar rascunhos sem
usar a travaadvisory7006 do editor. Foi acrescentada trava de linha compartilhada
nos rascunhos durante a reserva. O teste de concorrência segura a reserva numa
barreiraSQL, tenta a escrita concorrente real e comprova bloqueio até liberar a
transação. Expiração de confirmação extra ocorrida depois da primeira reserva
também reverte o grupo todo, sem transporte.

A política existente de30dias continua expurgando os payloads de texto/card,
preservando os recibos e os vínculos do grupo. Não há cópia de conteúdo no ledger
capaz de reviver um corpo expirado; replay não despacha esse conteúdo. Nenhum
rascunho, assinatura, decisãoCPF ou cadastro é editado por esse fluxo.

## Esquema isolado

Duas tabelas aditivas na worktree `candidate-referral-management-20261109`:
base local17→**19tabelas**. O checker compara todas as definições anteriores e
preserva intenções, autoria, vínculos exatos e microsegundos ao repetirDDL e
bootstrap antigo. A reconstrução exclusivamente de teste da tabela de contato
legada remove/recria sua FK aditiva ainda vazia, com assertivas de vazio antes;
não existeDROP no DDL da aplicação nem perda de dados em migração.

O principal integra outros aditivos em paralelo; a união prevista precisa ser
conferida na base consolidada (previsão22), sem tratar a prova local19como
validação da produção ou descartar as provas das demais frentes.

## Verificação

**41/41 testes passaram**, zero falhas/cancelados/ignorados: onze casos novos mais
prévia conjunta, respostas individuais, rascunhos e retenção existentes. Provas:
texto/card/BCC e agendamento; queda após reserva e recuperaçãoGET/worker;
concorrência do mesmo request e com caso individual; reuso divergente;
rollback integral de auditoria/contexto; parcial incerto sem reenvio;
autorização atual/expiração durante reserva; proteção contra escrita concorrente
de rascunho; expurgo e HTTP401/403/400/413/recuperação. O HTTP positivo usou
**MAILdev**, e os demais transportes foram funções injetadas fictícias.
Absolutamente nenhum provedor real ou endereço real recebeu mensagem.

Ensaio de atualização: saída0/19tabelas locais; tipos isolados:0. Primeira rodada
39/39+schema/tipos0 foi preservada; os dois testes adicionais validam o reforço
final descrito acima. Não houve build ou navegador.

Evidências finais `/tmp/admin-contact-group-execution-qcq6k54q/`; primeira
`/tmp/admin-contact-group-execution-c3xeu15f/`; cópias/checksums em
`.cache/qa-contact-group-execution-20261109/`. Fontes estáveis por execução;
PostgreSQL54356fictício encerrado e porta liberada.

Próximos marcos: consolidar oDDL com os outros módulos e repetir o checker;
UI de seleção/prévia/confirmação e textos aprovados; QA compilado da interação
com resposta perdida. Esta entrega não autoriza deploy ou envio pela produção.
