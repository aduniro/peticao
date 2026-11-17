# Assinatura própria do presidente: incremento isolado

Em 10/11/2026, o responsável informou que ainda não disponibilizou o certificado e-CNPJ A1. A homologação real fica pendente; essa dependência não interrompe os demais módulos, QA e contrato da confirmação própria. Nenhum certificado real foi procurado, carregado ou utilizado nesta frente.

## Estado aferido

Funcionalidade Assinatura própria do site: 50%; módulo Presidente da ADUNIR:70%; seção Campanha:54,7%; árvore65,1%, pelo snapshot99f9fa7. São marcos estruturais, não horas. A funcionalidade já possuía desafios/recibos e testes de backend, mas seu botão ainda permanece desabilitado no candidato. A nova prévia não aumenta o percentual até haver integração efetivamente demonstrada.

## Prévia isolada, sem alterar o aplicativo

Pasta: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-native-preview-1794289772866310733`.

- PDF original fictício: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-native-preview-1794289772866310733/output/pdf/original-ficticio.pdf`.
- Proposta visual: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-native-preview-1794289772866310733/output/pdf/confirmacao-propria-previa.pdf`.
- Conferência: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-native-preview-1794289772866310733/render-validation.json`.

Gerador real do candidato com dois participantes fictícios, origem preview.example.test e rede desabilitada. Três páginas originais e uma página adicional de confirmação. PNGs renderizados e revisados nas quatro páginas; texto e pixels das três páginas originais são iguais aos do original. Os contadores das páginas originais referem-se ao documento-base preservado. A página adicional é uma proposta de apresentação do recibo, não uma assinatura já aplicada pela plataforma.

O proprietário recebeu pergunta de preferência entre página adicional e bloco no próprio ofício. Não interpretar silêncio como aprovação. A preferência ainda não foi respondida no momento deste registro. Não incorporar texto/apresentação ao PDF ativo antes da decisão aplicável.

## Contrato em protótipo

No mesmo diretório privado, `president-native-contract.ts` e `president-native-contract.test.ts` congelam uma representação canônica de recibo consumido: UUID do recibo/desafio, documento/hash exatos, lote, responsável, fingerprint da conta, nome e horário. Cinco casos puros passaram, incluindo adulteração de bytes/contexto, estados não consumidos, credenciais/CPF/nascimento indevidos, datas inválidas, caracteres de controle, getters e dados ocultos. Evidência: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-native-preview-1794289772866310733/contract-test-observed.json`.

Esse contrato serializa dados; não verifica identidade, autentica alguém ou prova confirmação durável sozinho. Seus resultados exigem adapter confiável do estado consumido. Não tratá-los como capacidade de assinatura, ICP, gov.br ou autorização de envio. Não foram integrados nem incluídos na cumulativa que está rodando sobre b69d7b3.

## Próxima implementação após a cumulativa congelada

1. Autenticar novamente Total/stepup e obter recibo consumido do PostgreSQL, responsável/perfil vigentes e documento exato. Nunca aceitar snapshot de prova fornecido pelo cliente.
2. Separar leitura histórica de autorização para nova geração; perfil alterado, emitente revogado, versão/hash divergentes e documento já aprovado impedem nova mutação.
3. Tornar a emissão de acesso do presidente identificável por intenção, impedindo que repetição física de POST revogue o primeiro acesso. Credenciais continuam emitidas uma única vez, sem armazenamento ou recuperação em texto claro.
4. Integrar o formato decidido, mantendo os PDFs anteriores e um recibo imutável. Não anexar página ou texto depois de uma assinatura ICP/gov.br já aplicada.
5. Para a opção combinada, preparar a confirmação antes de o A1 assinar os bytes finais; não presumir que o worker atual já escolhe automaticamente essa entrada. Tratar essa ligação como pendência explícita.
6. Integrar interface e testar perda de resposta, concorrência, autorização, correção de dados e seis larguras. A guarda de envio ICP existente não é removida pelo recibo próprio.

Essas etapas são continuidade da prioridade do admin-v2. Não há deploy, merge, envio real ou alteração do banco de produção.


## Captura durável integrada ao candidato (código staged sobre b69d7b3)

`capturePresidentOwnConfirmation` acrescentada ao store e contrato puro copiado para o candidato. O adapter carrega recibo consumido, confere ator Total/stepup, emitente, perfil/fingerprint e versão/hash exatos, recusa fonte que já possui versão assinada e audita a leitura. A evidência durável continua consultável depois de expirar o prazo de autenticação do desafio, desde que os vínculos ainda correspondam. Falha de auditoria não retorna bytes. Não há criação de assinatura/PDF, rota nova ou envio.

20/20 testes dirigidos (contrato, store e acesso externo) e tipos aprovados, com fontes e commit estáveis. Evidências: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794290812857658535/result.json` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794290812853000514/result.json`. Não somar esses20 aos903 da cumulativa: há casos antigos repetidos e fontes novas posteriores à baseline. O formato permanece em revisão e a interface específica continua inativa.
