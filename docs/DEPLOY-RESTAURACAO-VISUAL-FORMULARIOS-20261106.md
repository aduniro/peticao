# Restauração visual dos formulários — 6 de novembro de 2026

## Escopo solicitado

Restaurar a apresentação original dos formulários de Servidor, Apoiador e Estrangeiro, preservando as janelas modais de erro e as bordas vermelhas autorizadas. Manter os dados digitados ao ocorrer erro, as regras atuais de nome/CPF e os controles existentes de sugestões de e-mail. Não publicar o painel admin junto com esta correção.

Referência visual: commit `9784afe`, executado em ambiente isolado na porta 3020, com PostgreSQL próprio. A correção restaura as classes, estrutura, pesos, tamanhos e cores das dicas de e-mail e o rótulo original “Nome completo”. As modais continuam restritas ao envio; sair do campo mantém os avisos no próprio formulário. As sugestões continuam condicionadas à categoria para não recomendar provedor pessoal no formulário de Servidor.

## Versão e publicação

- Código: `d59981e` (`Restore original field typography and email guidance layout`).
- Pacote: somente `src/components/SignForm.tsx` e `src/i18n/pt.ts`, gerado a partir da versão efetivamente publicada, sem o código local não publicado de captura de rascunhos ou administração.
- SHA-256 do pacote: `6115f9c7691235982fbc4e11604160780dde8de0a6e291146b19b64ed86b9e55`.
- Evidências locais: `/mnt/dev/peticao/.cache/deploy-original-fields/`.
- Execução e backup na VPS: `/root/peticao-recovery/name-rule-deploys/restore-original-fields-20261106/`.
- Deploy concluído em `2026-11-06T22:19:37.568663+00:00`.

O publicador conferiu os hashes anteriores, a igualdade do stage com a produção e o backup de código e PostgreSQL antes da alteração. Depois conferiu que somente os dois arquivos previstos mudaram. Estrutura do banco e configuração permaneceram iguais; não houve atualização em massa de assinantes. O ambiente foi compilado antes da troca.

## Validação

Antes da publicação: checagem TypeScript, build de produção e 21 testes de regressão aprovados. Dez comparações locais entre referência e candidato verificaram texto e estilos calculados — fontes, tamanhos, pesos, cores, margens, preenchimentos e dimensões — em 390 e 1280 pixels, incluindo os três formulários e sugestões de e-mail. A diferença de borda inválida é autorizada; não se afirma igualdade pixel a pixel de todas as capturas.

Depois da publicação: serviço `peticao` ativo; página inicial, contador, privacidade e confirmação retornam 200. A rota WhatsApp desativada continua retornando 404. O 403 da consulta originada na própria VPS é do caminho por Cloudflare; a verificação externa desta máquina confirmou 200 na página e no contador.

O teste de navegador no domínio público verificou orientação e correção de e-mails por categoria, ausência de modais ao sair do campo, CPF incompleto com borda vermelha, modal após Assinar, troca para Servidor preservando nome/e-mail/consentimento e ausência de erros JavaScript não tratados na rodada final. Nenhuma assinatura real nem consulta paga de CPF foi enviada por esses testes; os endpoints de validação/envio foram simulados no navegador.

A repetição das dez comparações contra o domínio público também passou, nos dois tamanhos e em todos os cenários. O campo oculto inserido pelo Turnstile de produção foi excluído da comparação de elementos visuais, pois não existe no ambiente local sem chave de produção. As capturas e métricas finais estão em `/mnt/dev/peticao/.cache/deploy-original-fields/public-validation/`.
