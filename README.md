# Contrato candidato de execução remota

Estado: **fonte local para revisão; NOT DEPLOYABLE**. Não instala serviço,
não abre conexão SSH, não inicia systemd e não toca a fila real. Usa Civo como
central, Akamai como apoio e Azure somente quando o acesso legítimo for
restabelecido. Não há GPU, segundo Kubernetes ou nova contratação.

## O que este pacote implementa

`Claims` exige uma queue.sqlite existente com o schema legado de jobs/events.
A migração explícita adiciona remote_execution_claims ao mesmo banco; não cria
outra fila. Reserve grava claim e transição queued→starting numa transação
BEGIN IMMEDIATE. Constructor e observe não modificam os bytes do banco.
Bind fixa o recibo observado do trabalhador; authorize_once consome uma única
autorização durável. O segredo por tarefa tem 256 bits, fica fora dos resultados
públicos e só seu hash é enviado durante prepare. O integrador guarda o segredo
num envelope privado e só o libera para start após authorize_once retornar True.
Resposta perdida da autorização NÃO permite reconstruir/reemitir autorização.

`WorkerJournal` grava recibos em disco persistente do trabalhador. Não agenda
tarefas. Prepare fixa manifesto, nó, boot e nome determinístico de unit.
Start valida segredo/identidade e confirma start_intent com synchronous=FULL
ANTES de chamar um único adaptador confiável de lançamento. Se a resposta se
perder, o estado fica uncertain; se o processo morrer antes do lançamento,
start_intent permanece. Nenhum dos casos admite replay automático. Observe usa
o mesmo ID. Cancel só encerra definitivamente um prepare ainda não iniciado;
após start_intent exige prova externa da unit/cgroup, sem declarar parada.

Nenhuma garantia de exactly-once para efeitos de uma aplicação é oferecida.
O contrato favorece at-most-once launch: uma tarefa pode não executar e ficar
incerta. A recuperação deve observar o recibo e a unit originais antes de uma
decisão explícita sobre uma tarefa nova. O callback de testes realmente cria
um subprocesso de fixture, mas seu InvocationID é sintético: não prova systemd.

## Guarda persistente comum

Candidato compartilhado com o desenho de fencing do Apoio:
`/etc/peticao-dev-authority/epoch.json`, fora da árvore restaurável da fila.
Diretório root:root0755, arquivo root:root0644; nenhum usuário de serviço ou job
pode escrever. Todos os ancestrais devem ser de root e sem escrita de grupo ou
outros; links/hardlinks são recusados. Schema exato de quatro campos:

* generation: inteiro positivo, piso persistente;
* primary_host: civo nesta etapa;
* coordinator_boot_id: boot real autorizado da Civo;
* operation_id: identificador hexadecimal de 32 caracteres da operação canônica.

O digest é SHA256 do JSON UTF-8 com sort_keys=True e separators=(',',':').
O manifesto da tarefa fixa generation, coordinator_host, coordinator_boot_id,
authority_operation_id e epoch_sha256. Claims exige ainda authority.json primary,
geração atual e armed_boot_id igual ao boot local. O trabalhador verifica a
mesma identidade de época antes de mutações, inclusive depois de obter o lock
SQLite. Mudança de boot invalida rearm sem nova operação qualificada.

Isto **não é consenso distribuído**. A biblioteca não distribui o controle,
não muda época e não fornece procedimento seguro de promoção. Não existe
atomicidade entre arquivos de controle de máquinas distintas. O procedimento
futuro deve primeiro fechar admissão e cercar todos os executores antigos,
provar quiescência e só então distribuir/verificar o piso e promover. Uma leitura
isolada do guard não fecha uma corrida de promoção concorrente. Bootstrap,
gateway, RPC, launcher, dispatcher e rearm legados devem todos ser adaptados;
instalar só este módulo seria insuficiente. O legado atual NÃO lê este guard.

Os testes sem privilégios injetam explicitamente um validador de arquivo do UID
de fixture. Em produção o default exige a cadeia root-owned; o futuro adaptador
não pode aceitar do RPC uma função de validação, path de controle ou chave.
As permissões reais root→vigia e as corridas de promoção ainda precisam de
qualificação com identidades e isolamento reais.

## Fronteiras que impedem ativação

1. O submit legado recusa backend/manifest novos. Nenhum código instalado foi
   alterado; falta a adaptação explícita da API compatível e validação de perfis.
2. Dispatcher e reconciler legados ainda presumem execução local. Devem excluir
   jobs remotos e consultar recibos originais; não podem marcar interrupted só
   porque um arquivo local não existe. Nunca habilitar ambos para o mesmo job.
3. Não existe RPC autenticado, transportador SSH pinado ou forced-command novo.
   O callback launch é código confiável interno, nunca campo de request remoto.
4. Falta adaptador root-owned systemd: comprovar unit inexistente, isolamento
   real, credenciais/DB/Docker inacessíveis, limites, saída e InvocationID real.
   A workload não pode acessar/escrever journals, guard ou credenciais do RPC.
5. Falta finalizador de resultado/artefatos, custódia/exportação, validação do
   cgroup vazio e cancelamento real da unit própria. Este módulo nunca marca um
   job como completed. Ainda não atende o aceite fim a fim do plano.
6. Faltam instalação/rearm/gateway e distribuição qualificada do guard nos dois
   possíveis primários e nos trabalhadores, fencing, snapshot final fresco,
   ensaio de promoção/restart/failback e prova de único primário.
7. Azure segue desligada como última observação confirmada; novo controle API
   foi bloqueado por AADSTS530035. Não houve login, bypass ou wake nesta etapa.

É proibido adaptar isso por um shell genérico/argv recebido da tarefa. O
manifesto tem campos exatos e só admite perfil/digests prequalificados. Fixtures
de teste não qualificam build/QA reais. A fila de validação Nome–CPF e o banco
de assinaturas de produção estão fora do escopo. Codex continua no Dell.

## Testes e evidência

Executar `python3 -m unittest -v` neste diretório. Somente diretórios temporários
privados dentro deste pacote. Os testes incluem disputa de oito processos com
um único subprocesso real, segredo incorreto, crash após commit, resposta perdida,
reboot, guarda nova/ausente/adulterada, cancelamento antes/depois do lançamento,
arquivo inseguro, parent em symlink, ausência de fila e preservação de linha/evento
legados. Os logs completos ficam privados e fora do Git.

Os testes não medem NFS/filesystem remoto, corrupção de armazenamento, perda
de energia do kernel, root hostil ou resistência a um trabalhador comprometido.
As qualificações reais de guard, SSH, namespace e systemd são gates separados.
