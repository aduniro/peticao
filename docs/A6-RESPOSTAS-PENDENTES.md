# A6 — entrega de respostas de contato

A autoria de correções/reenvios e o resultado real do Terminal foram implementados neste checkpoint. O backend da fila durável está implementado no candidato local. A validação cumulativa desta revisão passou 251/251, assim como os tipos e o ensaio de migração; os textos de estados e de resultado inconclusivo aguardam aprovação. Esta nota preserva o diagnóstico e o contrato, sem declarar a Etapa 1 concluída.

## Problema comprovado

`contact-replies.ts` apaga reservas de texto sem `ok` depois de dois minutos. A reserva não distingue “não enviado” de “o provedor pode ter aceitado, mas a gravação falhou”. O texto pode ser repetido após uma falha entre envio e persistência. Além disso, o card é enfileirado antes da gravação de seu histórico: falha nessa gravação pode deixar uma mensagem sem vínculo idempotente e mascarar o resultado do texto.

A fila global também usa reserva de dois minutos. Ela atende aos envios públicos atuais; não alterar sua política silenciosamente apenas para corrigir o canal administrativo.

## Contrato para implementar

1. Persistir atomicamente os dois conteúdos aprovados, versões/rodada/selo/destinatário/autor e estados de entrega antes de chamar qualquer provedor. O primeiro texto continua sendo tentado imediatamente; o card depende do aceite do texto e tem vencimento de aproximadamente um minuto depois. Sem código pessoal, não existe card.
2. Usar chave única por contato/rodada/versão, estados explícitos e retomada durável. Nenhum timeout transforma um envio incerto em “não enviado”. Nunca apagar a reserva ou o histórico para permitir nova tentativa.
3. Distinguir reserva, envio em andamento, aceite pelo provedor, agendamento e resultado inconclusivo. `ok` não deve significar entrega à caixa de entrada. Falha depois do aceite não pode retornar sucesso inventado nem disparar o mesmo texto outra vez automaticamente.
4. Integrar a retomada ao agendador já existente, sem depender da sessão do assistente e sem levar SSH/root ao processo web. Uma mensagem em resultado incerto requer reconciliação; nova rodada depende de nova prévia e intenção explícita.
5. Tratar separadamente a ambiguidade dentro da cadeia de provedores: não prometer exatamente uma entrega quando um timeout pode ocorrer depois do aceite. Qualquer ajuste no canal administrativo deve preservar os padrões dos envios de assinatura. Não inferir rejeição definitiva a partir de mensagem de erro genérica.
6. Preservar destinatários/Cco/Reply-To, os dois modelos já aprovados e o layout do editor. Isso é o fluxo manual de contato do painel, distinto do Vigia, cujas respostas são exclusivamente ao dono.
7. Textos novos de aviso ao administrador exigem a aprovação prévia pedida pelo dono. O aviso de Minha conta também continua pendente. Não alterar avisos da assinatura pública.

## Testes de aceite

Dados fictícios e envio injetado ou `MAIL_PROVIDER=dev`: dois cliques simultâneos; retomada após reserva; falha depois do aceite; falha de banco ao registrar resultado; falha no agendamento do card; relógio além do prazo antigo de dois minutos; reexecução de worker; mensagem sem código; nova rodada explícita; selo/destinatário alterado; supressão e destinatários proibidos. Provar que o histórico não é apagado e que o mesmo item lógico não é novamente despachado automaticamente quando o resultado é incerto. Separar aceite, entrega e erro, sem tratar o mock como prova de entrega real.

Depois desta correção ainda restam controles sensíveis, QA visual/permissões em seis tamanhos e as Etapas 2–7 do plano completo. Nenhum deploy é autorizado por este checkpoint.


## Implementação do candidato

`contact_replies` passa a guardar os conteúdos exatos aprovados e os estados `prepared`, `blocked`, `sending`, `accepted`, `uncertain` e `rejected`; linhas anteriores recebem `legacy` e não são disparadas. A reserva do texto e do card é uma só transação. O selo inclui destinatário, origem, conteúdo, cópias e Reply-To, mesmo sem card.

O agendador existente retoma apenas itens preparados, com bloqueio de linha para workers concorrentes. O card fica bloqueado até o aceite do texto; só então recebe vencimento de um minuto. Cada item tem uma tentativa automática. Interrupção de worker, timeout, erro genérico do provedor ou falha ao registrar aceite ficam inconclusivos; não apagam a reserva nem autorizam reenvio automático. Um aceite tardio pode concluir a mesma tentativa. A política da fila pública foi preservada; o contato usa uma única tentativa de provedor, sem fallback ambíguo.

A tela considera qualquer histórico ao exigir a opção existente de nova rodada. **Ainda não liberar:** os rótulos antigos da lista não distinguem os estados novos. O aviso de resultado inconclusivo e os novos rótulos foram submetidos ao dono e não serão inseridos sem aprovação. O aviso de Minha conta também continua pendente. Ainda restam controles sensíveis, QA visual/permissões e Etapas 2–7.


## Evidência desta revisão

- Suíte cumulativa: **251/251**, zero falhas, PostgreSQL fictício em loopback na porta 54341.
- TypeScript: `npm run typecheck` aprovado.
- Migração: inicialização real sobre o esquema capturado da produção, repetição do DDL e compatibilidade com bootstrap anterior aprovados. Cenário adicional migra o histórico administrativo antigo preservando todos os campos originais e mantendo as mensagens fora da fila automática.
- Regressões novas: conteúdo/origem/destinatário ligados ao selo; workers simultâneos; reserva e resultado com falha de banco; timeout e aceite tardio; histórico legado; bloqueio/supressão; agendador sem autorização; uma tentativa de provedor no contato e fallback padrão preservado para os demais envios.

Logs locais: `/mnt/dev/peticao/.cache/admin-audit-20261106/stage01-cumulative-contact.log`, `stage01-typecheck-contact.log` e `stage01-schema-contact.log`. Os testes usam dados fictícios, transportes injetados e chamadas HTTP simuladas; não provam entrega em caixas reais. Nenhuma publicação ou alteração da VPS nesta revisão.

Build de produção aprovado em `stage01-build-contact.log`. Código preservado no checkpoint `5a3cbd6`; não é uma versão liberada para publicação enquanto os itens pendentes acima não forem resolvidos.
