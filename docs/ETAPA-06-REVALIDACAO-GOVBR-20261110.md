# Revalidação gov.br: falha posterior e respostas fora de ordem

## Problema comprovado

O teste HTTP de 10/11/2026 mostrou que uma resposta negativa nova do verificador não impedia selecionar uma evidência positiva anterior ainda dentro da janela de frescor. A reprodução falhou na asserção de bloqueio (5/6 passaram), preservada em:

`/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/base-http-1794287293214783281/result.json`.

## Correção

Duas tabelas aditivas, `petition_base_validation_attempts` e `petition_base_validation_results`, registram início e resultado sem permitir UPDATE/DELETE/TRUNCATE. A ordem monotônica dos inícios decide a tentativa atual, não a ordem das respostas de rede. Tentativa pendente, rejeitada ou indisponível bloqueia evidência positiva antiga. Resposta positiva atrasada fica no histórico, sem substituir a tentativa atual. Uma nova consulta explícita positiva restabelece a elegibilidade, desde que bytes, perfil, texto e configuração continuem válidos.

A reserva ocorre antes da consulta externa, com autorização Total/stepup e conferência do SHA. Não há transação aberta durante a chamada externa. A conclusão revalida autorização e contexto. Falha ou interrupção antes de registrar a conclusão deixa a tentativa pendente e bloqueada: não se presume sucesso. A API não repete automaticamente a verificação; cada chamada explícita reserva uma tentativa. A identidade idempotente de validação no navegador ainda não foi implementada. O diário não cria uma eleição, aprovação ou envio.

Seleção, preparo do pacote e autorização para nova tentativa de entrega consultam a mesma tentativa efetiva. O inventário não oferece como última evidência um positivo substituído por pendência/falha. Leitura histórica de PDFs e pacotes não depende desse bloqueio operacional. Evidências legadas sem diário continuam sujeitas às verificações de integridade, vínculo, política e frescor já existentes; depois da primeira tentativa registrada, não há retorno ao legado para contornar uma falha.

Não há mudança de texto, fonte, layout, certificado, participantes ou banco de produção. O bootstrap passa a somar 35 tabelas ao esquema legado desta linha. Isso demonstra preservação aditiva dos dados do ensaio, não garante que um aplicativo antigo entenda os novos pacotes durante rollback.

## Verificação do código staged sobre c351e1f

Cada resultado inclui manifesto SHA256 das fontes, `sourceStable:true` e `commitStable:true`. O HEAD ainda era c351e1f durante estes testes; os arquivos alterados estavam registrados no index. Os manifestos, e não o HEAD sozinho, identificam o código ensaiado.

| Verificação | Resultado | Evidência absoluta |
| --- | --- | --- |
| HTTP real com verificador simulado | 8/8 | `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/base-http-1794287488775837096/result.json` |
| Contratos, pacote, seleção e armazenamento | 37/37 | `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/packages-1794287522063853395/result.json` |
| Aprovação, entrega e recuperação | 27/27 | `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/package-delivery-1794287577388475296/result.json` |
| TypeScript | exit 0 | `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794287501598441751/result.json` |
| Migração aditiva e reaplicação | exit 0 | `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/schema-1794287570456657103/result.json` |
| Build | exit 0 | `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/build-1794287568385483845/result.json` |

Os oito casos HTTP cobrem permissões/input, fluxo explícito, revogação durante consulta, relatório negativo, recuperação histórica por ator, positivo seguido de negativo, positivo atrasado após negativo mais novo, e bloqueio de preparo/aprovação com preservação do histórico. Incluem imutabilidade e reaplicação DDL dos diários.

## Integração visual já demonstrada antes desta correção

O componente real compilado, no commit c351e1f, foi exercitado em seis larguras, com recarga após upload, respostas perdidas, seleção e pacote idempotentes e formulários nativos de código/aprovação. O transporte de desenvolvimento recebeu dois anexos com hashes exatos. Evidência: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/govbr-compiled-1794285320968324635/browser-result.json`. Esse ensaio é anterior ao diário desta correção; não apresentá-lo como repetido depois dela.

## Próximos pontos de aceite

- Repetir o fluxo compilado com o diário e promover o harness privado a uma ferramenta reproduzível do repositório.
- Tornar o pedido de código de aprovação idempotente por intenção e vinculado ao pacote revisado, sem invalidar códigos por repetição física de POST.
- Guardar rollback operacional para impedir que um sender antigo tente interpretar pacotes v2 ainda não encerrados.
- Homologar o verificador real gov.br e o fluxo A1; os verificadores e documentos desta QA são fictícios.
- Continuar o escopo integral do painel. Nenhum destes resultados significa conclusão global, publicação ou autorização para merge/deploy.
