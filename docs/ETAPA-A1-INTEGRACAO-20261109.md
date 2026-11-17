# Integração A1 — checkpoint local verificável

Candidato /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109, branch admin-v2-final-20261109. Página pública foi publicada separadamente no b9e8ae2; nenhum admin-v2, assinador, certificado ou agendador novo foi instalado na VPS.

## Encadeamento implementado
POST /api/admin/lotes/[id]/a1 admite intenção explícita, sem usar chave ou enviar. GET projeta disponibilidade e o último job, incluindo requestId para reconciliar resposta perdida. Ambos exigem Total, sessão vigente e confirmação extra; corpos e chaves limitados.

Agendador PRÓPRIO POST /api/cron/a1 exige segredo e corpo vazio. Somente escolhe jobqueued já admitido; não aceita job/bytes/certificado do caller. Foi separado da fila de e-mails existente para não atrasá-la durante assinatura/validação. Gate duplo do job mais validação externa configurada são obrigatórios antes da chave. Não instalar/ativar timer automaticamente.

Worker em conta separada, socket Unix protegido, PKCS#12 e senha fora da web. Protocolo limita arquivo, tempo, memória e relatório e vincula hash/versão/credencial. Assinatura incremental com pyHanko é operação criptográfica real nos testes sintéticos; relatório técnico não classifica ICP.

Verificador v2 externo independente exige hash exato, titular, fingerprint, integridade, cadeiaICP, cobertura, modificações permitidas, revogação e par perfil/OID explicitamente aceito. Sem valores normativos inventados. Prova runtime Symbol+WeakMap não pode vir de JSON/HTTP e expira com política/tempo/bytes divergentes.

Finish revalida ator/sessão/stepup, política/credencial, lease/CAS e revisão do documento; grava PDF, histórico imutável com fonte a1-worker, relatório, estado e auditoria juntos. Limpa código de aprovação anterior. Assinar não aprova nem envia. Falha/resultado perdido não repete automaticamente; GET permite conferir estado persistido.

## Provas observadas
-8testes PostgreSQL jobs/finish passaram novamente pelo root: concorrência, replay único, auditoria/rollback, revogação, política/documento/lease e bytes.
-22testes contratos/transporte/validação/modelo de interface passaram novamente pelo root.
-6testes de orquestração e1teste do handler real com banco fictício passaram. A ampliação do teste do cron dedicado será reexecutada antes de fechar.
-Tipos estritos globais passaram; build integrado Node20.19.2 passou antes da separação do cron (rebuild final pendente).
-Ensaio de migração preservou dados originais e revelou expectativas antigas sobre as colunas institucionais; fixtures/allowlist foram atualizadas explicitamente, sem relaxar o esquema. Rodadas iniciais falhas estão preservadas; nova rodada ainda necessária.

Evidências privadas /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/ . Não contêm certificados reais. Nenhuma chamada real de validador, envio ou homologação ICP foi realizada.

## Pendências e decisões
Textos novos A1 foram submetidos e aguardam resposta; nenhum componente visível novo foi conectado. O aviso de titular rejeitado anteriormente não foi introduzido. Certificado real, raízes/CRLs, perfil/OID homologados, provisionamento protegido e autorização de ativação continuam dependências operacionais separadas. Nenhum deles é substituído por um mock.

Revisar o rodapé do original gerado em modo none antes do fluxo real: não modificar bytes após a assinatura; mudança de aviso/apresentação depende aprovação específica. QR interno por referência reservada, anexo-base gov.br imutável e confirmação visual combinada pertencem à próxima etapa e permanecem pendentes. O painel integral não está concluído por este checkpoint.

## Conferência do root após interrupção dos agentes
Os três agentes foram interrompidos por falta de créditos; arquivos foram preservados e root assumiu sem alegar execução deles. Em nova verificação:22contratos/modelo/transporte/validação,8SQLjobs/finish,6orquestração,8Pythonworker e6Pythonserviço passaram. Tipos globais passaram com fontes estáveis. Handler administrativo passou; novo teste do cron dedicado integra a cumulativa seguinte.

Ensaio de migração do candidato passou com26tabelas aditivas e3campos institucionais novos listados explicitamente. Comparação usa TODOS os campos originais e verifica defaults novos; TRUNCATE simples é bloqueado pela FK e TRUNCATE CASCADE continua bloqueado pela imutabilidade. Falhas anteriores do teste sobre campos novos/FK estão preservadas. Log aprovado /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/schema-1794267114016157309/validation.log .

Runner reproduzível /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/final-local.py usa Node20.19.2 comSHAfixo, ambiente vazio, configuração fictícia, DB exclusivo54375, temporários curtos/privados noSSD para socketsUnix e manifesto das fontes antes/depois. Não carrega .env de produção e recusa arquivos novos não rastreados. Próximas provas: full e rebuild do cron dedicado; não constituem conclusão integral do painel.
