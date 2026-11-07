# Matriz de rotas administrativas — auditoria de 06/11/2026

Inventário estático do checkout local; não é prova de publicação ou execução.

| Rota | Métodos | Níveis encontrados | Confirmação extra |
|---|---|---|---|
| /api/admin/acoes | GET, POST | total | Sim |
| /api/admin/alertas | GET | leitura | Não neste handler |
| /api/admin/assinaturas/[id]/email | PATCH | edicao | Não neste handler |
| /api/admin/assinaturas/[id]/reenviar | POST | edicao | Não neste handler |
| /api/admin/assinaturas/explorar | GET | leitura | Não neste handler |
| /api/admin/assinaturas/lote | POST | edicao | Não neste handler |
| /api/admin/assinaturas/visitas | GET | leitura | Não neste handler |
| /api/admin/configuracoes | GET, POST | leitura, total | Não neste handler |
| /api/admin/conta | POST | leitura | Não neste handler |
| /api/admin/contato/responder | POST | total | Sim |
| /api/admin/dashboard | GET | leitura | Não neste handler |
| /api/admin/dispersao | GET | edicao | Não neste handler |
| /api/admin/dominios | POST | edicao | Não neste handler |
| /api/admin/emails/engajamento | POST | edicao | Não neste handler |
| /api/admin/emails/entregas | GET | edicao | Não neste handler |
| /api/admin/emails/sincronizar | POST | edicao | Não neste handler |
| /api/admin/esqueci | POST | Fluxo próprio: login, recuperação ou saída | Não neste handler |
| /api/admin/export | GET | leitura | Não neste handler |
| /api/admin/identidade/zerar | POST | edicao | Não neste handler |
| /api/admin/indicacoes | POST | edicao | Não neste handler |
| /api/admin/login | POST | Fluxo próprio: login, recuperação ou saída | Não neste handler |
| /api/admin/lotes/[id]/aprovar | POST | total | Não neste handler |
| /api/admin/lotes/[id]/assinado | POST | total | Não neste handler |
| /api/admin/lotes/[id]/cancelar | POST | total | Não neste handler |
| /api/admin/lotes/[id]/codigo | POST | total | Não neste handler |
| /api/admin/lotes/[id]/pdf | GET | total | Não neste handler |
| /api/admin/lotes/criar | POST | total | Não neste handler |
| /api/admin/lotes/pausa | POST | total | Não neste handler |
| /api/admin/monitor | GET | leitura | Não neste handler |
| /api/admin/monitor/visitante/[vid] | GET | leitura | Não neste handler |
| /api/admin/painel | GET | leitura | Não neste handler |
| /api/admin/pdf-previa | GET | leitura | Não neste handler |
| /api/admin/rankings | GET | leitura | Não neste handler |
| /api/admin/redefinir | POST | Fluxo próprio: login, recuperação ou saída | Não neste handler |
| /api/admin/sair | POST | Fluxo próprio: login, recuperação ou saída | Não neste handler |
| /api/admin/seguranca/email | POST | edicao | Não neste handler |
| /api/admin/seguranca/fila | POST | edicao | Não neste handler |
| /api/admin/stepup | POST | total | Não neste handler |
| /api/admin/terminal | POST | total | Sim |
| /api/admin/usuarios | POST | total | Sim — candidato integrado |
| /api/admin/whatsapp/remetentes | POST | total | Não neste handler |

Os níveis listados são por chamada ao porteiro, não necessariamente uma coluna por método. Login, recuperação, redefinição e saída têm validações próprias; não são rotas sem proteção por simples ausência de exigirNivel.


No candidato integrado, a gestão de usuários exige confirmação extra tanto na página (redirecionamento para o fluxo existente) quanto no POST. `admin-user-actions.test.ts` atravessa o handler e comprova recusa antes de efeitos para sessão ausente, níveis inferiores, falta/expiração da confirmação e origem externa; a mudança autorizada grava o autor da sessão, ignorando autor forjado no formulário. Esta prova não significa instalação na VPS.

No candidato, a Central inclui histórico paginado em GET e conferência em POST (`modo=conciliar`). Ambos exigem Total e confirmação extra. A conciliação aceita somente prova por pedido/candidato do executor, sem executar outro deploy; os controles visuais aguardam aprovação de AV-7.
