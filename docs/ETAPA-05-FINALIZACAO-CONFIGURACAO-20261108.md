# Conhecimento/contexto/assistentes — finalização sob revisão atual

08/11/2026, execução atual `d24c089484ec4e609dd3fe750e190284`, candidato exclusivo
`candidate-stage02-domains`. Escopo local; serviços sem credencial permanecem
desativados. Nenhuma leitura de cofre, chave real, autenticação do chat, cobrança,
envio, interface nova ou operação na VPS.

## Proteção implementada

O executor já conferia contexto depois da resposta e conta dentro da conclusão.
Havia uma janela entre essas operações: a configuração podia mudar depois da
conferência e antes de gravar `completed`. A finalização agora toma a mesma trava
de configuração usada na reserva/gravação de preferências, na ordem conta →
configuração, e confere habilitação e revisão esperada dentro da transação final.

Revisão alterada, desabilitação ou configuração inválida descartam o texto com
`context_changed`, sem devolver minuta. O consumo observado é conservado, assim
como a reserva de quota, autoria e UUID. Não restaura pergunta/resposta, não
renova orçamento, não libera repetição automática e não chama outro modelo.
A auditoria e a finalização continuam atômicas. Revisão de fontes/triagem mantém
o contrato existente; não se afirma uma transação universal sobre todas as fontes.

Não houve alteração do protocolo externo, seleção automática de modelo, endpoint,
preço ou política de envio. Provedor real continua exigindo as portas anteriores;
testes positivos recebem somente dependências internas fictícias, que não podem
ser passadas pelo navegador. Texto retornado segue revisável, não persistido e
não enviado. Nenhum aviso público/pendente foi alterado.

## Falha inicial e sincronização conferida

Primeiro `--ai-tests`:36/37, uma falha na fixture nova que esperava a fase final
por `query LIKE` em `pg_stat_activity`. O polling ocorria na mesma transação e
mantinha snapshot estatístico, portanto não comprovou que a execução alcançara
a trava pretendida. Esse resultado não foi apresentado como sucesso.

Após conferência do principal, a fixture limpa `pg_stat_clear_snapshot()` a cada
sondagem e procura a query EXATA da finalização, com sessão bloqueada pelo PID da
transação controladora (`pg_blocking_pids`). A conta é liberada só depois de uma
gravação real de configuração por outra conta autorizada. Não se aumentou timeout
nem se relaxou a asserção. Duas situações são exercitadas: desabilitar e trocar
perfil depois da conferência do contexto.

Repetição: **37/37 aprovados**, zero falhas/ignorados/cancelados, saída0.
Abrange conhecimento, três contextos, executor/quota e curadoria de campus.
Cada corrida conserva tokens observados/reservados, descarta texto, registra
auditoria e impede segunda chamada do UUID. Tipos passaram antes do build.

Logs originais preservados e copiados para pasta ignorada pelo Git:

- `.cache/qa-ai-finalization-20261108/targeted-initial-failed.log`, de
  `/tmp/admin-consolidation-hzzxwus0/validation.log`;
- `.cache/qa-ai-finalization-20261108/targeted-final.log`, de
  `/tmp/admin-consolidation-_857djiw/validation.log`.

Build, tipos após build e HTTP desta revisão passaram, saída0.
Nenhum DDL novo; não repetir migração/cumulativa antiga por inferência de progresso.

## Contrato operacional atual e artefatos

`python3 tools/admin-qa/consolidation.py --contracts ai-executor` passou com
servidor/banco fictícios próprios3033/54349, configuração vazia e serviço de IA
desarmado. Relatório lido em
`/tmp/admin-consolidation-6cdm5eaf/ai-executor.json`: três contextos, níveis e
confirmação extra, perfis explícitos, revisão conflitante, contexto antigo
recusado, prompt não exposto, idempotência e contadores de quota/uso. Nenhuma
escrita em assinaturas/filas de e-mail. Geração positiva somente pela biblioteca
com fetch/credencial fictícios injetados internamente; não é geração HTTP real
nem prova de acesso/crédito/modelo em provedor.

