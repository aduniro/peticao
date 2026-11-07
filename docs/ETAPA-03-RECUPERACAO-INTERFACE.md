# Etapa 3 — lista de recuperação e controle visual preparado

07/11/2026. Este checkpoint não conclui a interface: prepara a lista e o componente, sem alterar o que aparece na página. AV-10 está aprovado; complementos AV-11/AV-12 aguardam aprovação explícita.

## Backend conectado

`GET /api/admin/emails/recuperacao` agora lista candidatos elegíveis; aceita `before` inteiro positivo e `limit` de 1 a 20, padrão 10. A consulta individual por `id` continua separada e não aceita combinações ambíguas. Total + confirmação extra são exigidos antes da leitura.

Paginação usa ID decrescente e cursor do último candidato examinado, inclusive quando o conteúdo desse candidato diverge e precisa ser omitido. Não perde páginas ao filtrar conteúdo inválido. Cada consulta tem scan limitado e snapshot somente leitura. A resposta contém somente ID de fila, tipo, destinatário e data do aceite; não expõe payload, fingerprint, segredo, assunto ou corpo. A conclusão continua revalidando tudo dentro da transação.

## Componente preparado, ainda não conectado

`site/src/components/admin/RecuperarFila.tsx` reutiliza tabela, botões, avisos e modal nativo das classes do admin-v2. Contém confirmação AV-10, preservação da lista em falha, exclusão local apenas de linha já concluída e atualização dos contadores por refresh. Um ref trava cliques simultâneos; não há POST automático de repetição. Resposta perdida provoca consulta do estado; resultado incerto conserva a linha. Requisições têm timeout, e fechar/Cancelar fica indisponível enquanto há operação pendente. A paginação é cumulativa, sem duplicação de IDs.

Os textos complementares foram apresentados por perguntas nativas e e-mail ao dono. O arquivo não está importado na página: nenhum texto novo apareceu ao usuário. Não considerar o componente validado no navegador apenas porque seus tipos passaram.

## Evidência atual

**391/391 cumulativos**, dois testes novos de lista/paginação e gate HTTP, build, tipos após build e roteiro HTTP compilado aprovados. A rodada específica anterior passou 7/7. O roteiro compilado confere o whitelist de metadados da lista, além da recuperação sem transporte. Evidências privadas: `stage03-recovery-ui-*` e `runtime-recovery-list/mail-recovery.json` em `/mnt/dev/peticao/.cache/admin-audit-20261106/`.

Sessão de QA revogada, temporário 3032 encerrado e prévia 3031 retomada com banco/configuração anteriores (/admin 200). Banco de QA novo preservado separadamente. Nenhum schema, interface ativa, VPS ou revisão de CPFs alterado.

## Próximos gates

Após aprovação: conectar à seção existente de fila; exigir conta Total real; sem stepup, usar o caminho de confirmação já existente; validar matriz de níveis e seis larguras. Testar Cancelar/Escape/foco, bloqueio de duplo clique, paginação com falha, resposta perdida antes/depois do commit, recuperação real apenas fictícia e ausência de outras requisições/erros. Não reenviar e-mails nos testes. O visual deve reutilizar o verde escuro/vidro existente.

Continuam no plano completo: consultas/histórico, retenção, conversas/editor e demais Etapas 2–7. Avisos anteriores e deploy não foram aprovados por este checkpoint.

## Pendências de compatibilidade observadas

A leitura autenticada da Ponte encontrou duas mensagens anteriores: 06/11 20:57 UTC autorizando etapas 0/1 e 22:27 UTC pedindo que o aviso/borda de CPF inválido apareçam ao sair e desapareçam ao focar novamente. A última não é aprovação dos textos do admin. No candidato, o CPF marca touched no blur, mas não há handler onFocus para limpar esse estado. Registrar para a regressão pública/comparação atual da VPS; não corrigir silenciosamente dentro deste bloco de recuperação administrativa.

O resumo legado de fila descreve todos os `failed` como desistência após 48 h, embora o guard de rollback também possa reter itens nesse status. O texto exige revisão aprovada em etapa própria; não esconder os retidos alterando a contagem só para manter a frase antiga.
