# Continuidade da integração do admin-v2

A integração permanece em andamento, sem deploy autorizado. O plano completo continua em `AUDITORIA-CONTINUIDADE-ADMIN-V2-20261106.md`; este registro não reduz o escopo às correções já concluídas.

Candidato: `/mnt/dev/peticao/.cache/admin-integration/candidate-stage01`, ramo `admin-v2-stage01`. Não publicar o checkout principal inteiro, que contém mudanças públicas de outras tarefas ainda não publicadas.

Checkpoints:

- `77f33f7`: candidato atualizado com os três arquivos efetivamente publicados após a restauração dos formulários, hashes conferidos.
- `0020ce1`: transações de contas, proteção concorrente do último Total, uso único de redefinição e revogação; ranking regional agregado antes do limite por estado.
- `43b56e8`: publicação vinculada ao manifesto simulado, verificação de origem/cópia antes da troca e trava comum entre os caminhos de publicação. Inclui instalador separado, ainda não executado na VPS, e ensaio de atualização do banco.
- `7750df0`: fixtures cumulativas atualizadas para as regras de CPF/identidade já publicadas, sem importar mudanças de aliases de e-mail ainda não publicadas.

Evidências mais recentes em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: suíte cumulativa **235/235**, oito testes Python do publicador/pipeline, ensaio da inicialização real no esquema anterior (seis tabelas aditivas, registros fictícios e definições existentes preservados), tipos e build aprovados. A rodada inicial 225/234 foi diagnosticada e corrigida nos testes que presumiam contratos antigos; as regras públicas atuais foram mantidas.

Detalhes e comandos: `docs/ETAPAS-ADMIN-01.md` e `deploy/LEIAME.md` dentro do candidato. O ensaio usa apenas banco de desenvolvimento em loopback/porta explícita e dados fictícios. O SQLite de revisão não participa desses testes.

Próxima etapa: A6 (autoria das correções, estados finais do Terminal e idempotência de respostas), demais controles sensíveis, QA visual/permissões em seis tamanhos e conferência final com a VPS atual. O aviso de Minha conta ainda aguarda a aprovação de texto já solicitada ao dono. Triagem interna, mensagens/editor, edição recuperável, IAs e documentos das Etapas 2–7 continuam pendentes no escopo completo. O término desta rodada de testes não conclui o objetivo nem autoriza publicação.
