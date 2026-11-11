# R15 — admissão A1 e recuperação do PDF original

PREPARAÇÃO SOMENTE. Nenhuma execução real foi feita por este agente. Revisão root + independente, manifesto congelado e lease exclusiva do runtime são obrigatórios antes de um único ensaio.

O original é gerado pelo próprio runtime f555, com três assinaturas fictícias confirmadas e policy A1 sintética de preparo. Não se semeia PDF, snapshot, lote, histórico, job ou assinatura pronta. Um POST HTTP do controlador usa a rota do formulário `/api/admin/lotes/criar?portal=presidente`; depois o browser faz um único POST `/api/admin/lotes/1/a1`. O login é HTTP e o step-up é fixture após autenticação; não equivale a testar o desafio de e-mail.

O browser abre o controle A1 nativo, confere availability/documentVersion/policyRevision, admite um pedido e verifica `Aguardando assinatura`. O controlador confirma no PostgreSQL um único job queued, attempts0, sem lease, saída ou validação. O ACK privado vincula requestId/jobId/inputArtifactVersionId/hash. Os cliques aguardam os controles habilitados; polling automático GET de queued é permitido e contado, sem tratá-lo como novo POST. Consulta manual, sessionStorage e reload devem recuperar exatamente esse job usando GET, sem novo POST. As três leituras GET observadoras adicionais usam x-r15-observer=1 e são contabilizadas separadamente dos GETs do app, incluindo cliques explícitos em Conferir assinatura antes/depois do reload. O DOM prova modal do lote1 e estado queued; a UI atual não renderiza IDs do job nem digest, cujo vínculo vem de POST/storage/GET/ACKDB. O JSON auxiliar é lido por fetch GET dentro da página; não depende de obter o corpo via CDP depois da navegação.

`A1_VALIDATION_ENABLED=1` e URL `http://127.0.0.1:1/never-called` existem somente para passar pela readiness sintática do contrato. A porta1 não tem servidor e NÃO está na allowlist de rede. Não se chama validador, worker, cron, PFX, signing, aprovação, envio, IA ou contato. A policy `credentialActive:true` é apenas metadata sintética, sem credencial real. Esta prova não homologa ICP-Brasil.

O snapshot, os bytes PDF e o histórico reais são fingerprintados antes/depois; o job inteiro também fica fingerprintado para detectar mutação na recuperação. Exige zero validações, mail, envios e artefatos próprios. Sem alterar código do app, sandbox, Secure/HttpOnly/Strict/CSP ou fonte f555.

Infraestrutura mínima herdada do R13v2: criação única90s, latch antes de mutações Docker e incerteza mantida até identidade+fence; timeout/sinal/erro implica falha e reconciliação manual, sem remover rede. Não promete causa de I/O resolvida. Nenhum gate/marker de falha R13 copiado para a primeira tentativa R15.

Portas locais exclusivas55495/31395; CPU2, RAM3GiB, Tasks256, deadline600s, unidade720s, cleanup120s e RemainAfterExit=yes. Runtime R6 reutilizado sob inventário integral antes/depois, nunca alegado mountRO. HOME/TMP/spool próprios. Cookie/ack/sessionStorage/config privada não são exportados. Exporta apenas recibos técnicos, PDF fictício e screenshot após admissão (sem OTP/certificado).

Pendências explícitas: perda de resposta após admissão; modo PDF próprio em R16 com contexto legítimo após R14; criptografia, credencial e validador reais; homologação de destino e rollback completo.
