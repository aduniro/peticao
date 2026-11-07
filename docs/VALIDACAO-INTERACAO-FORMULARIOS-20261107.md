# Validação dos ajustes de interação — 07/11/2026

## Base e escopo

Ramo isolado `form-interaction-20261107`, baseado no código de produção com os logs já publicados (`4fed6dc`), com snapshot fresco em `.cache/form-interaction-20261107/production-before`. A comparação confirmou igualdade de todo runtime; sete fixtures de testes no ramo têm as atualizações usadas na validação anterior de diagnósticos. Essas fixtures não entram no pacote publicado.

Patch limitado a cinco arquivos: `SignForm.tsx`, `WhatsappConfirm.tsx`, `pt.ts`, `cpf-feedback.ts` e `supporter-email-suggestion.ts`. Rotas, regras de nome/CPF, resolvedor, cache, banco, privacidade, CSS, fontes, assets e módulo de diagnóstico preservados. Guia central: `POLITICA-INTERACAO-FORMULARIOS.md`.

## Evidências anteriores à publicação

- Dois testes direcionados passaram. Suíte completa: **186/186**, sem falhas, cancelamentos ou skips. PostgreSQL isolado na porta 54351, dados fictícios, ambiente limpo sem credenciais.
- Build e verificação de tipos passaram.
- Dez cenários de navegador aprovados sobre build compilado na porta 3051: CPF ao sair/voltar/digitar onze dígitos; servidor e apoiador; nome divergente marcado, foco remove marcação e nova recusa recoloca; valores preservados após erro; modal único; limpeza de valores/consentimento/avisos entre categorias; mesma categoria preserva valores; resposta de e-mail atrasada com mesmo endereço não contamina outra categoria; erro de submissão atrasado não reabre modal após troca; textos institucionais; ranking Gmail/Outlook/GMX; múltiplos erros.
- O cenário com rota real `/api/assinar` recebeu 422 de validação estrutural, refletiu os erros na interface e manteve os campos. Endpoint técnico recebeu 204; consulta administrativa sem sessão recebeu 401. Banco local isolado na porta 54354. Comparações nome/CPF em navegador usam resposta simulada; a suíte cumulativa testa os fluxos e provedores simulados no backend, sem consulta CPF real.
- Comparação dos três formulários em 360, 390, 768, 1024, 1440 e 1920: estilos computados, fontes, tamanhos, cores, bordas, padding e dimensões dos campos idênticos à baseline. Screenshots de 390/1440 preservados; servidor 390 inspecionado visualmente. Não se exige igualdade pixel a pixel dos parágrafos cujo texto foi explicitamente alterado.
- Uma primeira execução de navegador encontrou clique de checkbox afetado pelo deslocamento do formulário quando CPF perde foco. O harness passou a aguardar o blur antes do clique; não houve alteração de layout ou código adicional para esse caso.

Evidências: `.cache/form-interaction-20261107/{targeted.log,cumulative.log,build.log,types.log,browser-integrated.log,visual.log}`, `visual/{browser-result.json,style-result.json}` e capturas. Harnesses locais em `tools/form-interaction/` usam caminhos explícitos de QA; não são enviados ao runtime.

## Publicação

Pendente de registro após manifesto, backup, compilação remota, health interno/externo e verificação da interação publicada. Nenhum resultado de produção é presumido a partir dos testes locais.