Relatório e log copiados para `.cache/qa-ai-finalization-20261108/`; originais
preservados, runtime fora do Git. SHA-256 conferidos:

- log inicial36/37: `f217250c665632ca83653419f2361b2919a42fd444b7b4abe8e50f245e0986c0`;
- log final37/37: `041a18ed394cb2bdaade112e8483bd3ccc8599cdf0eb1aa3640a8cbf97f2d247`;
- relatório HTTP: `34e0e53042bc4ff2deb8ad29ee88566d7253c539de5aced0186785e27aacfd36`.

Todos os executores próprios terminaram; banco/servidor do contrato encerrados.
Não há alegação de geração/teste autônomo ainda rodando. Não se repetiram os45
testes de e-mail ou19 de domínios já aprovados; o ensaio HTTP de domínios antes
faltante foi a verificação necessária para seu fechamento separado.

## Etapas anteriores preservadas e fechadas

A aprovação técnica de `python3 tools/admin-qa/consolidation.py --ai-tests` foi
conferida SOMENTE nos registros de aprovação da própria tarefa no monitor,
aberto em modo somente leitura. Não foram lidos outros threads ou payloads de
credenciais. O principal esclareceu que não houve recusa do dono aos commits
locais e reiterou o fechamento por etapa. Foram fechados:

- `7b4fa11`: e-mails/recuperação/retencão, com45 testes e contratos anteriores já
  conferidos, sem repetir QA aprovado. Parte do runner de IA ficou fora do índice.
- `fa93f22`: lote atômico/versionado de domínios; HTTP que faltava executado e
  aprovado nesta retomada, sem repetir19 testes/build/tipos já aprovados.

## Limites e próxima etapa

Isso é uma proteção backend da ETAPA05, não conclusão do painel integral.
Interfaces, outros provedores além do protocolo atual e minutas persistentes
continuam no plano; não foram fabricadas credenciais ou aprovações para ativá-los.
AV9/AV11/AV12 e AV16 continuam sem resposta, conforme principal. Arquivamento de
entidades e informes permanecem no checkpoint próprio. Não misturar aprovação
técnica de QA/commit com aceite desses textos/decisões de produto.

## Matriz fiel da ETAPA05

| Requisito | Evidência/estado |
|---|---|
| Base comum, finalidades e citações atuais | Backend existente exercitado nos37 testes; sem interface de consulta conectada. |
| Contextos painel/divulgação/atendimento | Backend/HTTP atuais aprovados; instruções/dados privados não retornam na API. |
| Quota, UUID, incerteza, autoria e revisão final | Biblioteca com provedor fictício,37 testes e consulta operacional compilada aprovados; novo fechamento transacional de configuração. |
| Provedor/conta/modelo reais | Serviço permanece desarmado; nenhuma credencial real lida nem cobrança/teste externo realizado. |
| Outros provedores além do protocolo existente | Não implementados neste bloco; não inventar fornecedor/modelo/credencial ausente do escopo detalhado. |
| Interfaces de conhecimento/contexto/assistentes | Ainda não conectadas; exigem controles/textos revisados segundo a regra do dono. |
| Minutas persistentes/editor | Pendente de AV16;30dias não equivale a aprovação de compartilhamento/propriedade/textos. |

Estado: **continue** para a ETAPA05 integral. O backend desta correção está
validado para commit local exclusivo de IA; não declarar os módulos completos.
Próxima etapa verificável: revisar/conectar as interfaces e a persistência somente
no escopo/textos aprovados, ou continuar outro backend independente da matriz.
Não prometer execução em segundo plano quando não houver comando ativo. A fila
de requisitos restantes não autoriza alterar AVs pendentes ou ativar provedor.
