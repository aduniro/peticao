# Pacote documental imutável — armazenamento inicial

Código em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batch-package-store.ts`. Gate BATCH_PACKAGE_ENABLED desativado por padrão; nenhuma ativação ou alteração na VPS. Este incremento prepara/readiciona o pacote; não aprova lote, não coloca mensagem em fila e não envia.

## Contrato

Cada versão registra lote/documentVersion, seleção e recibo efetivo da base gov.br, histórico do PDF assinado, UUID/hash/comprimento dos dois arquivos, manifesto canônico/digest, ator/intenção e limite MIME de preparo. São dois anexos separados, sem concatenar/reimprimir ou alterar PDF assinado. O pacote declara approvalRequired:true e dispatchAllowed:false até a integração futura da aprovação/transporte.

Ação explícita e CAS expectedPackageRevision; novas versões somente antes da aprovação ou início de entrega. Replay retorna a versão original e nunca a torna atual por efeito colateral. FK composta impede cruzar arquivos/recibos e predecessores de outro lote/documento; histórico é append-only. A nova tabela batch_packages eleva o ensaio aditivo a 33 tabelas.

Congelamento exige Total/sessão/stepup atuais, documento corrente assinado com classificação ICP já aceita pelo fluxo vigente, histórico binário correspondente, seleção atual e evidência gov.br fresca no mesmo perfil/texto/verificador. Esta rotina confia na validação anterior; ela não é um validador criptográfico independente. Evidência expirada exige nova verificação da base, sem reescrever o arquivo.

Leitura histórica reconstrói os dois artefatos exatos do manifesto e verifica seus hashes/digest; não busca a base atualmente selecionada. A leitura continua protegida quando os gates operacionais estiverem desligados e não autoriza envio.

O orçamento inicial de preparo vem de BATCH_PACKAGE_MAX_ENCODED_BYTES (padrão18MiB, máximo100MiB), com reserva de256KiB para envelope. É um preflight interno, não garantia de limite de todos os provedores. A integração de envio deverá conferir o orçamento real do transporte antes de admitir mensagem, mantendo ambos os anexos.

## Validação preliminar

Rascunho: nove testes PostgreSQL e tipos aprovados: replay concorrente, arquivos exatos/cópias independentes, base efetivamente trocada com pacote anterior preservado, CAS, permissões/stepup, documento/seleção, aprovação/tentativa anterior, ausência de histórico, rollback de auditoria, DDL/imutabilidade, leitura com gate desligado, manifesto corrompido, tamanho e evidência vencida. Dados/bytes/classificação de assinatura são fixtures de protocolo; não é homologação ICP/gov.br real. Repetir no candidato integrado com schema33 antes de declarar esse incremento validado.

```bash
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/admin-qa/final-local.py packages
```

## Próximas etapas

Ligar a autorização de aprovação ao digest do pacote, a identidade de mensagem v2 e os recibos/recuperação ao envelope exato. Gate desligado preserva o caminho legado; um pacote v2 aprovado não poderá cair silenciosamente para um envio sem base. Endpoints, UI gov.br, aprovação e fila v2 ainda pendentes. A assinatura própria do presidente e homologação operacional permanecem em etapas separadas. Nenhum envio ocorreu neste incremento.
