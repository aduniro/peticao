# A1: declaração técnica da política AD-RB, ainda não homologada

Novo perfil técnico opcional `pades-ad-rb-declared-unhomologated-v1`; o perfil genérico anterior continua compatível. Nenhum gate, configuração runtime, certificado real ou serviço foi alterado.

## Contrato e limites

O novo perfil exige `policyPath` na configuração protegida do worker. O arquivo é lido por descritor protegido, antes do PFX/senha. São conferidos hash do arquivo pinado, DER, OID 2.16.76.1.7.1.11.1.3, algoritmo SHA256, integridade interna e janela temporal declarada na política. O atributo CMS usa o hash interno — SHA256 da concatenação DER dos dois primeiros elementos — e não o hash do arquivo inteiro nem um novo envelope SEQUENCE. O worker também confere o atributo que realmente saiu no CMS antes de retornar.

`icpBrasilQualified` e `homologated` continuam false. A cadeia/LCR, titular, integridade e cobertura continuam obrigatórios; nenhuma dependência de rede foi adicionada ao assinador. O validador independente mantém gates e pares perfil/OID e não aceita como perfil homologado nenhum dos dois nomes de perfil do produtor. Para o novo perfil, o OID retornado precisa corresponder à declaração AD-RB.

## Origem do artefato e verificação pendente

Fixture pública de política obtida de um espelho do projeto de referência, por blob Git pinado e SHA256 registrado. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/fixtures/ad-rb-v1.3.provenance.json` declara `officialAuthenticityVerified: false`. A tentativa HTTPS direta do repositório de políticas falhou por cadeia TLS não reconhecida; TLS não foi desabilitado. Não usar o espelho como prova de autenticidade oficial, LPA vigente, conformidade completa ou homologação de assinatura.

Fontes: [documento do ITI](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais/v9.1_IN2021_03_DOCICP15.03_compilada.pdf), [descrição do projeto de referência](https://lsnepomuceno.github.io/signet-pdf/guide/icp-brasil), [fixture pinada](https://api.github.com/repos/lsnepomuceno/signet-pdf/git/blobs/ef845b0cbe87bad3f6b6ef71dead7cd50c67a51c). Nenhum código remoto foi executado e nenhuma dependência nova foi instalada.

## Provas do rascunho e próximos testes

7 testes de parser/atributo, 11 testes Python de assinatura sintética/guardas, 12 testes Node de contrato/verificador e 10 testes SQL de jobs aprovados. Houve uma rodada SQL que falhou por import dinâmico do harness; o log foi preservado e a rodada corrigida passou. A resposta real do worker com certificado sintético foi aceita pelo contrato Node, mantendo qualificação/homologação false. Tipos do rascunho passaram.

Evidências privadas locais: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-policy-research/`. A integração no candidato exige repetir contratos/jobs/worker/broker/tipos/build; as provas do rascunho não substituem esse aceite. Homologação real e publicação continuam separadas, com autorização própria.
