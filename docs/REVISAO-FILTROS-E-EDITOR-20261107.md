# Revisão local: filtros e editor de nome

Alteração limitada à ferramenta em `http://127.0.0.1:8765/`, compartilhada pelo acesso Tailscale. Não houve alteração no site, no SQLite das assinaturas da VPS ou nas decisões por código de teste.

## Correções

- Filtros independentes de CPF e nome, combináveis entre si, com todas as classificações, busca, confirmação e paginação. O filtro de CPF acompanha as abas existentes. Decisões desatualizadas de nome entram como pendentes, como no editor. Lotes respeitam os filtros.
- A primeira verificação na base real detectou lentidão por recálculo de milhares de aprovações antigas. Foi introduzido um cache privado de rótulos derivados, sem nomes/CPFs em claro e sem substituir aprovações. Chaves consideram decisão, revisão, política e grafias relevantes; uma palavra não relacionada ou contagem de observações não invalida toda a base.
- O editor mantinha botões bloqueados até terminar a atualização da lista após salvar. Agora os libera imediatamente após a gravação, protege contra submissões simultâneas e permite reabrir e alterar um nome já aprovado. Falha de versão libera os controles para nova conferência.
- Falhas de consultas antigas não sobrescrevem o aviso da seleção mais recente.

## Validação

76 testes Python aprovados; `node --check` aprovado. Testes de navegador em banco fictício cobriram combinações dos filtros, categorias, abas, paginação antes/depois da filtragem, preservação do CPF, reabertura durante atualização lenta, alteração de aprovado, rejeição, volta à revisão e nova aprovação, além de conflito 409 e nova tentativa. Não houve erro JavaScript. Screenshots dos filtros em desktop/celular inspecionados; CSS permaneceu inalterado.

Na base real, quatro consultas GET verificaram as decisões retornadas em cada linha: CPF aprovado + nome pendente (1,76 s), CPF ainda não aprovado + nome aprovado (0,27 s), todos + nome pendente (1,83 s), todos + nome aprovado (1,60 s). Tempos e totais são do snapshot de verificação e podem mudar com novas decisões/entradas. Não houve POST de teste à base real.

Backup privado: `/mnt/dev/cpfs/backups/review-filters-20261107T190256Z/revisao.sqlite`. Todo o histórico de nomes anterior permaneceu idêntico; durante a conferência houve cinco novas decisões normais da sessão local, preservadas. Não se restaurou o backup sobre decisões novas. O servidor local foi reiniciado para carregar o módulo Python, mantendo o mesmo banco e token; gateway/Tailscale e recepção da VPS foram preservados.

Evidências em `.cache/review-filter-qa/`: `all-tests-validated.log`, `combined-final.log`, `name-editor-result.json`, `live-result.json`, `history-preservation.json` e capturas. Harnesses `qa_decision_filters.mjs` e `qa_name_editor.mjs` exigem configuração explicitamente fictícia e recusam a porta real 8765.

Salve edições abertas antes de atualizar a página uma vez para carregar o JavaScript novo. O botão inline “Nome aprovado” permanece indicador de aprovação; para mudar uma decisão use “Revisar nome para impressão”.
