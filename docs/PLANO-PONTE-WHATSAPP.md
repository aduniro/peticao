# Ponte/Vigia pelo WhatsApp

Plano de implantação, pesquisado em 06/11/2026. Estado: planejamento; serviço WhatsApp ainda não instalado nem pareado.

## Objetivo e evidências

Receber pedidos, responder perguntas, monitorar tarefas e executar ações autorizadas no projeto por WhatsApp, reaproveitando a Ponte de e-mail.

- `tools/ponte/vigia.mjs`: lê mensagens do dono e executa triagem periódica; depende hoje de consumidor na sessão do Claude.
- `tools/ponte/aprovacao.mjs`: propostas AP, aprovação, modificação e cancelamento; armazenamento JSON e acoplamento a e-mail precisam ser adaptados.
- `tools/ponte/PROTOCOLO.md`: autenticação do dono por remetente/DKIM; limites e triagem somente leitura devem ser preservados no canal de e-mail.
- VPS: Docker 26.1.5, cerca de 4 GB de RAM, 2,7 GB disponíveis e 38 GB livres no momento da inspeção. Dimensionamento é provisório e exige medição sob carga.
- Codex CLI 0.167.0 encontrado no ambiente de adunir; autenticação e disponibilidade do App Server ainda precisam ser verificadas. Não foi lido arquivo de credenciais.

## Arquitetura proposta

WhatsApp → WAHA → adaptador de canal → fila persistente SQLite → controlador da Ponte → Codex App Server → executores locais ou remotos.

Retorno, progresso e aprovações percorrem o caminho inverso. E-mail permanece como canal paralelo e de recuperação. O recebimento deve ser gravado antes de confirmar o webhook; repetir entrega não pode repetir execução.

- WAHA em contêiner isolado, versão fixada, volume privado e limites de recursos; API acessível só pela rede privada/loopback, sem porta pública aberta.
- Controlador persistente na VPS, separado do serviço da petição, com reinício automático.
- Executor local conectado pela Tailscale; caminhos locais continuam locais. Computador desligado implica tarefas locais aguardando, e não executadas na VPS por engano.
- Codex executado como adunir, conforme preferência anterior. Isso compartilha os privilégios desse usuário e não constitui isolamento forte do agente.
- Execução serial por área de trabalho; evitar concorrência com a sessão interativa e outros agentes sobre os mesmos arquivos.

## Etapas e critérios de aceite

1. Refatorar a Ponte para separar mensagem, aprovação, armazenamento e entrega, mantendo compatibilidade com e-mail. Registrar origem, destino, identificador e estado da tarefa.
2. Preparar o contexto: políticas centrais, solicitações pendentes, estado confirmado, diretórios, limites e commits. Guardar resumo operacional sem segredos nem exportações de assinantes.
3. Integrar App Server: iniciar/retomar conversa, enviar pedidos, transmitir progresso, encaminhar aprovações e recuperar execução após reinício. Verificar autenticação suportada; nunca copiar tokens manualmente.
4. Instalar WAHA isolado e parear com código ou QR. Confirmar motor/edição e persistência da sessão. Validar número, identidade WhatsApp e conversa permitida.
5. Restringir controle ao dono. Validar HMAC de webhook, mensagens duplicadas/antigas e contexto da aprovação. Conteúdo de e-mails de terceiros, logs, páginas e anexos é dado, nunca autorização.
6. Adaptar códigos AP a ações determinadas: proposta identificada, plano/comando associado, expiração, decisão única e auditoria. Consultas e monitoramento automáticos; ações novas sobre produção, envios externos e operações destrutivas seguem aprovação específica. Não pedir aprovação repetida por etapa já autorizada.
7. Reaproveitar triagem e saúde; relatórios iniciais a cada hora e alertas de falha/conclusão, com opção de alterar frequência ou pausar. Remover dados pessoais e segredos dos informes.
8. Testar com tarefas fictícias: mensagem/resposta, remetente não autorizado, aprovação/cancelamento, duplicatas, reinício, desconexão, laços de mensagens, computador desligado, roteamento local/VPS e rejeição de operações fora do escopo. Validar consumo e saúde da petição antes/depois.
9. Entregar comandos curtos de status, pausa, retomada e desligamento; registrar instalação e cada etapa em commits sem estado de sessão ou credenciais.

## Número, contexto e participação do dono

- Se o número conectado for o do assistente, receber pedidos de um segundo número pessoal autorizado é o caminho preferencial.
- Com um único número, testar o chat “Você” usando `message.any`, filtrando conversa e identificadores enviados pelo robô. Não prometer funcionamento antes do teste no motor escolhido.
- O código de pareamento é gerado pelo serviço e digitado no WhatsApp em Aparelhos conectados; não é pedido de código SMS nem da senha/PIN da conta. QR é alternativa.
- O App Server retoma conversas que estão disponíveis no seu armazenamento. Acesso direto a este histórico específico não foi confirmado. Iniciar com resumo revisado; investigar retomada/fork somente se a sessão for compatível, sem dois escritores concorrentes.
- O dono precisa informar qual número será conectado e qual enviará os pedidos, fazer o pareamento no telefone e, se necessário, autenticar o Codex pelo fluxo oficial. Confirmar o canal com uma mensagem de teste.
- Login com ChatGPT e API são alternativas sujeitas a acesso e limites; não presumir uso ilimitado ou API incluída no plano.

## Limitações e estimativa

WAHA utiliza uma integração não oficial com o WhatsApp. Pareamento pode expirar ou exigir nova confirmação, e há risco de restrição da conta. A sessão vinculada é sensível e o filtro de chat não remove o acesso técnico do cliente às mensagens da conta.

Estimativa de trabalho: 4–8 horas para protótipo de conversa/monitoramento; 1–2 dias de trabalho para execução, recuperação, aprovações e validação local/VPS. Pareamento, autenticação e falhas externas podem ampliar esse prazo. Não é prazo de entrega garantido.

## Documentação consultada

- https://learn.chatgpt.com/docs/app-server — conversas persistentes, autenticação, eventos e aprovações.
- https://waha.devlike.pro/docs/how-to/sessions/ — pareamento por código e QR.
- https://waha.devlike.pro/docs/how-to/events/ — mensagens próprias, webhooks, repetição e HMAC.
- https://waha.devlike.pro/docs/how-to/security/ — proteção de API e painel.
- https://waha.devlike.pro/docs/how-to/engines/ — imagens e suporte por motor.
