# Etapa6 — fluxo visível do documento final e presidente

Estado: **continue**, marco local de portal/download validado em09/11 UTC.
Não declarar o portal externo/módulo completo nem build integrado final verde.
Fonte de escopo: auditoria `c401848`, seção Etapa6 da auditoria de06/11 e pedido
original em `/mnt/dev/peticao/LOG-2026-11-04-planejamento-admin-v2.md`, itens1.8/2.
O responsável é o presidente da ADUNIR; este é o fluxo de assinatura da petição.

## Primeiro fluxo local demonstrável

1. Portal administrativo no padrão v2, com entrada no menu e acesso Total mais
   confirmação extra. Reaproveitar os controles existentes de criação final,
   download, upload ICP e código humano; manter autoria transacional e retorno
   ao documento correspondente. Não inventar credenciais de portal externo.
2. Exibir documento final/lotes, número, tipo, estado, contagens, responsável
   configurado, hash integral original/assinado, versão da lista e resultado da
   validação. Mostrar metadados reais do candidato, sem fabricar assinatura.
3. Apresentar prévia e download dos bytes existentes, preservando PDFs anteriores,
   layout e QR de cada assinatura. Método local/upload ICP fica separado de
   assinatura própria do app e gov.br. Serviços sem credenciais permanecem inativos.
4. Upload continua verificando estrutura e revisão, cadeia pelo adaptador existente
   e bloqueio de envio por `assertSendable`. Senha/CPF/nascimento não viram
   `signature_kind=icp-brasil`. Autenticação do responsável e assinatura são passos
   distintos; o fluxo externo ainda precisa de contrato próprio.
5. Usar os componentes/tokens atuais, sem nova estética. Reutilizar textos
   aprovados onde cabível; avisos específicos novos serão apresentados antes de
   ativar. Não alterar conta/rascunhos/UI email sob posse das outras frentes.

## Provas e limites

QA com lote final/assinantes fictícios e mail dev; Leitura/Edição/Exclusão negados,
Total sem stepup redirecionado e Total confirmado capaz de concluir o fluxo local.
Conferir versão obsoleta, documento congelado, bytes/hash e ausência de envio
automático. Navegador nas seis larguras do plano, teclado/foco e PDF fictício
renderizado para preservar o layout. Usar a skill PDF na inspeção visual.

Portal externo com desafio próprio, versionamento imutável de correções e snapshot
durável de preparo não podem ser declarados concluídos pela simples tela local.
DDL nova só após coordenar propriedade de `db.ts` com o principal/draft, com ensaio
aditivo. Gov.br/certificado/validador reais permanecem dependências de homologação;
sem leitura de cofre, credenciais inventadas ou redução da guarda ICP.

Não executar build global sem janela coordenada. Sem deploy/merge/escrita VPS,
envio externo ou promoção de decisões locais de CPF.

## Checkpoint de implementação

Autoria da criação manual commitada em `e5f5913`, com33 testes e tipos.
Entradas de lote commitadas em `507a634`: quatro casos puros e HTTP compilado
positivo em3035/54357, evidência `/tmp/admin-batch-local-amsu3m0x`.

Portal em working tree: `president-document.ts` (metadados paginados, final antigo,
seleção por ID, bytes exatos e auditoria nominal); `/admin/presidente/page.tsx`
(passos documento/assinatura/aprovação, PDF inline, hashes, comprovantes e métodos
externos desativados); `batch-return.ts` (retorno interno fixo); integração nas
rotas de lote/PDF/conciliação e link em Lotes. `president-document.test.ts`
preparado. Textos administrativos usam a autonomia explicitamente concedida pelo
dono; não há alteração de avisos públicos, CPF ou privacidade.

Próxima validação: `python3 tools/admin-qa/batch-local.py --tests portal`, somente
54357 e fixtures fictícias. Duas solicitações desse comando foram recusadas pelo
executor com `rejected by user`, sem razão detalhada apresentada. Nenhum teste do
portal foi efetivamente executado; o comando de tipos subsequente não iniciou.
Não houve tentativa por outro wrapper/agente/worktree. É necessária revisão
técnica dessa execução para fechar testes/commit do portal.

## Marco local validado em09/11 UTC

A frente DOCUMENTOS foi reativada explicitamente pelo responsável. A inspeção
dos retornos antigos mostrou apenas `Rejected("rejected by user")`: recusas de
aprovação daquela execução, sem motivo detalhado, sem registro de
`Potentially unintended activity` nem indicação de defeito do runner. Não foram
reinterpretadas como falhas técnicas. A retomada autorizou testes locais fictícios
necessários; nenhum pedido de elevação foi usado na nova execução.

Executado do candidato: `python3 tools/admin-qa/batch-local.py --tests portal`.
Resultado **29/29**, saída0, zero falhas/ignorados/cancelados. Inclui cinco casos
de portal/retorno/download, autoria/criação, reserva concorrente do documento,
rejeição/replay, controle de envio e validação ICP estrita. Banco exclusivo54357,
diretório temporário próprio, configuração vazia e entrega dev; nenhum build,
servidor HTTP, conexão VPS ou envio real. Hashes das fontes da frente conferidos
antes/depois pelo runner. Evidência original:
`/tmp/admin-batch-local-900tsz5y/validation.log`.

O download exige Total e confirmação extra, valida IDs e registra o ator real,
hash e intenção de prévia. Testes conferem bytes originais/assinados, cabeçalhos
sem cache, negação para os outros níveis/revogação e falha fechada quando a
auditoria falha. Documento congelado não habilita upload/cancelamento; método
próprio, gov.br e externo não validado não viram ICP nem passam a guarda de
produção. Nenhuma assinatura fictícia foi tratada como homologação real.

Tipos direcionados aos13 arquivos desta unidade e597 arquivos importados:
**zero diagnósticos**, saída0, `document-types.log` no mesmo diretório de QA.
Não é typecheck global do candidato nem exclui o erro Rich conhecido. Não foi
executado build global ou usado build anterior para afirmar que a página nova
está compilada. Navegador/seis larguras/PDF renderizado permanecem pendentes de
janela de build coordenada. Cópia dos logs/hashes em
`.cache/qa-president-20261109/`, fora do Git.

Próxima unidade: snapshot durável da lista reservada e recuperação de preparo,
sem alterar bytes já publicados/autoria/ICP. Portal externo/desafios e documento
final completo continuam no plano integral; o marco local não os substitui.

Depois: corrigir somente falhas da frente portal, conferir tipos globais sem
excluir pendências, coordenar build único e QA HTTP/navegador nas seis larguras,
inspecionar PDF fictício e fechar commit com evidências. Portas54349/54351 ficam
fora desta frente. Nenhum processo de QA do portal permaneceu ativo.

Rich/IA estão suspensos por instrução do principal após interrupção automática;
preservar esses WIPs, sem corrigir/retomar/executar por outra frente. O principal
informou erro estático em `rich-text.ts:34` (`namespaceURI`); não foi corrigido nem
excluído para obter verde. A cumulativa545/545 pertence apenas a `c975304`, não ao
portal atual. Menu global continua com root/IA; `db.ts`, senha, rascunhos e UI de
e-mail não foram editados por esta frente.
