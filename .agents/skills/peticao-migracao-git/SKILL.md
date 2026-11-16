---
name: peticao-migracao-git
description: Executar preservação, versionamento, publicação pública revisada e replicação privada integral da Petição, com informes aos coordenadores. Use na sessão Peticao Migracao git e nas tarefas dessa migração.
---

# Migração Git da Petição

Aplicar também `_ops/delegacoes/AUTONOMIA-20261116.md`: decidir dúvidas no escopo, registrar pergunta/decisão/evidência/resultado, continuar partes independentes até concluir; não encerrar com trabalho executável pendente nem criar polling. Sincronizar baseline Civo/instalações com Infra e integração de bancos com `peticao | databases`, evitando freezes concorrentes e segredos na publicação.

Sessão responsável: `01a1e2f4-ee1d-75d1-938a-013b7943e2a4`.
Plano e goal aprovados: `/mnt/apps/peticao-final/_ops/delegacoes/migracao-git-20261116/PLANO-E-GOAL.md`.
Estado recuperável: `CHECKPOINT-MIGRACAO.json` no mesmo diretório. Ler o checkpoint antes de repetir trabalho; consultar histórico adicional sob demanda.

## Informes obrigatórios

Reportar aos cinco destinatários:

| Papel | Thread ID |
|---|---|
| Root, coordenação geral | `01a1cad7-4a65-7d43-b8c2-f0b50a90a580` |
| Coordenador de Infraestrutura | `01a1d130-2948-7140-bcfb-34696b20ab8d` |
| Infra Oracle | `01a1e215-ac87-7aa3-a3ee-463a49861f40` |
| Infra Civo | `01a1e215-98ab-7a71-ae0a-07db5f3b61bc` |
| Infra Akamai | `01a1e215-9dfe-7431-8c5b-568c24fc0486` |

Enviar no início, marcos verificados, bloqueios, alterações materiais de plano e conclusão. Antes de transferências/promoções, combinar capacidade, caminhos, leases e janela com Infra e responsável do host; não duplicar expansões ou operações já atribuídas.

Mensagem curta: etapa/estado, resultado observado, caminho das evidências, próxima ação, ETA ou bloqueio. Informes globais aos cinco; detalhes locais adicionais ao responsável e ao coordenador de Infra. Não copiar logs extensos ou valores secretos.

Preferir `send_message_to_thread`; usar `codex queue` como fallback. Registrar destinatário, marco e resultado do envio no checkpoint ou arquivo de notificações referenciado. Aceitação de envio não prova leitura. Não enviar recibos em cascata, fazer polling ou criar watchers. Ausência de recibo não bloqueia trabalho independente; conflito real de lease/capacidade deve ser resolvido antes de modificar o recurso.

Esses informes são obrigação integrante do goal. Não criam revisores obrigatórios nem nova autorização; Executor61 continua opcional. Preservar o goal ativo e seu progresso: usar mecanismo suportado para atualizar o texto, quando disponível; se indisponível, manter adendo persistente de requisitos vinculado ao goal e explicitar a limitação, sem editar bancos internos nem reiniciar o goal para zerar progresso.

## Fronteiras da entrega

Admin-v2 `01a1d97c-5d7f-7a92-8cc5-798070a3d6e0` depende da publicação. Produzir `_ops/delegacoes/migracao-git-20261116/GITHUB-READY.json` conforme contrato no `GOAL-GITHUB-20261116.md` da delegação Admin: URL/ref/commit, manifesto de escopo/refs, sanitização e clone independente. Enviar aviso direto ao Admin, Root, Infra e Databases; responder dúvidas de base/refs e mudanças posteriores. Não declarar ready antes das provas nem esperar terminar as réplicas privadas se o Git já está validado.

- Publicação autorizada: repositório PUBLICO `aduniro/peticao`, com conteúdo e todas as refs revisados antes do primeiro push; preservar histórico original privado e mapear sanitizações.
- Réplicas autorizadas: pasta INTEIRA privada em Oracle/Civo/Akamai, após publicação, sem aplicar as exclusões públicas às cópias privadas. Verificar hashes, links, refs e consistência de bancos locais; arquivos transitórios recebem registro individual.
- Produção, banco de assinaturas e fluxo PDF/assinatura permanecem em São Paulo; não ativar serviços ou deploy por causa desta migração.
- Consultar catálogo protegido para credenciais, sem imprimir valores ou publicá-los. A privada Remmina permanece no Dell. Sessões/cookies externos à pasta não entram automaticamente no escopo.
- Requirements e lockfiles por componente; preservar WIPs e autores, não integrar entregas incompletas nem atualizar dependências indiscriminadamente.

Guardar evidências detalhadas em arquivos e carregar apenas os trechos necessários. A conclusão exige publicação validada, três réplicas verificadas e informe final aos cinco coordenadores, além do relatório ao dono pelo canal autorizado.
