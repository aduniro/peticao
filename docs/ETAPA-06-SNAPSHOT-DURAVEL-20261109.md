# Snapshot durável e retomada do preparo

Unidade local posterior ao portal `06e4792`, no candidato
`candidate-stage02-domains`. Blocos `db.ts`/`batches.ts` coordenados exclusivamente
com o principal. Sem deploy, escrita VPS, credenciais reais ou alterações nos
fluxos públicos de CPF/assinatura.

## Reserva e integridade

Uma tabela aditiva `batch_preparations` guarda a lista exata usada na reserva,
metadados do PDF, data de geração, origem/autoria da criação, método do assinador,
versão do contrato de renderização e hash integral. A inserção compartilha a
transação da criação do lote, vínculo das assinaturas e auditoria. Falha nessa
transação não deixa lote, snapshot ou vínculo órfão.

O fluxo não atualiza os campos do snapshot. Sua integridade é conferida pelo hash,
pela lista/contagens do lote e pelo hash registrado na auditoria original da
criação. Alterar payload e recalcular apenas seu hash não autoriza reconstrução.
O snapshot contém os campos já destinados ao PDF, sem CPF bruto, e-mail de
assinante ou resultados privados da ferramenta local de revisão de nomes.

O preparo inicial passa a consumir o snapshot persistido. Uma nova confirmação ou
edição cadastral posterior não muda a lista reservada. O documento existente
permanece protegido por estado, ausência de aprovação/bytes, hash e reserva de
execução; PDFs preparados/assinados/enviados não são sobrescritos pela retomada.

## Retomada explícita

`POST /api/admin/lotes/[id]/preparar` exige conta Total ativa, mesma origem,
confirmação extra e corpo limitado sem campos adicionais. O portal oferece o
botão apenas para lote `preparing`, sem PDF e com snapshot. Lote legado sem
snapshot recebe indicação explícita; não se reconstrói sua lista consultando os
cadastros atuais.

Cada execução adquire uma lease de cinco minutos e incrementa a tentativa dentro
da transação. Outra execução recebe `busy` enquanto a lease estiver ativa.
Depois de interrupção externa, a lease expirada pode ser substituída por uma nova
tentativa explícita. Antes da publicação interna dos bytes, o ator é revalidado,
o documento/snapshot conferidos e o token/prazo da lease comparados. Worker
atrasado não publica sobre outro nem libera a lease dele.

Bytes, hash, tipo, estado `prepared`, liberação da lease e auditoria pertencem à
mesma transação. A auditoria `batch_prepared` mantém a autoria da criação; eventos
de início/conclusão da recuperação identificam separadamente quem retomou. Falha
de auditoria reverte a publicação interna; a lease da própria tentativa é liberada
para permitir revisão/retomada posterior. Não há aviso ao aprovador, código ou
envio de lote durante a recuperação. O aviso já existente da criação inicial
mantém seu comportamento anterior.

## Esquema e reversão

O checker estrito de atualização passa de14 para15 tabelas aditivas, com a nova
tabela nomeada explicitamente. Nenhuma coluna antiga foi substituída. A fixture
confere snapshot textual, hash, identidade, tentativa, token, prazo e timestamps
com microssegundos após reaplicar DDL e bootstrap antigo. A migração não fabrica
snapshots para lotes antigos.

Rollback de código preserva a tabela nova e seus registros. Não executar
`DROP TABLE`, remover vínculos ou alterar documentos para simular uma reversão.
A versão antiga ignora a tabela; a versão nova só retoma reservas cuja lista e
auditoria correspondem. Procedimento de publicação/migração real depende do gate
do principal e de autorização separada.

## Evidências e limites

Primeira rodada: `python3 tools/admin-qa/batch-local.py --tests preparation`,
**42/42**, zero falhas/ignorados/cancelados, seguida de ensaio aditivo aprovado.
Log original `/tmp/admin-batch-local-fpimqlwl/validation.log` e
`schema-upgrade.log`. Tipos direcionados:18 raízes/600 arquivos importados,
zero diagnósticos, sem typecheck/build global. A rodada final após ampliar os
casos de revogação e proteger o retorno HTTP também passou: **42/42**, seguida de
migração aprovada, saída0. Evidências finais em
`/tmp/admin-batch-local-yybgevnz/{validation,schema-upgrade,document-types}.log`;
cópias conferidas em `.cache/qa-batch-preparation-20261109/`, fora do Git.

As fixtures exercitam lista alterada depois da reserva, confirmação posterior,
hash adulterado, método divergente, legado sem snapshot, concorrência, lease
expirada, worker atrasado, revogação, origem/nível/stepup, falha de auditoria e
replay sem alterar bytes já preparados. Dados são fictícios, PostgreSQL54357 em
diretório temporário exclusivo, entrega dev e fontes de configuração vazias.

O contrato `batch-pdf-v1` vincula versão/texto da petição. Alterações de layout,
assets ou dependências de renderização exigem versionar esse contrato antes de
retomar documentos antigos. A recuperação gera bytes a partir da reserva quando
a tentativa anterior não persistiu PDF; não promete igualdade binária com um
arquivo que nunca foi salvo. Não altera bytes de documentos existentes.

ICP-Brasil continua condicionado ao validador e à guarda de produção. Método
próprio e gov.br continuam separados e inativos; conta/senha/código não viram
assinatura jurídica. Portal externo/desafios e QA integrado nas seis larguras
continuam pendentes de suas próprias unidades/janela coordenada. O marco não
representa conclusão de todo o módulo nem build global verde.
