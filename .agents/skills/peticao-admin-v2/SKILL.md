---
name: peticao-admin-v2
description: Continuar a implementação e os testes do painel admin-v2 da Petição, preservando contratos, releases publicados e coordenação entre agentes. Use nas tarefas desse painel; infraestrutura, novas integrações cloud e materiais permanecem com seus responsáveis.
---

# Desenvolvimento do admin-v2

## Ordem atual — GitHub e execução autônoma

Aplicar primeiro `/mnt/apps/peticao-final/_ops/admin-v2-desenvolvimento-20261114/GOAL-GITHUB-20261116.md` e `_ops/delegacoes/AUTONOMIA-20261116.md`. O dono autorizou agora continuar o último plano aprovado em partes completas, com testes/validações e pequenos deploys, iniciando implementação pelo GitHub APÓS recibo verificável da Migração. Esta ordem substitui restrições antigas de mera inicialização; não reativa propostas fora do plano.

Antes do recibo GITHUB-READY, avançar preparação/backlog/testes por leitura, sem disputar worktrees congeladas. Depois, clone/fetch e branch próprios do commit publicado confirmado; nenhuma reintrodução de história privada sanitizada. Comunicação BIDIRECIONAL com Root, Infra geral, Migração Git e Databases, cujos IDs/contrato estão no adendo. Decidir dúvidas no escopo, registrar pergunta/decisão/prova/resultado e continuar até concluir frentes executáveis. Preserve testes/leases/producao; Executor61 não é revisor obrigatório. Vincular adendo ao goal ativo sem zerar progresso.

Leia primeiro `/mnt/apps/peticao-final/_ops/admin-v2-desenvolvimento-20261114/AGENTS.md` e `HANDOFF.md`. O mapa `CONTEXTO.json` nesse diretório aponta fontes e histórico original. Consulte apenas a frente afetada; o mapa não substitui os documentos nem transforma propostas em decisões.

Sua função é desenvolvimento do painel, subordinado à coordenação Root. Escopo do produto e decisões do dono estão nos planos e no histórico; confirme a tarefa concreta e a autorização vigente antes de trabalhar. Preparar este agente não aprova automaticamente o plano amplo que ainda estiver pendente. Preserve autorizações específicas já concedidas e não peça consentimento repetido para o mesmo escopo. Informe conflitos ao Root.

## Implementar a partir do estado real

- Reconcilie checkout, release efetiva, alterações locais e evidências antes da primeira edição. Os pins do handoff são o último estado documentado, não garantia de produção atual. Não use checkout antigo só por seu nome ou matriz antiga como prova de integração.
- Use worktree/draft próprio e reservas reais conforme `_ops/coordenacao-dupla/PROTOCOLO.md`. Não reutilize token do Root, não tome reserva incerta nem crie ator votante. Combine as fontes e o prazo com Root; Infra fornece capacidade/janelas; Apoio mantém a página pública e pode revisar.
- Preserve a página pública, `/admin` legado e o admin-v2 em `admin.sancionaintegral.org`, bem como as regras de identidade/assinatura e evidências já aprovadas. Não altere comparação Nome–CPF ou resolva divergências por regra nova sem a decisão correspondente do dono. Não reative WIPs suspensos, materiais ou IA multiprovedor por herança de contexto.
- Reutilize endpoints, permissões, contratos e primitivos transacionais. Migrações necessárias serão aditivas/compatíveis e coordenadas. Resultado incerto de operação externa exige consulta/recuperação, não repetição automática. Preserve chaves, dados novos e documentos assinados; rollback de app não restaura banco antigo sobre novas assinaturas.

## Validar e entregar

Selecione testes proporcionais à mudança. Formulários e ações precisam cobrir sucesso, erro e efeitos reais no backend, com dados e e-mail fictícios. Teste concorrência/idempotência/permissões quando afetadas. UI deve funcionar no celular/desktop, com teclado, tabelas, overlays e estados legíveis; reutilize a auditoria existente sem repetir tudo se o estado não mudou. PDF com layout exige a skill PDF e inspeção das páginas geradas. Testes sintéticos não comprovam certificado operacional, entrega de e-mail ou homologação externa.

Root integra a entrega e coordena publicação/revisão. Um deploy já autorizado pode seguir após os testes e gates técnicos aplicáveis; não acrescente um veto de bot de teste como se fosse consentimento do proprietário. Não fabrique ACK técnico e não reutilize dispensa de outro deploy. Publique apenas por rota combinada com Root, artefato exato, manifesto, reserva e rollback qualificados.

## Contexto e custo

Antes de tarefa nova informe ETA. Mantenha atualização curta de atividade, decisão, bloqueio e próxima ação; grave logs/evidências completos em arquivos privados. Consulte IDs, campos e trechos relevantes por scripts, carregando o documento inteiro somente quando necessário. Registre checkpoint após entregas com commit, arquivos, testes, pendências e referências às decisões; não copie o histórico inteiro para cada checkpoint.

Temporários ficam na raiz do projeto ou no draft próprio. Não repurpose HOME/CODEX_HOME, não exponha credenciais nem envie mensagem externa sem autorização. Relatórios detalhados pelo Vigia são HTML legível; decisões necessárias aparecem no Root e Vigia, e decisão autenticada do dono em qualquer canal vale uma vez. Solicite a Root o envio pelos canais autorizados. Sem trabalho atribuído, encerre o turno e aguarde; não faça polling LLM.
