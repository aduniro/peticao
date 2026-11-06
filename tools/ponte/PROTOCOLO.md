# Ponte de e-mail: protocolo

## Canal e informes do Codex — decisão de 06/11/2026

O dono adiou o WAHA. E-mail é o canal de comunicação remota autorizado.
Enviar ao dono informes de início/andamento com tarefa em execução e estimativa
de término, atualizando a previsão se houver bloqueios ou mudança relevante.
Ao concluir, informar resultado, verificações, limitações e perguntar qual é a
próxima tarefa. Respostas devem voltar à Ponte. Não apresentar aceite do provedor
como confirmação de entrega na caixa de entrada. Esta regra não instala um
executor persistente nem torna a sessão do Codex disponível com ela encerrada.

Endereço: `ponte@painel.sancionaintegral.org` (Cloudflare Email Routing → Worker `ponte-entrada` → KV `ponte-caixa`).

## Quem fala com o Claude por e-mail
Os três endereços do dono (lista em `dono.mjs`): operator-78ffa47eeb@example.invalid`, operator-1cb91886e8@example.invalid`, operator-b94fa2583e@example.invalid`.
Um e-mail só vale como pedido do dono se vier de um deles **com DKIM aprovado do mesmo domínio do endereço** (Gmail assina como `gmail.com`, o pm.me como `pm.me`, o Proton como `protonmail.com`). DKIM de domínio "parente", de outro domínio ou ausente é ignorado, assim como bounces e avisos de serviços. Não existe "cadastrar no DKIM": o DKIM é a assinatura que o provedor do remetente coloca; aqui apenas **conferimos** essa assinatura.

## Como funciona um pedido
1. **O dono escreve** para a ponte pedindo qualquer coisa (o mesmo que faria no terminal).
2. **O vigia** (`node tools/ponte/vigia.mjs`, rodando na sessão do Claude) avisa de cada e-mail novo do dono.
3. **Resposta ANTES de agir, como no modo `/plan`:** o Claude responde por e-mail (para o endereço que enviou) com o que vai fazer, os passos, os riscos e o que **não** vai fazer, com um código `AP-XXXXXX` (`aprovacao.mjs`, função `propor`). Pergunta só de leitura/pesquisa pode ser respondida direto.
4. **Decisão do dono**, na 1ª linha da resposta, mantendo o código no assunto: `APROVADO`, `MODIFICAR: <o que mudar>` (gera nova proposta) ou `CANCELAR`.
5. **Execução** só depois do `APROVADO`; o resultado vem por e-mail, como no chat.

## Limites
- As regras permanentes do dono continuam valendo (nunca e-mail de teste para operator-39089b8a18@example.invalid` nem para .gov/.leg/.jus.br; `HASH_PEPPER` intocado; não ler `secrets/`; datas originais das assinaturas intactas). Só o dono as levanta, expressamente.
- O classificador de permissões do Claude Code não aceita e-mail como autorização de escrita em produção (reenvio em massa, deploy). Nesses casos o Claude envia o **comando exato** (caminho completo) para o dono rodar.
- O vigia só funciona enquanto a sessão do Claude estiver aberta.

## Comandos que o dono precisa rodar
Sempre que uma ação exigir um comando (o classificador de permissões bloqueia escrita em produção e envio a terceiros), o Claude **envia o comando por e-mail**, no mesmo turno, com **caminho completo**, pronto para copiar, colar e executar, e diz o que ele faz e como conferir depois. Também diz no chat, mas o e-mail é obrigatório.

