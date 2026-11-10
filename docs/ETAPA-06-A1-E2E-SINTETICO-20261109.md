# A1: ensaio técnico ponta a ponta com credencial sintética

Execução inicial validada no commit 253974085c739269aae99f69313b86b03df8df61, sem mudança do commit durante o ensaio. Não é homologação ICP-Brasil, nem prova de instalação/isolamento do serviço na VPS.

## Caminho realmente executado

1. Aplicativo em Node20 pinado, configurações fictícias, PostgreSQL descartável 54377, sem arquivos de ambiente reais. Criação real do PDF de lote com dados fictícios e preparação A1 auditada.
2. POST administrativo autenticado/Total/stepup admite job durável. Replay antes da execução retorna o mesmo job.
3. Cron separado e autenticado aciona executor, cliente Node, socket Unix real, broker real e worker real. Certificado PKCS12/raiz/LCR são gerados somente para QA.
4. Worker assina PDF incrementalmente, incluindo atributo de política e hash interno pinados; o adapter de teste confere de fato integridade, assinatura, cobertura, certificado sintético e declaração. A confiança/revogação ICP do contrato é deliberadamente simulada: raiz de QA não é ICP. Não usar o resultado como validação jurídica ou técnica de um certificado real.
5. Finish publica bytes/versão/relatório/job atomicamente. GET observa o resultado persistido; replay não repete assinatura. Nenhum lote aprovado, envio, email ou decisão local de CPF.
6. Segundo lote com política divergente na resposta do adapter é recusado: job failed, sem signed_pdf/aprovação/envio. Repetir cron não reexecuta o job falho.

Resultado inicial: duas requisições ao adapter, duas verificações criptográficas sintéticas, uma versão assinada no caso positivo, zero emails/approvações. Evidências privadas: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-e2e/result.json` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-e2e/scenario-result.json`.

## Proteções e falha inicial preservada

O broker recusou inicialmente os ancestrais graváveis pelo grupo do checkout/venv de desenvolvimento. As checagens não foram relaxadas, nem foram alteradas permissões do projeto. QA usa cópias de código com hashes conferidos em diretório0700 e venv protegido exclusivo sob `/home/barre/.cache/peticao-a1-worker-qa/e2e-venv`. PFX e senha ficam somente no diretório temporário protegido e são removidos no fim.

O ensaio não comprova separação de usuários do sistema operacional: isso pertence ao provisionamento futuro. Nenhuma unidade systemd foi instalada, nenhuma porta pública foi aberta e nenhum certificado real foi usado. O relatório tem `syntheticOnly`, `notIcpHomologation` e `validatorTrustSimulated`.

## Repetição controlada

Ferramentas versionadas: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/a1-e2e.py` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/a1-e2e-scenario.ts`. Cada rodada cria pasta de evidências própria, confere snapshot limpo, mantém manifesto de hashes, limita tempo, desliga apenas seus processos e exige banco descartável na porta54377. Não executar contra banco/configuração real.

Comando local, a partir de `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109`:

```bash
/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-worker-venv/bin/python /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/a1-e2e.py
```

O harness versionado recebeu ajustes de isolamento e preservação de evidências após a rodada inicial; repetir para validá-lo no commit próprio.
