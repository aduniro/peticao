# Intenção idempotente para criação de indicação

Preparação local de 08/11/2026, checkpoint d8b8bac. Complementa a criação transacional existente. Nesse checkpoint ainda não estava ligada ao formulário nem à rota. A integração posterior é registrada abaixo, sem reinterpretar a preparação como QA aprovado.

A biblioteca aceita UUIDv4 de intenção, vinculado ao administrador atual e ao HMAC do rótulo normalizado. Repetição da mesma intenção e conteúdo devolve o mesmo código, sem outra auditoria ou renovação de datas. Outro conteúdo com a mesma intenção é recusado. Outra conta possui espaço de intenções independente e precisa manter permissão de Edição. A biblioteca sem intenção preserva o uso anterior por CLI.

`admin_referral_requests` guarda apenas o vínculo de conta, intenção, impressão digital, referência e horário. Criação do código, vínculo e auditoria usam a mesma transação; falha não consome intenção nem deixa código sem evento. Nenhum envio, alteração de assinatura ou reuso de código pessoal.

Há três regressões novas preparadas para concorrência/repetição, rollback e parâmetros/autoria. O ensaio estrito de migração foi ampliado para13 tabelas aditivas e preservação dos metadados de intenção com microssegundos. Esses testes ainda não foram executados: a suíte de retenção usa o banco de QA neste momento. Não disputar esse banco durante a validação em sequência.

Próximos gates: executar testes/migração, definir o transporte de intenção da interface preservando rascunho em falhas, integrar rota/formulário e validar HTTP real. Aparência e textos existentes ainda não mudaram. Nenhuma autorização de deploy ou merge com a VPS.

## Integração no candidato de domínios

A rota exige UUIDv4 em `requestId` (400 se ausente/inválido,409 se reutilizado
com outro conteúdo). Mantém as mensagens e o redirect303 existentes. Na repetição
válida, devolve o mesmo código; a URL devolve também o ID concluído para limpar
somente a intenção correspondente na aba. CLI sem intenção permanece disponível.

`CriarIndicacao` mantém o POST nativo, input, placeholder, botão e estilos. Um
campo oculto carrega o UUID; antes de submeter, rótulo e intenção são guardados em
sessionStorage da aba, sob conta/sessão. Voltar ao formulário após falha recupera
ambos; editar o conteúdo normalizado cria outra intenção. Não há execução
automática, transporte ou novos textos de conflito. Sem storage, o campo oculto
ainda protege repetição do POST, mas a recuperação depende do histórico nativo.

15/15 direcionados passaram após integrar a rota, incluindo requisições
concorrentes com mesmo UUID, conflito409, ausência400, autoria e metadados
inalterados. Build aprovado com aviso CSS preexistente. Tipos após build passaram
depois de corrigir apenas a anotação do parâmetro de uma fixture (`requestId:
string` para admitir o caso inválido vazio). A primeira checagem separada falhou
nessa anotação; não é apresentada como sucesso. Migração estrita13 aprovada.
HTTP compilado, navegador e cumulativa ainda serão registrados após execução.

## HTTP compilado observado e gates restantes

O contrato compilado passou em `/tmp/admin-consolidation-ivmek__7/referrals.json`:
repetição concorrente devolve o mesmo código, conflito409, rollback do ledger na
falha de auditoria, recuperação, autoria de domínio e bloqueio após revogação.
Assinaturas fictícias e filas preservadas, nenhum envio. O JSON foi lido e
conferido nesta sessão; não é inferência baseada no commit.

O navegador dessa rodada parou na criação da conta fictícia: a senha continha
o local do e-mail e foi corretamente recusada. A fixture foi corrigida, mas a
repetição não iniciou porque a espera expirou na supervisão (conforme esclarecido
pelo responsável; não houve recusa do dono). Não há prova
de navegador aprovada para o novo formulário neste checkpoint.
Ver `ETAPA-CONSOLIDACAO-CHECKPOINT-20261108.md` para todas as pendências.

## Retomada autorizada — navegador aprovado

O responsável esclareceu a expiração da espera anterior e autorizou os comandos
locais. Após adequar apenas o runner ao Node24 do Playwright, o navegador passou
em390/1440px: erro antes do commit e resposta perdida após gravar preservam o
rótulo/UUID; a tentativa explícita seguinte devolve o código existente, sem
duplicar evento nem alterar datas do ledger. Sucesso limpa somente a intenção
concluída da aba. Zero exceções; capturas inspecionadas, sem mudar estilos/textos.
Evidências em `/tmp/admin-consolidation-mt5_ik22/referrals-browser.json` e capturas
na mesma pasta. A cumulativa corrigida ainda está em execução neste checkpoint.
