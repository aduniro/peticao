# Compatibilidade estática das fontes públicas com a produção

Captura somente leitura iniciada em `2026-11-09T01:50:31.659294+00:00` e encerrada em `2026-11-09T01:50:31.892692+00:00`.
Candidato local: `400a1958771a10e658173aecd8e6239f4a49d2cc`, worktree `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-triage-qa-20261109`.

O alias SSH `peticao` respondeu0. O comando remoto verificou a existência do caminho conhecido em `/opt/peticao/app` e executou somente `sha256sum` sobre28 fontes públicas previamente enumeradas. Não foram copiados conteúdos, consultados banco/ambiente/credenciais, executados serviços nem gravados arquivos na VPS.

**Resultado:28/28 hashes iguais; zero diferenças e zero arquivos indisponíveis.**

| Arquivo | SHA-256 local = produção |
| --- | --- |
| `site/src/components/SignForm.tsx` | `50c16c8a41c880bbf8eb2c5deb4d115160bf192b93ae55c95c502b9f8b15086d` |
| `site/src/components/FormDiagnostics.tsx` | `8a0960d5f14149f1b9503e31e4d8435d6589e3035b960962da67cd7a2938b033` |
| `site/src/app/api/assinar/route.ts` | `67983a2fbc937b7a3216bc27e592d5b4e71485795a2e84a8bde39fb36dc7c7dc` |
| `site/src/app/api/confirmar/route.ts` | `ed7330c0660bfb3a725548c4721c84f32bb7285ba09efcd7b2581492845077b9` |
| `site/src/app/api/confirmar/whatsapp/route.ts` | `08fac4c912e0411ff1b8d186269115029d2b22a8276c0cb9a3ddae23539d200d` |
| `site/src/app/confirmar/page.tsx` | `21dc7f314e45e9eb6fc1d8a674bb75d28a59291a32c0dba1a84b3b6b517083c4` |
| `site/src/app/confirmar/whatsapp/page.tsx` | `d19d489d7d10e97d7c3365b3933f649603801d2ca6b6d819d748742d4fa97a36` |
| `site/src/lib/cpf.ts` | `b87145040b9631f0bd7a824f51521487d5ca400db9aefb06889cab50fcaf756d` |
| `site/src/lib/cpf-name.ts` | `0e8f17dc97fa9a9f318c201ce911a0119a4fbe626769b429776d96281f3ed31f` |
| `site/src/lib/cpf-check.ts` | `163d572146a8aac54517768297c4807f2a08d27fed98e5b3afe1f91a00aad1ca` |
| `site/src/lib/cpf-cache.ts` | `c63a42c47af7ac4997d5a6e6a42a1cae420e024a10df8d7235475353e975704d` |
| `site/src/lib/cpf-cache-crypto.ts` | `daed14d93e34f6b732c7345bc9b518c9613a2194e1b12f35a6e74bea3b046416` |
| `site/src/lib/cpf-feedback.ts` | `3dea90e15fd68dcfa3bd4bb2c98c338cac458ec33774bb4b43f59cac1b39e9f4` |
| `site/src/lib/cpf-mask.ts` | `f8ed844dbf385f752f7886e50f8a400ab2b8172f52b0b2cf2b9b6a089e750f97` |
| `site/src/lib/name-case.ts` | `eaa3eb562baef5a731c87b102ab0a8a6204fed884f4a1bd56b7586fc5acaba4f` |
| `site/src/lib/form-validation-notice.ts` | `8fd1bfd2b61afe53daf27b62e9c67e1bd05319e1ca0f52f03a9efd46cdbfb246` |
| `site/src/lib/signup-diagnostics.ts` | `fd2affc7d013227bc7a0a3a78ddfbbb1c56dcc0465c3eb33c2cd3a0756c874b0` |
| `site/src/lib/email-validate.ts` | `dd9463ad942873122b4987a09e6c91948a71b037aaf5bd991577440af89bbb55` |
| `site/src/lib/email-check.ts` | `f68a4bb7475ef614fa0ece2641c4a8a7769a3ff58af64b1bae2310ee03d7d47e` |
| `site/src/lib/email-feedback.ts` | `73d1dd382eca8b10e7ed4c306bd0e3ae1ea8465afcc27ab54bf70d5df6287074` |
| `site/src/lib/email-sugestao.ts` | `c59d23ad7589b8cf5a4bf658ab9d90e1d28288d4e54b71fc1fbd4466a81cbb60` |
| `site/src/lib/supporter-email-suggestion.ts` | `ca3bec6f34eddb4bda688fe7db620a7234a3bb369d610047c76b12220ba7308e` |
| `site/src/lib/email-typos.ts` | `921ff1d245aacd8d3f3a8018be571bf974a1746a969ff5b20a9ad3d88549638d` |
| `site/src/lib/ifes-domains.json` | `533929bd32a865e7177dd8af17c08c457c292601b7c6f09c3d6724dd2358134f` |
| `site/src/lib/freemail.json` | `86f685c70c578b988f3a9d281923677eaa7ebbb4bbab235dea994a3636511b46` |
| `site/src/app/globals.css` | `3d1c71e27f1387343f764d8f3ef3992b61f9edbf6897712cce2e76e48ce13278` |
| `site/src/app/page.tsx` | `c00ca70ae83b747ce67be0f600537fb70b5b11c5c1bfdb3af6d59d8cf48bb329` |
| `site/src/app/layout.tsx` | `047e7bf10e16ff06cfeec1e32fbc46ac86173f9037dd8ee1f01581e22b78a6fb` |

Esta evidência demonstra igualdade byte a byte somente dos arquivos enumerados nesse horário. Não demonstra igualdade de banco, variáveis, dependências, build, dados de instituições ou comportamento de serviços externos. O trabalho AV14 e suas ferramentas fica na área administrativa/QA, sem modificar as fontes públicas verificadas. Os incrementos de domínios/campus/desafio de presidente que o integrador ainda reúne precisam ser confrontados com este manifesto quando o hash consolidado for conhecido; não assumir que o snapshot anterior certifica o novo.

Evidências privadas originais: `.cache/public-compatibility/report.json`, `ssh-sha256.stdout` e `ssh-sha256.stderr` (vazio). Nenhuma fonte da VPS foi incorporada ao candidato.
