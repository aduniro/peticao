# R8 — pacotev2/código/aprovação/conciliação, arquivo completo

Rascunho preparado para revisão; NÃO EXECUTADO. Quinze mocks locais aprovados; zero Docker/Node/PG/app/callback real desta bateria iniciado durante preparação.

Raiz: /mnt/dev/.peticao-r0008-local-package-approval-pg17-qa-20261111
Runner: /mnt/dev/.peticao-r0008-local-package-approval-pg17-qa-20261111/local_runner.py
Registry: /mnt/dev/.peticao-r0008-local-package-approval-pg17-qa-20261111/local-registry.json
Mocks: /mnt/dev/.peticao-r0008-local-package-approval-pg17-qa-20261111/mock-proof/result.json

## Escopo completo e fonte

Executar EXATAMENTE site/src/lib/batch-package-delivery.test.ts de f555/93557, treze callbacks/zero skips, sem recorte de probabilidade de aprovação. Inclui o décimo-terceiro callback de rollbackfence: ele lê deploy/mail-rollback.sql e testa suas recusas/imutabilidade em transação no PG fictício próprio; não faz deploy, não executa rollback de aplicação publicada ou banco real. Esse caso NÃO homologa rollback/forward-recovery coerente do código com novos govbr validationintents. Esse critério da release permanece pendente. A qualificação independente de outerunitR3 também não é apagada por R7/R8.

O source93557bfba931f8f731807fc9f30f1d88dbafedf1 é reutilizado somente leitura em /mnt/dev/.peticao-r0003-local-pg17-qa-20261111/attempt-2/runs/71931338c422/source. Todos21arquivos específicos de protocolo, schemas, rotacodigo, mailjournal e deploy/mail-rollback.sql foram comparados byte a byte com f55595cd348c23ffe559dba2de9150259db9f1e7. Inventário completo de fonte+proddeps+3devpacotes é verificado antes do PG e depois dos testes, teto256MiB por arquivo, sem nova cópia grande ou fallback. Guardas58cb CJS/DNS/policy permanecem byte-idênticas. Node20localb964 e imagemPG17.11Docker665dc7... são fixos.

## Treze callbacks (nomes/ordem exatos no registry)

1. Uma aprovação entre concorrentes, dois PDFs imutáveis exatos e chave/binding de pacote v2.
2. Pacote substituído invalida código mesmo quando bytes/digest iguais.
3. Gates/step-up/validação obsoleta recusam sem fallback para um PDF.
4. Descriptor parcial/anexos alterados falham fechados; resolve legado só no teste explícito de descriptor, sem envio unsigned.
5. Aceite real do devspool/journal seguido de falha SQL de persistência; conciliação com gates desligados sem nova saída e replayupdated0.
6. Escrita de spool incerta bloqueia nova aprovação/retry.
7. Troca da seleção de petição-base invalida código até nova revisão do pacote.
8. Mesma intenção de código repetida/concorrente não renova validade, não zera tentativas e não emite novo código.
9. Intenções substituídas/consumidas/divergentes não restauram aprovação antiga.
10. Código vincula configuração aprovador/destinatários e aceita outro Total autorizado.
11. Quota conta só intenções novas; falha de auditoria reverte antes do e-mail.
12. Handlercodigo real (NextRequest direto), sessão/step-up reais em PG; dedupe formulário e rejeição de campos inválidos.
13. FenceSQL de rollback recusa estados irresolvidos sem tocar fila/auditoria; estados terminais permitidos preservam snapshot, somente fixture.

## O que será real e o que é pré-condição sintética

Código de aprovação/consumo, locks/transações/triggerfaults/auditoria PG17, escrita do provedor dev em arquivo e journal/message/attempt são implementação real, não mocks do transport/journal. Os dois PDFs e a evidência criptográfica inicial da fixture são sintéticos. A fixture usa perfis/relatóriosQA em memória para preparar a base/pacote pelas APIs reais; não é homologação de ICP/gov.br nem certificado A1 real. Não modificar assertSendable/gates/guardas. Não executar drafts unsigned, IA ou contatos.

