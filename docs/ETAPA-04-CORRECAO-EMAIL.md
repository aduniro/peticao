# Etapa 4 — correção administrativa de e-mail

07/11/2026. Complemento local ao candidato, sem publicação e sem alteração visual.

## Risco encontrado

`corrigirEmail` lia a assinatura pendente, aguardava DNS/metadados e depois atualizava por ID sem nova conferência. A assinatura poderia ser confirmada nesse intervalo ou outra correção poderia ser sobrescrita. Gravação e auditoria usavam transações independentes. A sugestão também podia ser calculada para um endereço substituído durante a consulta.

## Contrato implementado

As validações continuam fora da transação, sem prender a assinatura durante consultas externas. Antes da gravação, a função confere a conta atual e seu nível, bloqueia a linha e compara a versão PostgreSQL observada no início da operação. Assinatura confirmada não é corrigida; qualquer mudança de linha durante a validação produz conflito. Aplicar sugestão conserva a versão anterior ao cálculo, evitando transferir uma sugestão antiga para o endereço novo.

As rotas individual e de sugestões em lote passam ID e e-mail da conta autenticada. A função ainda admite autoria textual para chamadores internos existentes; isso não é uma alternativa selecionável pelo navegador. A conta perde autorização se desativada, rebaixada ou se o e-mail mudar durante a consulta. Escrita e auditoria são atômicas. Uma disputa pela chave única do e-mail devolve a recusa de duplicidade já existente, sem gravação parcial. Demais falhas não são convertidas em sucesso.

Só são atualizados e-mail, hash do e-mail e metadados institucionais derivados. CPF/hash, nome, categoria, ID/inscrição, datas, consentimento, código e token permanecem intactos. Não dispara envio, consulta CPF ou correção automática de nome. Sem DDL novo.

## Interface e limites

A rota individual responde 409 para conflito e 403 para permissão revogada; o lote mantém resultado por registro. Nenhum novo texto foi exibido: o conflito usa a mensagem já existente “Não foi possível salvar.” O aviso mais específico foi submetido separadamente como AV-13 e só será aplicado após aprovação.

A versão compara o começo da operação no servidor com sua gravação; ainda não é uma revisão durável enviada pelo navegador desde o carregamento da tabela. Faltam essa integração de edição, histórico recuperável por entidade e exclusão/arquivamento com intenção vinculada, além das demais etapas do plano. Esta correção não conclui a Etapa 4 nem substitui os fluxos específicos de CPF, identidade, categoria ou documentos publicados.

## Verificação

Passaram nove testes direcionados: confirmação durante DNS, duas correções concorrentes, reversão após falha de auditoria, revogação da conta, mudança de outro campo, sugestão obsoleta, disputa pela chave única e regressões das rotas anteriores. Dados e DNS são fictícios. A primeira invocação do roteiro foi feita no diretório incorreto e falhou na resolução dos aliases; a repetição em `site/` passou, sem mudança de lógica para acomodar o erro.

A primeira cumulativa terminou em 456/457: o teste de disputa consultava estatísticas de atividade dentro de uma transação que conservava o retrato anterior. O roteiro agora chama `pg_stat_clear_snapshot()` antes de observar os bloqueios, sem relaxar a aplicação ou o cenário concorrente. A repetição direcionada passou 9/9 (`stage04-email-targeted-snapshot-fixed.log`). A cumulativa final passou **457/457** em `stage04-email-cumulative-final.log`; o resultado anterior foi preservado em `stage04-email-cumulative.log`. Migração com 12 tabelas aditivas, build e tipos passaram em sequência. O HTTP compilado passou com contas reais de QA: autenticação/permissão/origem, conflito 409 obtido por bloqueio real da linha, recusa de confirmado, rollback por falha de auditoria, autoria e preservação de campos da assinatura. O cenário HTTP positivo usa categoria estrangeiro fictícia para não consultar DNS externo; servidor/apoiador continuam cobertos pelos testes de biblioteca e de handlers com DNS simulado. Nenhum envio ou consulta CPF ocorreu. Evidências adicionais: `stage04-email-{schema,build,typecheck-serial,runtime}.log` e `runtime-email-atomic/email-atomic.json`. A prévia 3031 foi restaurada com o banco/configuração fictícios anteriores e `/admin` respondeu 200. Os arquivos públicos `SignForm.tsx`, `i18n/pt.ts` e `email-feedback.ts` continuam idênticos ao checkpoint 77f33f7. Todos os arquivos de evidência estão na cache de auditoria do repositório principal.
