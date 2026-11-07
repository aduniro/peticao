# Diagnóstico das tentativas de assinatura

Candidato separado do admin-v2, baseado no snapshot efetivo da VPS de 07/11/2026 (0483a20). Nenhuma publicação realizada nesta etapa.

## Escopo e limites

- Registra eventos técnicos de início, campo tocado (somente identificador), clique, resultado e saída/aba oculta. Não lê os valores dos campos; respeita DNT/GPC. Saída/aba oculta é indício de possível abandono, nunca prova de pessoa impedida.
- No envio real do formulário, registra etapa, resultado, código da conferência, cache e índice de diagnóstico. Nome, CPF completo, nascimento, mãe e retorno cadastral não são copiados para estes logs, nem reintroduzidos como hashes ocultos.
- E-mail de pedido efetivamente enviado só é guardado quando há consentimento no formulário e formato válido. Guarda cifrada, com contexto por registro, usando o segredo do cache já existente; não muda HASH_PEPPER, credenciais ou rotinas de validação. Sem chave válida, o contato não é guardado em texto como alternativa.
- Não captura e-mail de campo abandonado. Checkbox ou aviso novo não foram inseridos. Nenhum texto, estilo, classe ou aviso existente foi alterado. O componente novo retorna `null`, sem elemento visual.

## Armazenamento e consulta

`signup_diagnostics` é aditiva e independente das assinaturas. Eventos expiram em 30 dias; a consulta omite vencidos mesmo antes da limpeza. O cron existente remove vencidos sem alterar o ciclo de assinatura. Acesso pelo administrador já autenticado da versão publicada: `GET /api/admin/diagnosticos/assinaturas?limit=50`; `emails=1` inclui contatos submetidos disponíveis. A leitura é auditada, resposta sem cache; não fornece cifragem ou hash do e-mail ao navegador.

O índice `learning_index` agrupa política/versionamento, motivo, método e características estruturais da comparação. Não inclui o texto de nomes, e-mail ou dados de identidade; não treina modelo nem relaxa a validação automaticamente. A análise diferencia limites de palavras, ordem, quantidade insuficiente, palavras extras e divergência não classificada. É evidência técnica para revisão, não prova de erro da API ou da pessoa.

A gravação de diagnóstico não pode transformar sucesso em falha; indisponibilidade é registrada por código estático, sem mensagem livre ou dado pessoal no journal. Há limites de volume e sinais podem não chegar com navegador/rede indisponíveis: não prometer captura de todo abandono ou valor nunca enviado.

## Validação em andamento

Sete testes direcionados passaram em `targeted-fixed.log`, cobrindo rejeição de payload pessoal no endpoint técnico, ausência de valores sensíveis persistidos, contato cifrado, ausência de contato sem consentimento, duplicidade, falha de gravação, isolamento de requisições e expiração. Typecheck inicial passou. Ainda faltam regressão contra o snapshot de produção, cumulativos, build, HTTP compilado e comparação visual antes de publicar. Esta entrega não inclui o admin-v2 ou mudanças de regras de nome/CPF.


## Primeira comparação cumulativa — não liberada

Snapshot original: 157/173, candidato: 168/183. Houve 15 falhas compartilhadas idênticas, sem nova falha compartilhada; a falha extra do snapshot é o helper de teste `tools/preview/egress-bridge.mjs` que fica fora da árvore publicada. Faltam recursos de geolocalização excluídos propositalmente da cópia e a configuração global MAIL_PROVIDERS=dev interferiu em testes de transporte simulado. Também existem expectativas anteriores às regras atuais de nome/CPF e à desativação de estrangeiros. Corrigir o ambiente/fixtures antes de repetir, sem relaxar a aplicação para acomodá-las. Logs preservados: baseline-cumulative.log e candidate-cumulative.log. Typecheck atual passou. Sete testes novos passaram; isso ainda não é validação cumulativa aprovada. Nenhum deploy.

Pendências de cobertura: eventos de campos com erro gerados pela validação React (não apenas invalid nativo, pois o formulário usa noValidate), códigos específicos de falha do provedor, limites/JSON inválido antes de handleSign, resumo/paginação da consulta administrativa, testes HTTP e comparação visual com temporário curto do Chromium. O erro anterior de Chromium no admin-v2 foi caminho Unix demasiado longo; usar TMPDIR=/mnt/dev/.qa-tmp no harness e Node24 já instalado, sem mudar o runtime da VPS.
