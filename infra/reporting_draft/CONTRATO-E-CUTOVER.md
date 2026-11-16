# Relatório único por hora — draft isolado, sem ativação

Raiz exclusiva: `/mnt/apps/peticao-final/_ops/controle-operacional/infra/reporting_draft`.
Este artefato prepara uma etapa do plano existente. Não cria coordenação,
autoridade, scheduler ou canal de e-mail paralelo. Nenhum código vivo, timer,
configuração, chave SSH ou dado da aplicação foi modificado por esta entrega.

## Inventário da fonte atual

Emissor atual: `/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/report.mjs`.
Renderer auxiliar: `/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/tree-render.mjs`.
Coleta local: `/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/collect.py`.
Coleta da coordenação: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/collect_report_coordination.py`.

Timer e serviço existentes:

- `/home/barre/.config/systemd/user/peticao-relatorio-andamento.timer`
- `/home/barre/.config/systemd/user/peticao-relatorio-andamento.service`

Cadência observada: todo horário `*:00:00`, Persistent=true, sem jitter,
AccuracySec15s. O serviço é oneshot, Restart=no, timeout90s, UMask0077 e
NoNewPrivileges. Node efetivo do comando:
`/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node`.
Não foi iniciado um segundo timer.

O código usa Node builtins, Python stdlib e os dois renderers. Não precisa
Next.js, PostgreSQL, Docker, npm install ou build do site para renderizar.
Os imports absolutos de coleta, keystore e histórico do monitor são locais;
copiar somente o arquivo report.mjs não produz um emissor portátil.

A chave de envio é lida em memória pelo helper
`/mnt/apps/peticao-final/peticao/tools/infra/lib/keystore.mjs`, nome
MAILERSEND_API_TOKEN. Não copiar o cofre inteiro: ele reúne credenciais de
outros serviços sem relação com relatórios. A implantação futura pode usar o
arquivo já protegido do ops-control em
`/etc/peticao-ops/control/mailersend-api-token` NA VPS. Nenhuma chave foi lida
ou copiada por este draft. Destinatário continua fixo operator-1608598f41@example.invalid.

Os slots atuais ficam em
`/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/slots`.
O identificador é a hora UTC truncada, por exemplo `2026-11-10T23-00-00-000Z`.
Há reserva com criação exclusiva antes do POST. Qualquer arquivo do horário
existente impede retry, independentemente do resultado. O estado started após
queda é incerto; não prova que nada saiu. Aceite202 não comprova entrega.

O emissor atual não faz fsync explícito da reserva/diretório. Este draft
acrescenta essa ordem ao núcleo novo, mas não modifica nem declara corrigida
retroativamente a rotina viva.

O emissor legado classifica todo HTTP não2xx como rejected, inclusive5xx.
Na leitura para recuperação, um5xx não comprova ausência de aceite: o draft
apresenta estado efetivo incerto, sem reescrever o original e sem reenvio.
Aceite legado sem recibo qualificado também não é promovido a certeza. O
adaptador real futuro deve recusar redirects e qualificar receipt/HTTP202.

Inventário de hashes e estado systemd/slots, somente metadados:
`/mnt/apps/peticao-final/_ops/controle-operacional/infra/reporting_draft/source-inventory.json`.
Nenhum relatório HTML/TXT/CSV gerado, cadastro, exportação ou log bruto foi
lido/copiado. Dos slots, só foram contados estados conhecidos; IDs de provedor
e conteúdo individual não foram exportados.

## Draft entregue e limites

- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/reporting_draft/renderer.mjs`
  reaproveita a renderização atual, sem entrypoint de coleta/envio, preservando
  o layout. A política de captura vem do normalizador, e o título de Git
  informa a origem em vez de afirmar que o emissor está na máquina local.
- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/reporting_draft/tree-render.mjs`
  é cópia exata do renderer auxiliar.
- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/reporting_draft/cutover-core.mjs`
  qualifica reserva durável, owner/fence do registro confiável e snapshots
  desatualizados. NÃO contém cliente HTTP, credenciais, scheduler ou CLI viva.
  O único transporte permitido é um fixture injetado. Defaults recusam.
- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/reporting_draft/cutover-core.test.mjs`
  usa apenas dados fictícios em `/dev/shm`, com guard de rede. Sem e-mail real.

O formato de autoridade deste núcleo é somente validação de estrutura/host.
Não autentica um JSON recebido pelo navegador ou e-mail. O futuro loader deve
verificar a atestação administrativa do ledger ÚNICO, o evento/manifesto, os
ACKs admin+apoio e o fencing efetivos. Uma lista com nomes dos coordenadores
não comprova esses ACKs. Não há loader/assinador de autoridade real neste draft.

O registro instalado deve ser protegido contra escrita pelo processo emissor,
por arquivo administrativo ou mecanismo de assinatura qualificado. Não
pressupor sudo local disponível nem substituir isso por um booleano no cliente.
A autoridade persistente do serviço é a implantação autorizada até revogação;
não criar uma eleição própria nem depender de renovar lease local por hora
quando o computador estiver desligado. Mudança de dono exige o protocolo único.

Para efetivar ainda faltam: produtor remoto de metadados autenticado, loader
de autoridade, guard também no emissor legado, transporte real qualificado,
importação consistente do estado, units finais e prova do cutover em disco.
Não existe uma segunda rotina executável de envio pronta nesta entrega.

## Metadados quando a máquina local estiver offline

O produtor deve emitir cápsula limitada com schema_version1,
producer=local-project-metadata, captured_at original e report_data compatível
com o renderer. Não aceitar caminhos/comandos/SQL arbitrários do chamador.
O consumer permite apenas as seções conhecidas e recusa campos de corpo,
prompt, objetivo, histórico, credenciais, saída bruta e dados de signatários.

Uma falha de coleta conserva a captura anterior com seu horário original.
Gerar e-mail agora não renova o timestamp da origem. Estados running antigos
ficam explicitamente não observados; percentuais são históricos, não CPU nem
prova de agente executando. Captura ausente/inválida/futura não fornece
percentual. O horário do coletor não é progresso.

O collect.py atual lê arquivos inteiros de inventário de normalização e QA
para extrair totais. Não expor esse acesso amplo por uma nova chave remota.
O produtor futuro deve consumir agregados previamente saneados ou omitir a
seção indisponível. Não copiar inventários/exports ou resultados brutos para
Santiago. Git deve usar GIT_OPTIONAL_LOCKS=0 na coleta para evitar atualização
desnecessária do índice. SQLite deve continuar mode=ro/query_only/transaction,
sem inicializar Store, a aplicação ou seu banco.

Pode-se propor uma chave SSH DEDICADA somente leitura, gerada na origem futura,
com chave privada permanecendo ali e somente a pública instalada. O comando
forçado local só deve produzir o snapshot fixo, sem argumentos livres,
sem sudo, PTY, forwarding ou acesso ao shell. Porta privada2223, from restrito
ao IPv4/IPv6 Tailnet de Santiago; não usar a chave ampla de administração no
processo web. Não gerar/copiar/ler essas chaves nesta etapa. Exige manifesto e
ACK próprios antes de qualquer alteração real de SSH.

Uma falha desse canal não inicia sessões, troca modelo, retoma goal ou
consulta exports para tentar fabricar dados atuais.

## Cutover proposto — somente após qualificação e ACK duplo

1. Congelar commit, arquivos, contratos, hashes e testes; anunciar no ledger
   `/mnt/apps/peticao-final/_ops/coordenacao-dupla`, obter ACK admin+apoio e
   lease crítico apropriado. Reconciliar qualquer lease incerto primeiro.
2. Qualificar emissor novo desabilitado com o mesmo formato de slot e Owner.
   Instalar o guard no emissor legado ANTES da troca: o timer parado sozinho
   não impede alguém de executar manualmente report.mjs --send. O guard deve
   proteger também a função de entrega, não apenas o launcher do systemd.
3. Desabilitar o timer antigo, sem matar um POST em curso. Aguardar serviço
   inativo/MainPID0 e confirmar ausência de processo manual de envio. Se não
   houver drenagem verificável, abortar a troca, preservar o horário incerto e
   não ativar o novo emissor.
4. Com writer quiescente, criar cópia protegida de TODOS os slots e
   last-result.json. Registrar tamanho/hash, preservar bytes/estados e
   importar por criação exclusiva, recusando conflitos. Arquivo inválido ou
   desconhecido permanece bloqueador opaco; não apagar para reenviar.
   Não é necessário copiar corpos/HTML/CSV nem stamp do timer systemd.
5. Marcar o dono antigo revogado e instalar em Santiago a atestação do mesmo
   ledger com geração/fence superiores e referência aos dois ACKs. Confirmar
   que o legado recusa envio real mesmo em execução manual. Não usar uma
   indisponibilidade de rede como prova de revogação.
6. O primeiro horário elegível em Santiago deve ser a PRÓXIMA hora UTC após a
   drenagem, mesmo se faltar arquivo do horário atual. Isso evita duplicar
   uma aceitação cujo recibo se perdeu durante a troca. Persistent não
   backfilla horários ignorando essa fronteira.
7. Só então instalar/habilitar o timer único novo. Propriedades propostas:
   OnCalendar em UTC a cada hora, Persistent=true, AccuracySec15s, sem jitter;
   oneshot sem Restart automático, umask0077, timeout cobrindo coleta+API,
   usuário ops-control, estado fora do código, limites baixos e acesso mínimo.
   Não há comando ExecStart final para colar enquanto o runner real não for
   implementado/qualificado. Não alterar o timer existente com este documento.
8. Conferir apenas um dono e um timer habilitado, estado importado, nova
   reserva fsync antes do efeito e captura/source_time explícitos. Registrar
   aceite/rejeição/incerto com recibo; nenhuma entrega é presumida. Não enviar
   um relatório manual extra para testar o ciclo horário.

Se aceitar o provedor e falhar a persistência final, a reserva durável continua
bloqueando o slot. Resultado não vira queued. Reconciliação consulta o mesmo
ID/provedor e não repete automaticamente. O leitor de histórico preserva o
arquivo legado; não transforma um erro de parse em autorização de envio.

## Retorno/fallback

Retorno é manual, verificável e usa o mesmo ledger. Parar/desabilitar e drenar
o emissor novo antes de transferir o estado de volta, incluindo slots incertos.
Revogar sua autoridade, conferir fencing e ACK dos dois coordenadores, instalar
o dono anterior com nova geração e novamente só permitir a próxima hora UTC.
Falha de contato com Santiago não autoriza São Paulo/local a assumir enquanto
o emissor anterior pode continuar vivo. Não restaurar banco da aplicação.

## Qualificação executada

Comando local, somente fixtures:

```sh
/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node --test /mnt/apps/peticao-final/_ops/controle-operacional/infra/reporting_draft/cutover-core.test.mjs
```

17 casos passaram: concorrência, diretório symlink recusado, estados legados
opacos/5xx incerto, fsync antes do efeito,
aceite com falha de persistência sem replay, timeout, recibo ausente, troca de
autoridade, Owner fixo, bloqueio da hora de troca, fonte/árvore offline ou futura, proteção
de campos sensíveis e pureza do renderer. Rede guardada: zero chamadas reais;
transporte sempre fixture. Isso não é prova de queda de energia em ext4, SSH,
API real, timer real, fallback distribuído ou disponibilidade24h.
