# Worker A1 isolado — integração ainda não ativada

Código no candidato `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/`.

Implementa assinatura CMS/PAdES incremental real em memória com pyHanko0.31.0 e valida o resultado exato. Não é homologação ICP-Brasil e não retorna `kind=icp-brasil`. Não instala serviço, abre porta ou envia documento. O root conecta posteriormente ao job durável, autorização Total+stepup, CAS, histórico e aprovação separados.

## Protocolo

`worker.py` lê **um JSON limitado** em stdin e retorna um JSON em stdout. Exit0 somente quando assinatura e verificações técnicas são positivas; indisponibilidade retorna `{version:1,ok:false,error:codigo_sanitizado}` com exit1, sem traceback, senha ou caminho. O executor deve limitar stdout/stderr, matar processo após timeout e nunca registrar PDF/base64 ou request completo. Não executar por shell interpolado.

Pedido: `version:1`, `jobId`UUID, `documentVersion`SHA256, `inputArtifactVersionId`UUID, `inputSha256`SHA256, `credentialVersionId`UUID, `profileVersion:"pades-basic-unhomologated-v1"`, `trustStoreVersion`SHA256, `expectedCnpj:"15883671000115"`, `certificateFingerprintSha256`SHA256 e `pdfBase64`. Os valores de perfil/confiança são comparados à configuração protegida; o fingerprint ao certificado efetivamente carregado. Campos extras (inclusive paths de certificado/senha) são recusados. PDF máximo25MiB, hash exato obrigatório. PDF criptografado ou já assinado é recusado nesta primeira versão: a composição com assinatura própria deve ocorrer **antes** de A1, e coassinatura criptográfica requer fase própria.

Saída: binding original, `outputSha256`, `pdfBase64`, relatório. Integridade, cadeia confiável, CNPJ em SAN otherName OID2.16.76.1.3.3, cobertura `ENTIRE_FILE` e DocMDP são verificados separadamente. Fingerprint/hash do trust store são registrados. `homologated:false`, `icpBrasilQualified:false`, perfil `pades-basic-unhomologated-v1`, timestamp `not-requested`. Esses marcadores são intencionais: verificação técnica não prova conformidade ICP brasileira completa. O aplicativo não deve classificar nem enviar automaticamente baseado neste relatório. Trust roots explícitas não são substituídas pelas do sistema.

## Configuração de serviço protegida, não HTTP

O caminho padrão é `/etc/peticao-signing/worker.json`. `A1_WORKER_CONFIG` pode ser definido **somente pelo supervisor/provisionamento confiável**, para configuração de serviço/teste; nunca copiar campos da requisição para o ambiente do processo. Não há argumento CLI com senha/certificado.

Configuração: `version:1`, `credentialVersionId`UUID, `pfxPath`absoluto, `passwordPath`absoluto, `trustRootsPath`absoluto, `trustStoreVersion`SHA256dos bytes das raízes, `profile:"pades-basic-unhomologated-v1"`, `environment:"production"`, opcional `crlPaths`lista de caminhos DER. Certificado e senha precisam de **diretórios distintos**; arquivos regulares0600, donos root/conta do serviço, sem links ou ancestrais graváveis por grupo/outros. Não provisionados neste desenvolvimento.

A senha é lida como bytes exatos (sem remoção de newline). PFX, senha, raízes e CRLs são limitados; PFX carregado em memória via descritores protegidos. O processo web não precisa dessas permissões. Armazenamento protegido e backup devem sobreviver restart; cifragem/credencial persistente do supervisor devem ser provisionadas pelo responsável. Permissões locais não protegem contra administrador root.

Rede: `allow_fetching=False`. Raízes e CRLs locais são explícitas; validação em produção usa `hard-fail` **e política explícita CRL_REQUIRED para titular e intermediárias**, com CRLs obrigatórias (hard-fail sozinho não garante evidência se o certificado não declara distribuição). Sem prova de revogação exigida pelo validador, não há sucesso. `synthetic-test` usa `soft-fail` **somente em configuração protegida separada** e marca essa limitação no relatório; nunca promover essa configuração para produção. Sem ACT e sem homologação normativa, o perfil continua não qualificado. Acrescentar ACT/OCSP/profile exige testes e decisão operacional próprios.

Limites locais: alarme60s, CPU45/50s, address space1GiB,64FDs,25MiBPDF. Aplicar adicionalmente conta isolada, egress bloqueado, sandbox do serviço e limites do supervisor antes de ativar. Não persistir chave/PFX/senha em banco, Git, PDF ou logs. Python não garante zeragem de todas as cópias de memória; subprocesso de job único reduz retenção, sem prometer proteção absoluta.

## Dependências e testes locais executados

`requirements.txt` contém versões exatas das dependências instaladas no venv isolado; nenhum pacote global foi modificado. A instalação operacional futura precisa preservar estas versões e acrescentar hashes/repositório aprovado conforme política de implantação.

Venv de QA: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-worker-venv`.

Teste a partir de qualquer diretório:

```bash
A1_TEST_PRIVATE_ROOT=/home/barre/.cache/peticao-a1-worker-qa /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-worker-venv/bin/python /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/test_worker.py
```

O diretório absoluto de QA precisa existir com0700 e ancestrais seguros. O teste gera RSA, CA e PKCS#12 **sintéticos**, cifra o PFX, assina PDF real, verifica criptografia/cadeia e detecta alteração de byte. Testa também titular diverso, confiança divergente, credenciais/configuração inválidas, input assinado, produção sem revogação e ausência de material privado no protocolo. Arquivos temporários são removidos pelo teste. Nenhum certificado real, API paga, SMTP, VPS ou banco foi usado.

O contrato Node está em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/a1-worker-contract.ts` e teste ao lado. Ele confere binding, limites/base64, hashes, preservação do original e dimensões do relatório; não substitui validação criptográfica e depende do canal de subprocesso confiável.

## Documentação primária usada

- https://docs.pyhanko.eu/en/v0.31.0/lib-guide/signing.html
- https://docs.pyhanko.eu/en/v0.31.0/api-docs/pyhanko.sign.signers.html
- https://docs.pyhanko.eu/en/v0.31.0/api-docs/pyhanko.sign.validation.html

Estes exemplos/APIs fundamentam o adaptador; não constituem prova de homologação ICP-Brasil. Os requisitos normativos e a guarda e-CNPJ do aplicativo permanecem separados.

## Perfil técnico com declaração de política

O perfil opcional `pades-ad-rb-declared-unhomologated-v1` acrescenta `policyPath` à configuração protegida. Código e fixture com proveniência em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/signature_policy.py` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/tools/signing/fixtures/ad-rb-v1.3.provenance.json`. A fixture é pública e não é credencial; o arquivo usado pelo runtime precisa atender às proteções do loader e ao pin. Nada foi instalado. O perfil anterior não aceita esse campo extra.

A declaração não comprova autenticidade do espelho, LPA vigente, homologação, carimbo do tempo ou classificação ICP. Consulte `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/docs/ETAPA-06-A1-POLITICA-DECLARADA-20261109.md`. Não aprovar o artefato usando o próprio nome técnico do produtor no allowlist do verificador.
