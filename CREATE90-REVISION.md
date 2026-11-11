# Correção mínima para nova execução explícita R13

Perfil executável separado: `/mnt/dev/.peticao-r0013-create-reconciliation-draft-20261111/profile-v2`. Base preservada: `/mnt/dev/.peticao-r0013-local-pdf-preparation-browser-qa-20261111`, Git53accbc147d257ad64ea53f14a46c004c76944a0. O R13v1 executou e falhou antesdePG/app/browser: createDocker excedeu30s; cleanup observou ausência e removeu rede, mas o container apareceu Created posteriormente. ROOT conferiu identidade/isolation e removeu somenteID4a46dbb47ced33665c4362f450510cb8bf384a0b568d80fc62bbe5685d74ad48. Oldouterfailed1/marker/run/logs permanecem intactos.

## O que muda e o que significa

- `local_controller.py` usa create90s semretentativa (um único d.dockercreate). Não é promessa de corrigir causaI/O: a latência exata não foi medida e a pressão deI/O só foi observada após a falha. Não há prova de qual device/processo causou o atraso; nenhuma configuração globalDocker/disco foi modificada.
- Antes de QUALQUER mutação initialize(networkcreate/containercreate) e start: uncertain=True, fase/IDs/intenção em checkpointprivado atômico+fsync. Sóclear após respostaID e inspeção/validação de identidade/image/network/isolation e refence/cancel/deadline. Timeout, SIGTERM/cancelamento ou errodeinspect posterior conservamuncertain. O erro público é constante, semstderrbruto; errorClass é registrado, causaoriginal preservada no encadeamento.
- `stop()` incerto **não chama d.cleanup**, não remove container/rede e não transforma uma observação de ausência em término do pedido. Devolve stoppedFalse/dependencyHeld/manualReconciliationRequired/resourceAbsenceEstablishedFalse, com IDs/fase. EstadoPG após start incerto pode ser desconhecido, nunca falsamente“não iniciou”. O jobfalha e requer ROOT reconciliar exatoobjeto antes de novo intento. Não é leak silencioso nem retentativa automática: é retenção conservadora explícita de dependência em erro.
- No caminho normal com todos os ACKs+inspects validados, cleanup continua pelosIDs exatos após refence. Nenhumstart é admitido seinitializeincerto; nenhuma assinatura/aprovação/envio foi acrescentada.
- `functional_smoke.py` passa deadlineglobal600s e CancellationState aoDockerPG. Antesde mutação exige tempo para chamada+metadata (network30/container105/start35s); apósresposta verifica novamente. Alarm600/Runtime720/TimeoutStop120/CPU2/Mem3G/Tasks256/RemainAfterExit permanecem. Aumentarcreate90 não estende jobglobal; incertostrava novoPG/app e exige encerramento manualde recursos.

## Novo intento, não replay

Somente `execution.create90-v2.started` viaO_EXCL, em diretório novo e unidade `peticao-r0013-create-reconciliation-v2-20261111.service`. Gate exige quatro provas ROOT originais pinadas em `/mnt/dev/.peticao-r0013-local-pdf-preparation-browser-qa-20261111/runs/97b317f6483b/`: root-failure-receipt.json, root-retained-unit.txt, root-manual-reconciliation.json e outer-result.json; também oldexecution.startedSHA. Exige failed1/invocation00244..., pre-app0, manualreconciliação IDexato/portsclosed, runtimeestável e ausência de replay. Checagens novas somenteleitura do labelnonceold e portas precisam estarvazias. Ausência isolada não bastaria: o reciboROOT de recurso tardio observadoe removido é obrigatório. Se reaparecer recursoold, gatefalha semautorm. Nonceold97b317f6483b nunca será reutilizado.

## Limite da entrega

Nova cópiapequena de todos os scripts/sourcepins/assetsmetadata do R13, semcopiar runtime. Browser/fixture/renderA1sintético/refexample.org/POSTcriarúnico/guard/15checks permanecemmesmo escopo; apenas root/unit de QA foram rebased. Não há credencialA1 real, assinatura, validaçãoexterna, publicação, códigoOTP ou envio. R6/R9/R10/R11/R12/R13v1 e produção intocados.

Coregrace90+backend genérico no diretórioPAI (`create_reconciliation.py`, `fixed_backend.py`, `controller_adapter.py`) são **rascunhos nãoqualificados/nãointegrados**, fora do manifesto e sys.path desteperfil. Nenhum deles é importado pelo executável. A escolha do ROOT foi correção mínima agora, não framework novo.

22mocks dirigidos executam ramos reais do controller/gate com Docker/socket/fences totalmentemockados: normal,timeout/SIGnetwork/create/start, erroinspect,IDtrocado/foreign,cancel/deadlineantes/durantemetadata,provasROOT/freshlabel/portas/newmarkerexclusivo.8testesNode de política+root/unitnovo passaram. NenhumPG/app/Docker/browser/HTTP real foi iniciado pela preparação. O resultado de geração moderna permanece NÃOvalidado até novoensaio aprovado, unidade realretida0 e recibos completos; nãoherdarpass da tentativafailed.