## Triagem automática das mensagens de contato (vigia)
O `vigia.mjs` tem duas rotinas, e as duas retomam de onde pararam toda vez que ele é ligado (nada do que chegou com ele desligado se perde):
1. **Ponte**: e-mails do dono (DKIM do mesmo domínio), com o ponto de retomada em `.cache/ponte/vigia.json`.
2. **Triagem** (`triagem.mjs`, SOMENTE LEITURA no servidor, via `ssh peticao-root` e uma sessão do banco aberta como somente leitura): ao ligar e a cada 5 minutos procura em `contact_messages` as mensagens com id maior que o último visto (`.cache/ponte/triagem.json`). Para cada uma reúne: cadastro (sem CPF), e-mails enviados e devoluções do endereço, lista de bloqueio, fila, reenvio por falha, saúde do app (serviços, erros do registro do servidor nas últimas 24 h sem dados pessoais, fila de e-mails, taxa de falha de envio). Classifica o relato (não recebeu e-mail, link expirado, CPF/nome, correção de dados, remoção LGPD, e-mail recusado, erro na página, dúvida), dá o veredito (PROCEDE / EM PARTE / NÃO PROCEDE / JÁ RESOLVIDO / INCONCLUSIVO / PRIORIDADE) com os motivos, uma proposta de resolução e um rascunho de resposta, e manda UM e-mail de relatório ao dono por rodada.
- **Nunca** escreve no servidor, **nunca** escreve à pessoa que reclamou (o rascunho vai só ao dono) e **nunca** mostra CPF (o que a pessoa escreveu é mascarado no relatório).
- Primeira rodada: só entram mensagens a partir de 05/11/2026 12h (as anteriores já foram tratadas à mão). Para reprocessar tudo, apague `.cache/ponte/triagem.json`.
- Testar sem enviar nada: `node /mnt/dev/peticao/tools/ponte/triagem.mjs --simular`. Desligar só a triagem: `VIGIA_SEM_TRIAGEM=1`. O vigia roda como Monitor da sessão (expira em ~30 min: rearmar) e só funciona com a sessão aberta; sem sessão, a triagem roda na próxima vez que ele for ligado.
- Limites: regras automáticas; o veredito INCONCLUSIVO pede leitura humana. Se o servidor não responde por SSH, o vigia avisa uma vez e tenta de novo na rodada seguinte.

## Vigia contínuo — substitui o monitor de sessão a partir de 06/11/2026

A pedido do dono, `peticao-vigia.service` passa a rodar no systemd do usuário `barre`, habilitado no início e com `Restart=always`/retentativa após 5 segundos. O linger foi habilitado e conferido: o serviço continua após encerrar a sessão gráfica. A máquina precisa permanecer ligada e conectada. Isto substitui as menções anteriores ao limite de 30 minutos e à dependência da sessão do Claude para **receber e triar** mensagens; a execução por um agente ainda depende do executor/sessão disponível e das aprovações.

- Consulta da Ponte: a cada 30 segundos, com timeout de rede, paginação completa das chaves e cache das mensagens imutáveis durante o processo. Referência da paginação: [Cloudflare KV — List keys](https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/subresources/keys/methods/list/).
- Pedidos autenticados pelo DKIM do dono são persistidos, sem truncar o corpo novo, em `.cache/ponte/entrada/`, arquivos privados, com estado `aguardando_leitura`. O identificador da mensagem evita duplicação mesmo quando duas chegam no mesmo instante. As mensagens retidas pela Ponte são recuperadas ao iniciar; importar para a fila não aprova nem executa pedidos antigos.
- O cursor histórico `vigia.json` foi preservado. O novo monitor usa `vigia-health.json`; não depende de um corte por horário que possa perder mensagens atrasadas no KV. Não apaga as decisões de aprovação nem as propostas existentes.
- Triagem de contato: inicia junto e repete a cada 5 minutos em processo separado com limite de execução. Consultas à VPS continuam somente leitura; relatórios vão apenas ao dono, nunca automaticamente ao participante. Uma triagem lenta não bloqueia a leitura da Ponte.
- Os logs do novo monitor registram estado e identificadores, sem corpo dos pedidos. A fila privada contém os pedidos e deve ser tratada como informação sensível.
- Estado: `systemctl --user status peticao-vigia.service`. Saúde: `.cache/ponte/vigia-health.json` e `vigia-triagem-health.json`. A hora de `ultimaConsulta`, e não somente o processo ativo, comprova uma consulta concluída.

Esta instalação não cria um agente autônomo que executa e-mails, não concede autorizações novas e não expõe segredos. Mantém os critérios de autenticação e o protocolo de aprovação já existente. Os testes de recepção/deduplicação/paginação e as regressões de triagem ficam em `tools/test/vigia.test.mjs` e `tools/test/triagem.test.mjs`.
