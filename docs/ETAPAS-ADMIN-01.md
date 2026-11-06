# Etapas 0 e 1 — execução autorizada

Autorização autenticada recebida pela Ponte em 06/11/2026 às 20:57 UTC: executar Etapas 0 e 1. Identidade do remetente e DKIM conferidos. Não autoriza deploy.

Checkpoint de origem: f6bf4b6; tag admin-integration-approved-20261106.
Candidato isolado: /mnt/dev/peticao/.cache/admin-integration/candidate-stage01, ramo admin-v2-stage01.
Base: snapshot sanitizado da produção real atualizado em 06/11/2026, preservando correções posteriores de CPF/cache/formulário.

Estado: checkpoint da Etapa 0 concluído (e0f54e2); primeiro porte administrativo isolado commitado (da9fee6). Etapa 1 em andamento, não concluída e não publicada.

Primeira rodada: 50/51 testes administrativos aprovados; a falha restante dependia da base GeoIP ausente no checkout novo. A base local foi vinculada para a repetição, sem alterar a política de geolocalização. Ainda faltam os testes e correções de concorrência, publicação vinculada ao candidato e a validação cumulativa/visual previstos no plano.

Correções iniciais: coluna ts na saúde de e-mails, uptime do processo e captura de falhas de rede nos três componentes administrativos, mantendo rascunhos.