MAIL_PROVIDER e MAIL_PROVIDERS são dev no ambiente reconstruído; marketing vazio, credenciais/providers reais ausentes, HASH_PEPPERfictício, diretórios HOME/config/credentials/GEO vazios próprios. As fixtures configuram somente qa-owner@example.test e qa-recipient@example.test e criam seus spools sob TMPDIR/qa-packet-delivery-*. Cada finally remove seu spool/schema; não atribuir entrega externa a MAILdevaccepted. Contrato de source/testes é atualf555, não validação por fixture antiga de outra versão.

## Gates do executor

Contexto LOCAL honesto, kind local-package-approval-pg17-r0008-v1, nova unidade peticao-r0008-local-package-approval-pg17-qa-20261111.service e nomes/labels únicosR8 via owned_name compartilhado por create/inspect/start/reinspect/cleanup. CPU2/Mem3GiB/Tasks256/RemainAfterExit=yes, soft600/reserva120, Runtime720/TimeoutStop120. Container separadoCPU1/Mem512MiB/tmpfs256MiB/PIDs128, bridge normal exclusiva, --pull=never, host127.0.0.1:55487somente; recursosDocker adicionais à unidade.

Preflight e handshake PG170011/cluster_nonce/database por container e TCP host antes dos testes. Único arquivo com pattern.*; exigir EXATAMENTE13nomes TAP e tests13/pass13/fail0/cancelled0/skipped0/todo0. Pai e único filho de teste devem ter guardas instaladas, negações inesperadas0 e contagem de recusas IPC opcionais preservada. Schemaquery contém explicitamente todos13schemas, tanto t_packet_* quanto t_code_intent_*, incluindo t_packet_rollback_fence. Todos devem sumir. Exigir também nenhum TMPDIR/qa-packet-delivery-*remanescente e mail-outbox próprio vazio; código não mantém a regra antiga t_document_history_*.

Cancelamentos durante Node/Dockercleanup, export e recibos são contados/deferidos para tentar toda limpeza e forçar outerexit1; sinais fora de cleanup interrompem. Mocks percorrem mainlifecycle e os pontos de cancelamento sem executar recursos reais. Nenhuma operação com resultado incerto será repetida automaticamente.

Logs TAP/stderr originais permanecem privados na rodada. Exportação pública técnica projeta TAP somente com nomes/status/totais fixos, sem diagnósticos arbitrários de assert que poderiam mostrarOTP/envelope; stderr exportado é apenas tamanho+SHA, sem conteúdo. Erros detalhados do result privado não são copiados à projeção. Cookie/código/spool bruto/config nunca devem ir a Git/email. Asserções de privacidade são testadas com OTP/token fictícios, mantendo os rawlogs originais intactos.

Root deve revisar manifesto/pins e obter lease exclusivo antes de executar o comando proposto em /mnt/dev/.peticao-r0008-local-package-approval-pg17-qa-20261111/EXECUTION-COMMAND.txt. Aceite exige outer-result pós-export, manifesto/hash, ExecMainCode/ExecMainStatus/Result reais da unidade retida, cgroup inteiro e Docker próprios drenados e porta55487fechada. not-found/default0 não comprova sucesso.

Esta bateria é protocolo/bibliotecas e um handler HTTP chamado diretamente; não é E2E de rede do runtime compilado nem browser do formulário de aprovação. SmokeHTTP posterior continua necessário conforme /mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/goal-acceptance-20261110/approval-otp-reconciliation-audit-20261111/NEXT-V2-BATTERY.md. Não faz merge/deploy e não fecha A1real, entregaOTPexterna ou rollbackintegral.

RawTAP é sempre parseado para13casos/fail/skip ANTES da projeção. result.json contém rawLogSha256 de TAP e stderr após limpeza do filho; os arquivos raw permanecem privados para revisão do root, sem sobrescrita pela exportação.
