# Controle A1 no candidato administrativo

Textos aprovados expressamente pelo responsável em 09/11/2026. Controle em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/components/admin/A1Assinatura.tsx`, usado nas páginas de Lotes e Presidente. Classes existentes do painel; nenhum CSS, fonte ou formulário público alterado.

O controle consulta disponibilidade somente quando aberto. Solicitar assinatura exige clique explícito e gera uma intenção com UUID, lote, versão documental e revisão da política. A tela não recebe certificado ou senha. Acompanhamento automático usa somente GET, com intervalo de três segundos e orçamento de doze leituras por abertura/solicitação; fechar interrompe esse acompanhamento. O botão Conferir continua disponível para consulta manual.

Sucesso só aparece com versão e SHA256 publicados. O callback solicita atualização do conteúdo administrativo quando o hash publicado difere do renderizado, sem aprovar ou enviar lote. O download usa a rota autenticada de versão exata. Cada lote possui instância de estado distinta. Resposta perdida não cria nova intenção, nem retry de aplicação; consultar 404 também não libera nova assinatura.

## Evidências anteriores à integração visível

- Candidato 9d88a8b: 839 testes, 838 aprovados, zero falhas, um WIP IA pulado; código e commit estáveis. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/full-1794273670073785468/result.json`. Esse resultado não abrange o novo componente até a rodada seguinte.
- Rascunho visual: 14 cenários, incluindo seis larguras, duplo clique, POST tardio, fechar/reabrir, consultas automáticas sem POST e interrupção ao fechar. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-reconciliation-draft/browser-result.json`.
- Navegador + handlers reais + PostgreSQL + broker Unix + worker criptográfico + download exato, ainda no rascunho: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-e2e-ui-1794274294971564873/result.json`. Certificado/cadeia de QA sintéticos, confiança/revogação simuladas no contrato: não é homologação ICP-Brasil. Política divergente bloqueada; nenhuma aprovação ou mensagem a destinatários.

## Descoberta sobre repetição HTTP

Ao encerrar a conexão após admitir o pedido, o ensaio real observou cinco POSTs físicos para duas intenções, sempre com o mesmo UUID/binding dentro de cada intenção. O banco guardou somente dois jobs, e o caso positivo teve somente uma versão assinada. Assim, o aceite correto verifica identidade da intenção, quantidade de jobs e artefatos; não presume que uma única chamada fetch sempre equivale a um único POST físico. As expectativas anteriores de contagem de HTTP e disponibilidade depois da admissão falharam e foram preservadas nos diretórios de evidência.

## Ensaio reutilizável

Executável absoluto, de qualquer diretório local:

```bash
/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-worker-venv/bin/python /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/a1-e2e.py --browser
```

O modo navegador usa o componente atual, handlers reais e PostgreSQL próprio na porta 54377. O banco e as credenciais sintéticas temporários usam diretório 0700 em `/run/user/1000/peticao-a1-qa`, apagado ao terminar; evidências ficam no projeto. O modo API anterior permanece disponível sem a flag. Não se alteram fsync, serviços, gates ou bancos de produção. O ensaio é um host React isolado com APIs reais, não o shell Next inteiro nem homologação operacional.

## Pendências

Executar tipos, build e o modo navegador após este commit; registrar a evidência do componente já integrado. Permanecem separados: homologação real, provisionamento operacional do certificado/validador, base gov.br validada, pacote final e demais módulos. Não há deploy ou instalação/ativação de serviço neste incremento.
