# Etapa 5 — execução com quota e idempotência

07/11/2026. Candidato local. Chamadas reais continuam desativadas no ambiente atual; testes usam transporte simulado, sem credencial real ou cobrança.

## Ativação e intenção

São necessárias configuração habilitada, modelos explícitos, `AI_EXECUTION_ENABLED=1` no serviço e credencial própria (`OPENAI_API_KEY` ou credencial systemd `openai-api`). Não usa autenticação deste chat, cofre geral ou endpoint escolhido pelo navegador. A disponibilidade indica configuração local para tentar, não comprova acesso/crédito/modelo no provedor. Mudar a preferência no painel não arma o serviço sozinho.

`POST /api/admin/ia/gerar` exige Edição, origem correta e exatamente `{input,proof,requestId}`; `requestId` é UUID v4 criado pelo cliente para aquela tentativa. A prova precisa corresponder ao contexto atual. A rota mantém o porteiro compartilhado e um limite próprio por conta para geração; consultas administrativas não são contadas como gerações. A quota durável, não esse limitador em memória, controla o total entre processos.

## Reserva antes da chamada

`admin_ai_requests` é a 12ª tabela aditiva. Guarda UUIDs, autoria, dia UTC, finalidade/modelo/revisão, hash do contexto, versões de fontes, bytes/teto de saída, estado, horários e uso conhecido. Não guarda pergunta, prompt, resposta ou chave.

A conta ativa/nível/e-mail é revalidada. Reserva e auditoria são atômicas sob a mesma trava da configuração, serializando concorrência entre processos. Os limites de chamadas e tokens de saída/dia são globais para os três usos e todas as contas. Reserva o teto da saída; todas as tentativas continuam contando, inclusive rejeitadas/incertas/descartadas. Trocar configuração ou modelo não reinicia o orçamento do dia. O limite de bytes é de texto do contexto; não há teto monetário prometido.

UUID já registrado pela mesma conta nunca dispara outra chamada. Se o contexto mudar, o mesmo UUID não se transforma em nova intenção. Não há retomada automática, fallback de modelo/provedor ou repetição após timeout/queda. Desabilitar a configuração impede novas reservas; não desfaz uma chamada já iniciada.

## Resultado e incerteza

Há uma única tentativa HTTPS ao endpoint fixo, sem redirecionar, com timeout e leitura limitada de corpo. Não registra erros livres do provedor/transporte. `completed` indica minuta validada, não envio: estrutura/citações/uso precisam ser coerentes e o contexto é conferido novamente. A permissão da conta é revalidada atomicamente na conclusão; revogação descarta o texto e conserva o uso observado.

Falha de transporte/5xx/resultado não legível fica incerta; saída inválida ou contexto alterado é descartado. Falha de auditoria antes da reserva impede chamar; depois de possível aceite não libera repetição. Uma reserva sobrevivente a queda permanece reservada/incerta, nunca é rotulada como não cobrada pelo tempo decorrido. Uso desconhecido permanece nulo; não é zero. O teto inclui raciocínio não visível conforme o contrato OpenAI já documentado.

Texto validado só volta na resposta corrente, com revisão humana obrigatória, `persisted:false` e `sent:false`. Se essa resposta se perder, o status permite conferir a tentativa, mas não recuperar texto que não foi arquivado. Persistência de minutas/retencão continua pendente; não escolher política silenciosamente.

## Consulta operacional

`GET /api/admin/ia/gerar?requestId=...` consulta somente a própria conta, inclusive para Total, sem texto/prova. `GET /api/admin/ia/uso?day=AAAA-MM-DD` exige Total e mostra reservas, uso observado, chamadas sem uso conhecido e metadados de até 100 pedidos do dia UTC (máximo normal configurável de chamadas). Truncamento é explícito. Não mostra pergunta, saída, hash de contexto ou credenciais. Contadores não equivalem à fatura do provedor.

## Verificação e continuidade

A primeira rodada encontrou alias SQL inválido para o dia UTC; corrigido com alias explícito. Passaram 30 direcionados; mais 12 do executor passaram após acrescentar revogação em andamento. Cobrem concorrência/quota global, UUID repetido, incerteza, contexto/conta alterados, falha de auditoria, corpos inválidos/excessivos e isolamento. Passaram também os 450 testes cumulativos, migração no esquema legado com 12 tabelas aditivas, build e tipos em sequência. Evidências privadas: `stage05-executor-cumulative.log`, `stage05-executor-schema.log`, `stage05-executor-build.log` e `stage05-executor-typecheck-serial.log`, em `.cache/admin-audit-20261106/` do repositório principal.

O HTTP compilado passou: verificou portas desativadas, permissões e metadados persistidos no banco fictício. A geração positiva foi simulada pela biblioteca com dependências internas que o navegador não pode fornecer; a rota HTTP de geração permaneceu desarmada. Evidências: `stage05-executor-runtime.log` e `runtime-ai-executor/ai-executor.json`. A prévia 3031 foi restaurada com o banco e a configuração fictícia anteriores e `/admin` respondeu 200. Não equivale a chamada real ao provedor. Interfaces, outros provedores, minutas/editor/retencão, informes e demais etapas seguem pendentes. AV-10 aprovado; demais textos sem aprovação inferida. Não publicar sem autorização final.

## Complemento08/11 — revisão conferida dentro da conclusão

Fechada a janela entre conferência de contexto e gravação de resultado: a
finalização toma a mesma trava da configuração e exige revisão/habilitação
atuais. Mudança tardia descarta texto e conserva uso/quota/UUID, sem nova chamada.
Fixture de corrida identifica a query exata bloqueada pelo PID controlador e
limpa snapshot estatístico; mantém timeout e asserção, sem esconder a falha
inicial36/37. Repetição37/37, build, tipos e contrato HTTP desarmado passaram.
Detalhes, hashes, commits anteriores separados e matriz de pendências em
`ETAPA-05-FINALIZACAO-CONFIGURACAO-20261108.md`. Sem alteração de interface ou
protocolo externo, cofre, credencial real, envio, cobrança ou VPS.
