# Indicações — roteiro de implementação e validação

## Problemas concretos

A tela anterior somava somente os primeiros 1000 códigos e consultava nomes de pessoas apenas para 60 códigos. A gestão administrativa já tinha backend com CAS e replay, mas não havia interface nem consulta por intenção para recuperar um resultado perdido. Os links públicos devem continuar operantes quando uma organização é arquivada administrativamente.

## Decisões desta etapa

- Preservar criação existente, códigos pessoais, vínculos, tokens e atribuição. Não alterar consumidores públicos de referrals.ts nem aparência dos formulários públicos.
- Separar consulta Leitura+ de gestão Edição+. Arquivar e restaurar exigem Exclusão+ e confirmação extra vigente no servidor.
- Inventário estatístico por id decrescente, 50 por página e máximo 100. Totais globais são calculados fora do recorte da página, no mesmo snapshot de leitura. Visitas são soma de visitantes distintos por código; não equivalem a pessoas únicas globais.
- Consultar pessoas de qualquer código por ação explícita, com paginação de assinatura.id. Nunca carregar listas nominais inteiras no HTML inicial.
- Cada código entra uma vez nas contagens: pessoal se tiver signature_id ou display_name; os demais são organizações. Legados mistos não se tornam editáveis por essa classificação: gestão conserva seus critérios mais restritos.
- Recuperar mutações pelo ator e nonce, com operação e versão esperada duráveis no ledger. Registros antigos sem esses metadados não podem ser tratados como edições: recuperação deve falhar fechada, preservando o replay antigo validado por HMAC.
- Não repetir POST automaticamente após rede incerta. Preservar intenção e edição em conflito; a confirmação extra usa o fluxo de acesso existente. Campos e textos novos permanecem com comentários MUDAR AQUI e classes existentes.

## Entrega já portada ao candidato

Backend de estatísticas globais e pessoas: dois endpoints privados, contratos fechados, reautorização de conta/sessão, timeout SQL e snapshot REPEATABLE READ. Nenhum DML é feito pela consulta; SHARE locks justificam não declarar a transação como SQL READ ONLY.

Evidência isolada: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/indicacoes-stats-db-1794308812451137321/result.json`. Tipos passaram e 6 testes passaram, incluindo 1007 códigos, 70 códigos com pessoas, 125 pessoas paginadas, inserção concorrente real e cabeçalhos/autorização HTTP. Isso ainda não comprova o conjunto final do candidato.

## Pendências para aceite

- Integrar backend de gestão, evolução aditiva do ledger e ensaio de bootstrap antigo/novo.
- Integrar Consulta, Gestão e a página SSR, preservando CriarIndicacao.
- Tipos globais, regressão dirigida e ensaio de schema no conjunto congelado.
- Build e navegador Next compilado com PostgreSQL fictício: consulta completa, detalhes depois do 60º código, mais de 100 pessoas, permissões, CAS e resposta perdida recuperada sem duplicação.
- Inspecionar capturas e registrar hashes, commit, resultados e limites antes de atualizar marcos de conclusão.

Nenhum deploy, merge ou sincronização com a VPS faz parte deste roteiro. O aceite local de Documentos permanece preservado; recursos reais de A1/govbr continuam separados.


## Integração da coorte

Backend, evolução aditiva, Consulta/Gestão e SSR foram portados. Ledger ganhou somente duas colunas nullable, operation e expected_version, com par de contexto válido ou ambos nulos para legado. Sem inferência e sem backfill; bootstrap anterior continua compatível. O ensaio global preserva explicitamente campos antigos e microssegundos, verifica novas colunas nulas e mantém o inventário de39 tabelas.

A revisão encontrou e corrigiu um travamento de recuperação legada na interface: só erro exato legacy_unavailable permite iniciar o procedimento local de abandono, com leitura posterior da linha, consentimento e referência ao UUID. Nenhum resultado antigo é afirmado nem POST é reenviado. Erro409 genérico/corrupção permanece a conferir.

Evidências privadas: gestão14/14 antes da guarda final, depois3/3 dirigidos relacionados com12 omitidos e tipos0; UI12/12 puros e browser dirigido, além da fixture anterior de6 larguras. Não somar essas rodadas como uma única suíte atual. A coorte comum ainda precisa validar as fontes juntas.

O novo executor compilado exige igualdade exata do manifesto de fontes do build, HEAD limpo e runtime de202 assets. As três janelas reais de61s entre grupos são preservadas. Semeadura do caso legado é declarada separadamente dos cenários de sessão nova sem intenção anterior.


## Verificação comum antes do build

- Tipos globais: exit0, fontes e runtime estáveis em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794309776554054256/result.json`.
- Regressão comum:43/43 testes passaram, sem omitidos, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/referrals-1794310145155438490/result.json`. Inclui testes anteriores de criação, vínculos e cartaz, mais gestão e consultas novas. A primeira rodada39/43 revelou somente a porta fixa do runner privado no teste de estatísticas; o guard agora admite exclusivamente as duas portas de QA conhecidas, mantendo loopback e envio dev. Nenhum guard de produção mudou.
- Ensaio global de schema: exit0 em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/schema-1794310235163390760/result.json`. Inventário de39 tabelas, versões, registros e bootstrap antigo/novo preservados; colunas novas legadas continuam nulas e timestamps preservam microssegundos.

O build fará nova checagem de tipos no estado final, incluindo o ajuste apenas de teste. Next compilado e inspeção visual ainda estão pendentes; não atribuir aceite completo a esta etapa intermediária.
