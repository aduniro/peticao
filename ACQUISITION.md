# Aquisição concreta R1 — em preparação para revisão

`scoped_acquire.py` é uma rota proposta de exceção estritamente contextual. Não é
o protótipo inerte `context_draft.py`: há implementação de aquisição real para
execução posterior pelo Root. Infra executa apenas testes em bancos temporários;
não executa nem mesmo check sobre um pacote real ainda incompleto. A CLI
canônica continua recusando seus ACKs globais pendentes. Não dizer que ela passou.

Operação única ADMIN-QUERY-R1-20261114; source c472837, harness09d1 completo,
runtime278345 e imagem5a582 completos fixados no código. Não há opções para outro
release, nuvem, Neon, ator, banco, recurso ou destino. O comando de entrada exige
CODEX_THREAD_ID da sessão Root. Essa identificação é cooperativa, como a do
ledger existente, e não uma autenticação criptográfica contra administrador local.

## Pacote e consentimento técnico

Antes do freeze, `BINDING.json` conterá operationId, manifestSha256,
receiptSha256, coordSha256; `OPERATION-RECEIPT.json` conterá os recibos reais.
Não preencher valores fictícios ou placeholders. Hash do manifesto corresponde
ao MANIFEST.json final de admin-query-r1-publication-20261114. SHA do coord.py
é fixado no código e deve continuar idêntico. Manifesto vincula seis evidências,
incluindo autorização do dono e snapshot QA imutável, além do operador publish.py.
As três linhas USER originais são verificadas com SHA incluindo LF e papel user.

Cada entrada notices do recibo contextual exige event, fingerprint original,
missingAck real, author original, relevance=outside-r1, appliedGlobally=false,
authorEvidence e independentEvidence (listas de referências path/sha256).
Categorias e provas:

- archived-completed/completed-verified, standby-inert/inert-verified ou
  reviewed-only/reviewed-not-executed: stateEvidence, ACK técnico original do
  par e falta exclusiva de Executor61. Standby2392 não foi instalado: usar
  reviewed-only com prova de recusa do gate; nunca alegar instalação concluída.
- withdrawn ou superseded/not-executed: declaração do autor/operador,
  nonExecutionEvidence, correctionEvidence, nackPreserved=true; replacement com
  event/fingerprint/evidence e scope=neon-only-no-workers-no-cutover; ACKs reais
  Root e Apoio no replacement. Não declarar todo o plano2586 não executado.

Root e Apoio devem revisar os bytes finais desta rota, manifesto e recibos. Cada
review JSON deve conter actor, decision=pass, purpose=r1-scoped-acquire e binding
igual ao bloco operation_scoped abaixo. Reviews antigas não qualificam esta rota.
Um NOVO notice Root requer manifesto normalizado com commit/files/tests,
api_contracts/database/destination, mais:

- operation_scoped: operationId, manifestSha256, receiptSha256, helperSha256.
- technical_reviews: mapa admin-recuperacao e apoio para path/sha256 de cada
  review atual vinculada exatamente ao bloco operation_scoped.
- caller: path/sha256 do run-publication-step.py congelado por Root, conferido
  pelo helper antes da aquisição e pelo próprio caller antes de cada SSH.
- resources: lista ordenada de RESOURCES, definida no helper.

Depois de conferirem esse notice, ambos registram ACKs reais novos, inclusive o
Root autor. Review files antecedem o notice; nenhum número futuro entra nas
reviews, evitando circularidade. Não criar ACK Executor ou disposition global.

## Operação futura exclusiva Root

Entrada padrão é check, sem aquisição, intent ou escrita no ledger. A opção
--acquire implementa a aquisição, mas só poderá ser usada pelo Root após review
e freeze completos. Root libera sua preparação479 que colide com o pacote.
Antes da aquisição, preservar diretório privado0700 e ausência dos dois arquivos
operacionais (não apagá-los se já existirem).
Intent e capability são gravados diretamente em admin-query-r1-root-20261114,
onde o caller Root os lê. RESOURCES também reserva esse diretório e o do helper;
editores desses caminhos devem liberar suas leases antes da aquisição crítica.

O helper valida todas as provas e ACKs; grava intent exclusivo e durável antes
de qualquer mutação; revalida dentro de BEGIN IMMEDIATE, verifica todos os
conflitos inclusive uncertain/expired, inclui code global e usa fence monotônico,
token novo e verificação canônica. Expiração usa método canônico em transação
separada, persistindo incerteza mesmo quando a aquisição falha. Não altera
coord.py, atores, ACKs, notices ou dispositions; checa fingerprint dessa projeção
antes/depois. Acrescenta eventos lease_acquired e r1_scoped_acquired explícitos,
sem alegar gate global concluído. A capability é exclusivamente do Root, privada
0600, com gravação atômica/durável; o token nunca aparece na saída.

Qualquer nova pendência, ACK/hash/estado diferente, NACK não comprovadamente
corrigido, conflito, timeout ou intent existente interrompe a operação. Mesmo
lease já liberado não autoriza repetir esta operação: evento de uso único impede
replay. Falha depois do commit pode deixar lease real com capability incompleta;
reconciliar com recibos/ledger antes de qualquer outra tentativa. Nunca apagar
intent, tomar lease ou reutilizar token para fazer retry. Não existe SSH ou deploy
neste helper. Root deve verificar capability/fence/TTL antes de cada preflight,
switch e verify remoto, e renovar/liberar sua própria lease quando necessário.

As evidências e a autorização continuam cooperativas: SHA prova integridade,
ACKs atuais registram review, mas não substituem conferir autoria e resultados
reais. A revisão desta exceção ainda é separada da revisão do app/imagem.
