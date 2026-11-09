# Integração local de inbox e respostas em grupo

Validação em 09/11/2026, sem publicação ou execução em produção.

## Fontes consolidadas

- `b29c807`: preparação explícita de respostas por destinatário.
- `1da4a94`: intenção durável de grupo, reservas e recuperação sem reenvio automático.
- `6532596`: entrada autenticada, conteúdo cifrado, correlação limitada e retenção.
- `033ab85`: consultas administrativas de inbox, prévia transformada e download explícito de anexos. Esta última integração possui validação própria; não pertence à rodada integrada abaixo.

Os conflitos no ensaio de schema foram resolvidos pela união das verificações existentes. Foram preservados os casos de catálogo, presidente, histórico binário de documentos, grupos e inbox. Nenhuma verificação anterior foi removida.

## Rodada integrada concluída

Snapshot limpo `65325965acdeb3204efbc5d4173a5f4a63dc6d12`, em `candidate-integrated-inbox-groups-20261109`, com Node 20.19.2 isolado. PostgreSQL temporário na porta 54365, dados fictícios, transporte de desenvolvimento e configurações vazias próprias; sem acesso a provedores reais.

- Schema: aprovado. 22 tabelas aditivas, repetição do DDL e bootstrap anterior preservam os dados de teste. Evidência: `/tmp/admin-mail-history-7nvbb0fd/validation.log`.
- Testes de grupos, respostas individuais, entrada autenticada, criptografia, deduplicação, retenção, rascunhos e arquivo: **67/67**, sem falhas ou casos ignorados. Evidência: `/tmp/admin-mail-history-mm5wd0c1/validation.log`.
- TypeScript completo desse snapshot limpo: saída 0. Evidência: `/tmp/admin-mail-history-970d77ri/validation.log`.

Esses resultados não certificam o admin-v2 completo, a interface de inbox, um provedor real, ou alterações posteriores ao snapshot. A worktree principal conserva os trabalhos incompletos separados; eles não foram apagados para obter uma checagem limpa. A validação HTTP compilada do módulo de leitura é uma etapa posterior própria.

Nenhum deploy, merge com a VPS, envio a usuários ou alteração em dados reais foi feito nesta integração.
