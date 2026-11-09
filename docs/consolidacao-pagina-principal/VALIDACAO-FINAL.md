# Validação final da página principal — 09/11/2026

A consolidação mantém a base de execução da VPS e reúne as atualizações locais dos formulários, com logs preservados. A correção exige instituição autorizada e valor canônico no cliente e no backend, bloqueia texto livre antes de consultas remotas e limpa o aviso após selecionar uma opção válida. O catálogo autorizado é o mesmo nas duas camadas, preserva as122IFES e acrescenta EBSERH.

Resultados:208testesbackend aprovados;35cenáriosnavegador aprovados;build e typecheck aprovados;9comparaçõesRGB e de propriedades computadas idênticas (três categorias ×390/768/1440). Os345textospt foram preservados. Nenhuma classeCSS/folha deestilo foi alterada. Testes usam Node20.19.2, igual àVPS, PostgreSQL fictício, antirrobô/CPF/DNS simulados e rede Docker interna. Isso não prova entregaSMTP real, disponibilidade dos provedores ou autorização de deploy. A guarda de envio.gov.br noQA continua bloqueando mensagens reais.

A primeira suíte registrou207/208: o teste legado exigia aceitar InstitutoInventado sem caixa regional. O caso foi preservado e atualizado para exigir rejeição; a repetição completa passou208/208. A última mudança foi somente no cliente para limpar o erro antigo; os694outrosarquivos permaneceram idênticos e o backend foi vinculado porchecksums. Essa mudança também recebeu novo build, typecheck,35casosnavegador e9comparações visuais. Os logs anteriores permanecem fora doGit, sem apagar a evidência da falha.

As112propostas de saneamento do banco foram enviadas ao responsável em relatórioHTML separado. Nenhuma foi aplicada;IDs,confirmações,originais,camposassinados,lotes ePDFs foram preservados. A promoção do ramo main é local; nenhum push, mergeVPS ou deploy foi realizado.

As evidências completas e caminhos absolutos estão em /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109-qa. A prévia corrigida é http://127.0.0.1:3062/ e contém dados fictícios. O workspace VSCodium é /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/peticao-principal.code-workspace.
