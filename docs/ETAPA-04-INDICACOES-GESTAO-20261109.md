# Gestão recuperável de indicações administrativas

Primeiro marco backend de entidades, baseado em `e1abf8e`, em worktree isolada
`candidate-referral-management-20261109`. Não altera interface, mensagens,
formulários públicos, assinatura, domínio ou VPS. Não publica ou envia e-mail.

## Contrato

O módulo `admin-referral-management.ts` e a rota nova
`/api/admin/indicacoes/gestao` oferecem edição de rótulo, arquivamento e restauração
para códigos organizacionais: assinatura vinculada ausente, nome pessoal ausente
e rótulo presente. Códigos pessoais não são editáveis por este módulo, inclusive
quando o vínculo à assinatura foi removido. Código/token/data original e vínculos
não podem ser editados. Não há DELETE.

Arquivamento organiza exclusivamente o catálogo administrativo novo. Links
públicos, cartazes, contagens, atribuições e listas estatísticas existentes
continuam válidos e incluem os mesmos registros. A lista de gestão separa ativos,
arquivados e todos, com paginação por ID e limite máximo100. Não confundir esse
arquivo administrativo com revogação do link ou remoção dos dados da plataforma.

Cada mutação exige UUIDv4, versão lida e operação explícita. O ledger vincula ator,
ID, versão, operação e rótulo normalizado. Repetição da mesma intenção devolve o
JSON originalmente armazenado, mesmo depois de outra edição. Reuso divergente
retorna409; versão antiga não sobrescreve a nova. Edição sem mudança registra a
intenção/auditoria sem avançar a versão. Edição de item arquivado exige restauração
antes; arquivo/restauro de estado incompatível produz conflito.

Edição requer conta Edição ou superior; arquivo e restauração requerem Exclusão
ou Total e confirmação extra válida. Conta ativa, identidade, nível, sessão e
confirmação são revalidados na transação. Travas seguem a ordem da gestão de
contas; a linha é bloqueada antes do CAS. Auditoria antes/depois, versão, mutação
e ledger são atômicos. Não são registrados token, hash de token ou nome de pessoa.
A rota preserva as guardas de origem e taxa, limita corpo a4096bytes e rejeita
campos arbitrários. A API não foi conectada à interface nesta etapa.

## Esquema e compatibilidade

Mudanças aditivas: `referrers.admin_version` BIGINT com padrão1,
`referrers.archived_at` nullable e a16ªtabela aditiva,
`admin_referral_mutations`, com resultado JSONB e intenção única por ator.
O checker estrito compara as definições antigas e os registros preservados,
incluindo código/token/rótulo/data, microsegundos de arquivamento e resultado do
ledger após reaplicar DDL e inicialização da versão anterior. As provas anteriores
das15tabelas continuam incluídas; não houve alteração de definições antigas.

## Validação

17/17 testes dirigidos e regressões existentes passaram: sete casos novos cobrem
ciclo de edição/arquivo/restauro; preservação de assinatura, token, estatísticas,
link e fila; replay exato e concorrência; autorização atual/sessão/stepup; rollback
quando a auditoria falha; rejeição de código pessoal/entradas; HTTP e paginação.
O ensaio de atualização do esquema e os tipos da árvore isolada passaram com
código0. Ambiente limpo, dependências preview-v1 preservadas, PostgreSQL novo
54356 e provedor dev. Não houve build, navegador ou provedor real.

A repetição final terminou17/17, ensaio16tabelas e tipos0 em
`/tmp/admin-referral-management-vadnc4_b/`. O checker foi repetido isoladamente
após corrigir sua descrição textual de15para16: saída0 em
`/tmp/admin-referral-management-2l8d3re1/`. Fontes relevantes ficaram estáveis
em cada execução. Cópias/checksums privados em
`.cache/qa-referral-management-20261109/`. PostgreSQL próprio encerrado;54356livre.

O relatório não encerra entidades: domínios e integração visual continuam
próximos marcos, sem inferir autorização de novos textos.
