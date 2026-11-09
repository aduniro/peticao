# Política central dos seletores e dropdowns

Decisão expressa do responsável em 09/11/2026. Obrigatória em todos os formulários e seletores equivalentes do aplicativo.

## Clique navega; digitação pesquisa

- Clicar no corpo do campo ou na seta abre a lista COMPLETA das opções permitidas naquele contexto, mesmo quando já existe valor selecionado ou texto preenchido.
- Receber foco sem digitação também não deve usar o valor selecionado como filtro de pesquisa.
- SOMENTE digitar/editar o texto ativa a busca filtrada e o ranking de pesquisa existente.
- Clicar novamente no campo, inclusive quando ele já está focado depois de uma seleção, volta à lista completa. Não depender somente de onFocus nem limitar a correção à seta.
- Abrir a lista não apaga nem substitui a seleção atual e não dispara a gravação do formulário.
- Lista completa não significa misturar categorias: hospitais apenas da EBSERH; instituições apenas as elegíveis; lotações apenas da instituição selecionada; cidades apenas da UF selecionada; universidades apenas do país selecionado. Sem UF, a busca nacional existente continua permitida.
- Não truncar silenciosamente a lista de navegação usando os limites de resultados da busca digitada. Quando os dados forem assíncronos, carregar a lista completa do contexto e descartar respostas de contextos anteriores.
- Preservar os filtros de digitação, tamanhos, fontes, layout e validações de backend. Esta regra de interação não aprova domínio, instituição, hospital ou município inválido.

## Regressões obrigatórias

Testar separadamente: clique na seta; clique no corpo de campo com seleção; clique no corpo já focado após selecionar uma opção; foco por teclado; digitação seguida de novo clique; troca de categoria, instituição, UF e país. Incluir o caso reproduzido pelo responsável: HC-UFG selecionado, clique no corpo do campo e todas as 48 unidades EBSERH disponíveis, mantendo HC-UFG selecionado até nova escolha.

Uma conferência apenas da seta não comprova esta política. Registrar os casos efetivamente testados e corrigir falhas antes de considerar a tarefa concluída. Deploy e migrações da VPS continuam sujeitos à autorização do responsável.
