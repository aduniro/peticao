# Etapa 4 — campos, permissões e recuperação

Inventário do candidato local em 07/11/2026, após 60331c7. Descreve contratos existentes e pendências; não autoriza ampliar campos nem alterar a produção. As proteções por rota não substituem revalidação transacional no momento da escrita.

| Entidade | Escrita existente | Nível da rota | Preservação e pendências |
|---|---|---|---|
| Assinatura pendente | E-mail, hash do e-mail e selo institucional derivado; sugestão calculada no servidor | Edição | 60331c7: versão durante validação, conta atual, escrita/auditoria atômicas; não muda identidade, datas, inscrição ou nome. Complemento08/11: versão da linha desde o carregamento para edição e sugestões em lote;14 direcionados e tipos aprovados, cumulativa/build/HTTP em validação. Falta histórico recuperável específico. |
| Identidade/nome/categoria da assinatura | Nenhuma edição genérica autorizada por este módulo | Fluxos próprios | Não criar editor de coluna arbitrária. Compatibilizar qualquer fluxo futuro com revisão local e nome oficial; preservar decisões já tomadas. |
| Domínio institucional | Aprovar/rejeitar, tipo, instituição, evidência; aprovação por fonte | Edição | `decideDomain` já usa transação/auditoria. A decisão pode atualizar o selo de assinaturas existentes; não confundir essa propagação com edição do nome/CPF. Falta edição/arquivamento versionado por intenção no cliente. |
| Usuário administrativo | Criar, nível, ativar/desativar e pedir redefinição | Total + confirmação extra | Autoria atual nas escritas e reserva de redefinição validada no bloco08/11:24 direcionados,484 cumulativos, build, tipos e HTTP compilado (`ETAPA-04-USUARIOS-ATOMICOS.md`). Proteções do último Total e sessões preservadas. Desativação conserva a conta; não acrescentar DELETE físico. Invites/redefinições podem enviar e-mail: QA somente com conta fictícia/provedor dev. |
| Preferências do painel | Booleanos de lista fixa | Total; leitura para consultar | Gravação e auditoria atômicas; não expõe configuração livre nem credenciais. Ainda não é um editor genérico de `settings`. |
| Configuração de IA | Habilitação, perfis/modelos/esforço e limites de lista fixa | Total + confirmação extra para gravar | Revisão concorrente e autoria atual; não aceita chave ou endpoint do navegador. Configuração não arma sozinha o serviço. |
| Contato e curadoria de campus | Resposta pelo fluxo durável; decisões encadeadas de curadoria | Total + confirmação extra nas escritas sensíveis | Não reescrever contato recebido como se fosse o original. Curadoria não altera automaticamente assinaturas ou catálogo público. Faltam editor/conversas e apresentação das propostas aprovadas. |
| Mensagem/filas de e-mail | Tentativas e eventos append-only; concluir fila com aceite exato | Total + confirmação extra para recuperação | Não editar a mensagem já enviada nem tratar aceite como entrega. Intenção/content fingerprint/recibo vinculados; não repetir envio em conciliação. Arquivo de conteúdo depende de retenção ainda não escolhida. |
| Código de indicação | Criar rótulo/código | Edição | Atualização07/11: criação e autoria/auditoria atômicas no candidato seguinte, com conta revalidada e colisão controlada (`ETAPA-04-INDICACOES-ATOMICAS.md`). Repetição HTTP, edição e arquivamento ainda pendentes; não há exclusão recuperável pronta. |
| Remetente WhatsApp existente | Adicionar rótulo/telefone cifrado, alternar ativo, arquivar | Total + confirmação extra | Bloco08/11: operações/auditoria transacionais, autoria atual, versão e arquivamento preservando o registro. Sete regressões, tipos e migração aprovados; cumulativa/HTTP/navegador em validação. Biblioteca de restauração preparada, interface/rota nova dependem de AV-15 (`ETAPA-04-REMETENTES-RECUPERAVEIS.md`). Não retomar WAHA ou novo canal. |
| Lote/documento assinado | Criar, aprovar, anexar assinado, cancelar por fluxos específicos | Total | Não expor edição genérica de bytes/hash/assinantes. Preservar documentos publicados e seus vínculos. Fluxos de assinatura/versão da Etapa 6 continuam pendentes. |

## Ordem de integração

1. Fechar as escritas existentes que ainda podem ficar sem auditoria/autoria, sem alterar textos/visual por inferência.
2. Definir, por entidade, visão revisável e campos efetivamente editáveis; entregar versão do estado lido ao cliente e exigir a mesma intenção na escrita.
3. Implementar arquivamento/restauração com evento antes/depois protegido, confirmação extra e escopo mínimo. Nenhum DELETE de assinatura ou documento; nenhum reaproveitamento de CPF ou renumeração silenciosa.
4. Integrar ações por linha ao padrão admin-v2, preservando o rascunho em conflito/falha de rede. Novos avisos precisam de aprovação explícita.
5. Validar listas, filtros, contagens e PDFs contra o estado arquivado, inclusive concorrência, restauração e registros publicados. Não marcar Etapa 4 concluída apenas porque a correção de e-mail passou.

## Evidência

Inspeção direta dos handlers `assinaturas/[id]/email`, `assinaturas/lote`, `dominios`, `usuarios`, `configuracoes`, `indicacoes`, `whatsapp/remetentes`, além dos contratos e testes já registrados nos documentos das Etapas 2, 3 e 5. O inventário de edição/exclusão não prova que todos esses contratos já foram implementados, publicados ou testados no estado da VPS.

## Atualização08/11 — consolidação local posterior à matriz

As pendências históricas das linhas acima têm os seguintes complementos:

- Domínios: ator revalidado na transação e autoria comprovada no HTTP compilado
  (`9b4a693`); classificação/CPF preservados. Não conclui versionamento e
  arquivamento por intenção da curadoria.
- Indicações: ledger d8b8bac conectado à rota/formulário em `a99875b`; HTTP e
  navegador390/1440 comprovam repetição sem duplicar código/evento e recuperação
  de rascunho/intenção após resposta perdida. Edição/arquivamento seguem pendentes.
- Retenção: dono escolheu30dias; expurgo operacional e bloqueio de conteúdo vencido
  passaram no cron compilado sem despacho. Não equivale a minutas persistentes
  concluídas, limpeza de backups ou declaração de entrega pelo provedor.
- Catálogo existente de remetentes: AV15 aprovado; arquivar/filtrar/restaurar
  passou no navegador390/1440 com versão, identidade, cifra e datas preservadas.
  Nenhum WAHA ou envio ativado.

Evidências de HTTP/navegador consolidadas em `1a8a6c5` e no documento
`ETAPA-CONSOLIDACAO-CHECKPOINT-20261108.md`. A cumulativa corrigida fechou507/507,
zero falhas/ignorados/cancelados, com log completo e saída0. Isso não encerra a
Etapa4 inteira nem o admin-v2 integral.

## Contato — backend independente de AV16

`GET /api/admin/contato/historico` agora reúne o original recebido, páginas
independentes de metadados de respostas/decisões de campus e a última triagem.
Conta real de Edição revalidada, snapshot somente leitura e paginação limitada;
sem payloads, selos ou inferência de identidade/entrega/publicação.32 testes
direcionados, tipos, build e HTTP compilado passaram. Nenhuma mudança de esquema
ou interface. Contrato e evidências em `ETAPA-02-HISTORICO-CONTATO.md`.
Persistência/editor compartilhado e seus textos seguem dependentes de AV16;
não considerar o módulo Contato ou o painel inteiro concluídos.
