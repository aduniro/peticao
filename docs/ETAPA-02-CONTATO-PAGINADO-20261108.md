# Etapa2 — lista operacional de contatos

O Contato anterior mostrava somente os200 registros mais recentes, sem controles
para alcançar os antigos. A página agora usa consulta paginada independente, sem
alterar a função de gravação/encaminhamento do contato público.

## Contrato

Sessão e nível Edição continuam exigidos pela página; responder e gravar rascunho
mantêm seus próprios gates Total/stepup. Cada página retorna até25 contatos,
ordenados por ID decrescente, com cursor do último registro visível. O caminho
“Próximas mensagens” conserva tipo/busca; “Primeira página” volta ao início e
inclui novos contatos. Não há teto global de200. Inserções novas não reaparecem
nas páginas antigas; cada consulta tem snapshot próprio e contagem consistente.

Filtros cumulativos: tipo (`duvida`, `bug`, `outro`) e trecho literal do nome ou
e-mail. `%`, `_` e barra invertida da busca não viram curingas SQL. Parâmetros,
tamanhos e limites são verificados em runtime; SQL usa parâmetros vinculados e
transação somente leitura com timeout3s. Não agrupa pessoas pelo e-mail nem
inventa threads, não envia mensagens e não escreve metadados do contato.

Falha da consulta é apresentada como indisponibilidade, não como zero contatos.
Filtros inválidos são sinalizados. Sem resultados e fim de página são distintos.
O estado histórico `mailed` é descrito como aceite registrado/sem aceite
registrado, sem afirmar entrega à caixa do destinatário.

## Evidências

`contact-list.test.ts`, `contact-drafts.test.ts`, `contact-history.test.ts` e
`contact-replies.test.ts`: **24/24**, zero falhas/ignorados, saída0 em
`/tmp/admin-contact-list-n0q5yvko/validation.log`.

Casos novos:207 contatos percorridos sem duplicações, confirmação nova entre
páginas, total/limite, microssegundos, filtros combinados, e-mail, busca literal,
vazio e rejeição de cursores/tipos inválidos. Originais e tabelas de assinatura,
respostas e envio preservados. As regressões adjacentes conferem autorização,
concorrência, falha/retomada e ausência de repetição automática de envios.

`tools/admin-qa/contact-list.mjs` prepara o ensaio SSR/browser por nível, filtros,
paginação com nova inserção e indisponibilidade/retorno da fonte, com capturas
320/390/1280px. Ainda aguarda execução no próximo build integrado; os24 testes
não substituem esse ensaio visual. Sem deploy, merge ou dado real alterado.
