# E-mails e pendentes: consulta global e paginada

Etapa após o aceite da Lista de assinaturas. O módulo completo contém também entregas/histórico, devoluções, reenvios e provedores; esta primeira coorte trata a consulta de todos os cadastros pendentes, seus sinais registrados e exportação, sem declarar o módulo inteiro concluído.

## Problemas observados

- A lista anterior retornava no máximo500 ocorrências de atenção e o cliente filtrava somente esse recorte.
- A abertura da página chamava sugerir(), que consultava MX para cada endereço. Retirar essa atividade de GET/SSR; nenhuma comunicação com DNS ou provedores é necessária para consultar dados registrados.
- Dados de engajamento agregados por endereço não provam que uma mensagem específica de confirmação foi entregue/aberta/clicada. Alguns agregados legados preservam somente o primeiro horário de cada tipo.
- Supressão e fila não podem apagar sinais positivos ou negativos históricos. Clique antigo não pode esconder evento adverso registrado depois.

## Decisões registradas

- Unidade da lista: cadastro aguardando confirmação, uma linha por id, sem deduplicar pessoas apenas pelo e-mail/nome. Totais globais e filtrados separados; facetas globais completas.
- Estado principal: último sinal cronológico registrado, com desempate adverso/clique/abertura/entrega/aceite. Mostrar escopo address_aggregate e vínculo email_only. Registro de aceite não equivale a entrega; ausência de aceite não comprova ausência de envio.
- Supressão, fila, presença de aceite e eventos adversos são flags independentes. Os filtros preservam essa diferença; o antigo Só sem envio passa a Só sem registro de aceite.
- Sugestões: somente heurística local/catálogo aprovado/frequência local, sem MX. Identificar que a sugestão não foi verificada. Não sugerir domínios rejeitados/pendentes por terem aparecido com frequência.
- Edição ou superior, sessão/conta atuais, RR e reautorização final. Cursor opaco de id DESC, sem promessa de um snapshot persistente entre páginas.
- Durante edição ou mutação, bloquear troca de página/filtro/refresh para não trocar silenciosamente a versão CAS. Após tentativa de mutação, marcar consulta obsoleta; exigir GET manual antes de permitir outra ação. Não reenviar POST automaticamente nem atribuir a um endereço novo a evidência do anterior.
- Manter CSS/fontes/layout e widgets RecuperarFila/PreviaEmail. Acrescentar wbr em tokens longos para preservar conteúdo legível, com textContent original e sem inserir caracteres de controle.
- A página SSR confere novamente usuário/sessão/nível/stepup antes de devolver o resultado. Mudança de permissão durante as leituras exige nova navegação, sem serializar os widgets protegidos sob uma autorização antiga.
- Alerta de pendentes no SSR usa total global da consulta inicial e linguagem neutra, sem inferir não entrega. Consumidores legados do helper continuam separados para revisão nas demais funções do módulo.

## Implementação em andamento

Contrato puro e CSV34colunas passaram6 testes locais: cursor/filtros, cronologia/microssegundos, mais de500 linhas, escaping, ausência de versão CAS no arquivo e sugestões explicitamente não verificadas. Rota GET nova em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/admin/emails/pendentes/route.ts`; backend e UI integrados, com checagem global inicial aprovada.

Exportação materializada, contagem/IDs/bytes/SHA antes de200; evidência e horários preservados, sem corpo de mensagem, certificado, senha ou CPF no CSV. Auditoria de preparação não afirma entrega do arquivo.

## Validação restante

- Integrar backend/UI com hashes e tipos globais.
- PostgreSQL fictício: mais de500 pendentes/facetas, permissão, concorrência, expiração durante leitura/export e auditoria, ausência de DNS/fetch e preservação dos registros.
- Cliente/fixture e Next compilado: paginação/filtros globais, seleção/edição/CAS preservados, resposta perdida/tardia,401/403, CSV integral e seis larguras.
- Depois, seguir as demais funcionalidades do módulo: entregas/histórico e suas exportações, mutações/reenvios idempotentes e sincronização/provedores com cobertura explícita. Não confundir este aceite de consulta com conclusão de todos esses fluxos.

Não executar provedores, DNS, reenvios ou sincronizações reais nesta coorte. Sem deploy, merge ou alteração na VPS.

## Primeira validação integrada

- Tipos globais: exit0, fonte/HEAD/runtime estáveis em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794322916152274925/result.json`.
- Consulta/CSV/cliente/auditoria:29/29, zero falhas e zero ignorados, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/pending-read-1794322916170736716/result.json`. Inclui601 pendentes, facetas completas, cronologia em microssegundos, leitura RR concorrente, permissões atuais e rollback de auditoria após expiração.
- Revisão independente encontrou regressão de apresentação: a tabela mostrava o último sinal, mas omitia tipo/motivo do evento adverso histórico disponível no DTO/CSV. Decisão: exibir explicitamente o evento adverso histórico com tipo/provedor/data/razão integral, preservando classes/fontes e sem atribuir esse evento à confirmação atual. Correção integrada por SHA do draft; nova checagem global de tipos aprovada em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794323136999110864/result.json`. Browser dirigido e Next ainda pendentes.
- Nenhum aceite final da funcionalidade neste ponto: falta build estável e Next compilado com PostgreSQL fictício. Progresso global permanece68.9%; não inferir conclusão do módulo pelo resultado destes29 testes.

Proveniência da integração: backend em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/emails-pendentes-readmodel-next-draft/delivery-manifest.json`; UI em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/emails-pendentes-ui-next-draft/entrega.json`; correção adversa em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/emails-pendentes-adverse-ui-next-draft/entrega.json`. Bases e hashes conferidos antes do port. Delta root no store: desempate determinístico adicional por adverse_type/reason.

Ressalva para a próxima coorte: o resumo legado de engajamento ainda usa melhor sinal, enquanto esta consulta usa último sinal cronológico. Não exigir igualdade das distribuições nem apresentar o módulo inteiro como saneado enquanto entregas/histórico e resumo não forem reconciliados.

Fixture dirigida pós-correção adversa aprovada: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/emails-pendentes-adverse-ui-next-draft/browser-fixture/result.json`. UI real com transporte fictício: razão16.384bytes ASCII/emoji íntegra, clique posterior preservado, filtro adverso mostra histórico, seis larguras sem clipping/overflow; somente GET, servidor3876 encerrado. Essa fixture não substitui Next/PG integrado.
