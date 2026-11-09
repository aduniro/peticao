# Etapa 06 — pesquisa primária e plano A1/petição-base

Pesquisa de documentação primária em09/11/2026. Auditoria de fontes commitadas no snapshot8cdd97a, sem executar assinador, instalar bibliotecas, ativar serviço ou abrir certificados/segredos. O responsável confirmou **e-CNPJ da ADUNIR** e aprovou planejar **petição-base assinada pelo gov.br como anexo fixo imutável em cada envio**, mantendo ofício/lista próprios. A assinatura da base cobre somente a base. Esta aprovação é de plano, não de ativação.

## O que pode ser reutilizado

O ITI distingue a aparência visual da assinatura dos mecanismos criptográficos de autoria/integridade. A assinatura protege o conteúdo eletrônico; repetir um desenho/carimbo em outro documento não assina o conteúdo novo. [ITI — Boas Práticas](https://validar.iti.gov.br/guia.html).

**Inferência técnica para o projeto:** o mesmo PDF de petição-base pode acompanhar vários envios, desde que seja anexado com os mesmos bytes. A assinatura continua vinculada àquele arquivo, não às listas posteriores. Esse é o plano aprovado pelo dono: anexo separado, com UUID/versão/SHA-256 congelados. Não se conclui que o órgão destinatário dispensará outros documentos/assinaturas; isso depende dos requisitos de recebimento, não apenas da integridade criptográfica.

| Operação | Interpretação correta |
|---|---|
| Reanexar o mesmo PDF assinado, sem alterar um byte | Reutiliza aquele documento; preservar e conferir hash. Não é nova assinatura. |
| Copiar imagem, selo ou conteúdo visual da assinatura para uma lista | Não transfere a assinatura criptográfica. |
| Copiar páginas da base para outro PDF/concatenar/regravar/imprimir-PDF | Gera outro objeto; não presumir que as assinaturas originais foram preservadas ou cobrem o resultado. |
| Assinar cada novo ofício/lista com A1 | Produz assinatura própria do novo documento; cada resultado é uma versão nova e deve ser validado. |
| Adicionar assinatura incremental a um PDF já assinado | Pode ser suportado conforme permissões/MDP e assinador, mas exige validar todas as assinaturas e alterações permitidas. Não autoriza acrescentar listas arbitrárias. |
| Embutir um PDF assinado como arquivo interno de outro PDF | Não é o mesmo que copiar páginas, mas a validação automática do conteúdo interno/interoperabilidade não é presumida; fora do caminho padrão deste plano. |

As ressalvas sobre atualizações incrementais derivam do [Guia ITI, capítulo VI](https://validar.iti.gov.br/guia-desenvolvedor.html) e da [documentação técnica do pyHanko](https://docs.pyhanko.eu/en/latest/lib-guide/validation/diff-analysis.html). O gov.br orienta baixar o arquivo assinado, evitando a opção imprimir para salvar. [Portal oficial](https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica).

## Objetos e métodos diferentes

A1 é material de chave/certificado utilizado por um assinador. O PDF contém a assinatura criptográfica e certificados públicos necessários; **não recebe o PFX, a chave privada ou a senha como anexo/objeto**. A documentação de [assinatura PKCS#12 do pyHanko](https://docs.pyhanko.eu/en/latest/cli-guide/signing.html) distingue chave, certificado, campo/objeto de assinatura e aparência visível.

O ITI descreve A1 armazenado em computador/dispositivo, com validade típica de um ano. Isso não comprova a validade de qualquer arquivo real nem define automaticamente o resultado de validação futura de documentos antigos. [Certificado Digital — ITI](https://www.gov.br/iti/pt-br/assuntos/icp-brasil/certificado-digital).

- Lote/ofício/lista: política atual exige ICP-Brasil em produção; o alvo autorizado é o e-CNPJ ADUNIR.
- Petição-base: pode trazer assinatura avançada produzida pelo gov.br; registra-se esse método, sem renomeá-lo como ICP-Brasil.
- Confirmação própria do app: autenticação/recibo próprios, sem equivalência automática com os dois métodos acima.
- Aparência/QR: elemento visual de acesso ou indicação, não prova autônoma da assinatura.

O [VALIDAR oficial](https://validar.iti.gov.br/sobre.html) verifica autoria/integridade nas infraestruturas aceitas, incluindo ICP-Brasil e gov.br; não atesta a verdade do conteúdo ou que a assinatura de um arquivo cubra outro arquivo.

## Normas/documentação atuais consultadas

O [catálogo do ITI](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais/) aponta DOC-ICP-15.03 **v9.1**. A [versão oficial compilada](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais/v9.1_IN2021_03_DOCICP15.03_compilada.pdf) traz requisitos de perfis, atributos/OIDs e dicionários; não basta escolher uma biblioteca com a palavra PAdES no README. O [Guia ITI](https://validar.iti.gov.br/guia-desenvolvedor.html) recomenda PAdES e políticas RB/RT e trata controles MDP. As [dúvidas do VALIDAR](https://validar.iti.gov.br/duvidas.html) alertam sobre resultado indeterminado na ausência de FieldMDP/DocMDP. A implantação deve conferir perfil/artefatos vigentes e homologar o resultado exato, sem fixar neste relatório um OID arbitrário como universal.

O guia de integração descreve QR de acesso a documento, inclusive contrato voltado a prescrição; ele não é documentação do nosso JSON customizado de validação nem autoriza aplicar automaticamente regras de prescrição à petição. O endpoint local de metadados não-PII já implementado não oferece o PDF ao ITI e não deve ser anunciado como integração oficial VALIDAR.

Para assinatura manual, o portal gov.br admite conta prata/ouro e devolve arquivo assinado. Integração automatizada é outro produto: o [manual oficial de credenciais](https://manual-integracao-assinatura-eletronica.servicos.gov.br/pt-br/latest/iniciarintegracao.html) exige solicitação por gestor público e condições específicas para produção. Não há nesta auditoria prova de credenciais/elegibilidade da ADUNIR para a API. Upload de arquivo assinado externamente não depende de fingir essa integração disponível.

## Estado real do código commitado

Fontes auditadas: `signer.ts`, `signed-pdf.ts`, pontos de preparo/anexação/envio em `batches.ts`, esquema/histórico binário e package/lock de8cdd97a. Nenhum arquivo runtime foi lido.

1. `signPdf` implementa somente `SIGNER=none`; qualquer outro valor lança erro. A1 automático **não está integrado**. `signerNote` rotula o modo pretendido antes da assinatura: essa nota não pode virar prova de sucesso. Na evolução, o status precisa vir do resultado criptográfico validado.
2. O projeto usa `pdf-lib`1.17.1. O [próprio projeto](https://pdf-lib.js.org/docs/api/classes/pdfsignature) informa não oferecer APIs especializadas para gerar/ler assinaturas criptográficas. Inserir texto/imagem/campo com essa biblioteca não resolve o A1.
3. `checkSignedPdf` faz checks estruturais por prefixo, regex de ByteRange e SubFilter; não valida criptografia, cadeia, MDP, identidade ou conformidade completa. Pode rejeitar PDFs legitimamente regravados por assinadores externos; não se promete compatibilidade de todo upload gov.br. A allowlist atual não inclui, por exemplo, `PBAD.PAdES`, presente no documento normativo; não ampliar/relaxar checks sem fixtures e validação de perfil.
4. `verifyIcpBrasil` delega PDF a `ICP_VALIDATOR_URL` com contrato próprio `{valid,signer,cnpj}`. O ITI não foi identificado como implementador desse contrato. Hoje `valid===true` é exigido, mas CNPJ só é comparado quando presente; o agente `admin_completion_audit` está responsável por tornar a identificação e-CNPJ obrigatória. **Não duplicar essa alteração nesta frente.** Ainda faltam vínculo do relatório ao hash e evidência de perfil/cadeia/revogação/MDP.
5. `assertSendable` continua exigindo ICP-Brasil em produção. Não afrouxar a guarda para aceitar a petição-base gov.br como se ela assinasse o lote.
6. O envelope atual tem um único anexo do lote. `documentVersion`, approvalHash e identidade de envio precisam incluir o novo pacote/base antes de anexar uma base em produção. Não acrescentar arquivo ao envelope antigo com a mesma chave de idempotência de uma tentativa anterior.

SHA-256 das duas fontes centrais auditadas: signer `d516114f3bcba1f77e703ea4022eefc247388c155b8c48a9cfd54a6cb558eef7`; signed-pdf `62fc0bb626521c22f73193243a25ed933ff14f17a040f16d3584116ac61909b7`.

## Opções técnicas reais, ainda não instaladas

| Caminho | Suporte documentado | Limite relevante |
|---|---|---|
| Assinador externo/manual e upload protegido | Preserva a chave no ambiente do titular e envia apenas PDF resultante | Exige homologar formato/MDP e validar arquivo exato; não é automação A1 do app. |
| Worker isolado com pyHanko | PKCS#12, atualizações incrementais, perfis PAdES, cadeia/timestamp e validação configurável | Não é, por si só, implementação homologada de todos os requisitos brasileiros. Fixar versão, confiança ICP e adaptar/homologar o perfil. |
| Node `@signpdf` + signer-p12 + placeholder-pdf-lib | Documentação oficial suporta P12 e assinatura CMS/PAdES básica | Introduz dependências e montagem de placeholders; não presume MDP, múltiplas assinaturas ou perfil ICP completos. Helper plain é descrito como frágil. |

Fontes primárias dos projetos: [pyHanko — API](https://docs.pyhanko.eu/en/latest/lib-guide/signing.html), [pyHanko — validação e limites](https://docs.pyhanko.eu/en/latest/cli-guide/validation.html), [repositório oficial @signpdf](https://github.com/vbuch/node-signpdf). A validação pyHanko separa integridade, confiança e alterações, mas documenta limites de conformidade estrutural de perfis; logo um booleano genérico não basta para declarar homologação ICP.

## Contrato proposto do pacote por envio

Proposta implementável, **ainda não aplicada**:

```
packageVersion: 2
batch: {id, documentVersion, finalArtifactVersionId, sha256}
basePetition: {artifactId, versionId, sha256, byteLength,
              method: "gov-br-advanced", coverage: "base-only"}
attachments: [
  {role:"batch", versionId, sha256, filename, contentType:"application/pdf"},
  {role:"petition-base", versionId, sha256, filename, contentType:"application/pdf"}
]
packageDigest: SHA256(canonical manifest)
```

- A base é recebida em registro protegido próprio, com bytes imutáveis, hash, revisão, autoria de upload/revisão e relatório de validação vinculado ao hash. Cadastro, validação e eleição da versão fixa são passos distintos. Não usar uma variante de lote como base por conveniência do schema atual.
- A eleição da base fixa é explícita pelo Total com stepup, CAS e auditoria; por padrão não há base ativa nem envio novo do pacotev2. Não ativar registro real neste trabalho. Uma versão nova só muda futuras reservas explicitamente; jamais substituir bytes referenciados por pacotes antigos.
- A lista/ofício continua seguindo sua própria regra e-CNPJ. Se houver ofício separado, ele vira terceiro artefato/entrada explícita no manifesto, com regra definida; não concatenar nem inventar cobertura automática.
- Hashes, nomes de arquivos e papéis são congelados na reserva/aprovação e entram no código humano/idempotência. Cada envio inclui sempre a base eleita em bytes idênticos e seu lote/ofício próprios; tamanho total/provedor são verificados antes de admitir, sem descartar anexo silenciosamente.
- Mensagens já admitidas e retries mantêm o envelope anterior exato. Pacotev2 usa domínio/versionamento de idempotência próprio; não reaproveitar a chavev1 alterando anexos. A base não muda porque configuração foi editada depois da admissão.
- Revogação/revisão incompatível antes de nova admissão trava e exige decisão explícita. O hash prova preservação dos bytes, não garante que qualquer validação futura será sempre positiva; guardar instante, relatório, cadeia/política e eventual evidência temporal.
- A base fica protegida; o plano não cria URL pública/PDF público para facilitar validação. QR/avisos/integração pública continuam decisões separadas.

## Plano A1 com proteção e gate

1. **Fechar política e-CNPJ e validação** com a frente responsável: identidade esperada obrigatória, artefato/hash exatos, cadeia ICP confiável, perfil/política, revogação/validade, cobertura/MDP e timestamps quando requeridos. Resposta de validador deve incluir identificação do arquivo e motivo/estado de validação; falha/indeterminação não viram sucesso. Gov.br-base usa método separado, não passa pelo atalho e-CNPJ.
2. **Implementar pacote/base imutáveis primeiro**, com store/rotas administrativas protegidas, revisão e testes PostgreSQL fictícios. Incluir manifesto no snapshot/admissão e transporte, preservando mensagens/documentos antigos e sem ativar envio. Propor DDL aditiva ao principal antes da edição; não executar agora.
3. **Preparar adapter de assinatura real** após escolher tecnologia/versão. Worker dedicado recebe somente bytes reservados + job/version/hash e autorização de uso único, em vez de assinar PDF arbitrário vindo da web. Gate desligado por padrão, Total+stepup/CAS/auditoria e revalidação antes de publicar a versão. Chamada externa não mantém transação longa; commit posterior confere revisão/hash/lease. Nunca regravar o original reservado.
4. **Provisionar o A1 somente com autorização operacional**: PFX protegido e cifrado fora de Git, DB, uploads públicos e diretório web; segredo de desbloqueio separado, fornecido por mecanismo de credencial protegido/FD, não argumento de shell/chat/log. Permissões mínimas para a conta do assinador, sem entregar a chave ao processo web quando evitável. Restringir egress a confiança/revogação/ACT necessários e limitar CPU/tempo/arquivo. Isso não protege contra administrador legítimo com poderes de root; não alegar proteção absoluta.
5. **Publicar só resultado validado**: PDF novo, hash e versão imutáveis, relatório do mesmo arquivo, fingerprint/certificado público e classificação e-CNPJ somente após validação. A parte pública pode integrar a assinatura; chave privada e senha nunca entram no PDF nem no retorno da API. Nenhuma habilitação automática por presença de arquivo/config.
6. **QA funcional e homologação separadas**: cadeia/teste e PKCS#12 sintéticos em ambiente isolado (sem chamar isso ICP real), adulteração de byte, CNPJ ausente/diverso, cadeia não confiável, assinatura vencida/revogada/MDP incompatível, provider indisponível, concorrência, lease/CAS/auditoria, base alterada após aprovação e retry com envelope idêntico. Conferir extração dos anexos/hash no email dev. Depois, homologar amostra autorizada do artefato exato no VALIDAR/validador aceito; não enviar documento pessoal ou certificado real em teste automatizado.
7. **Ativação final explícita**, após evidências/textos aprovados, provisionamento protegido e prova de rollback. Até lá manter SIGNER=none, nenhum envio real e as guardas existentes. Não criar biblioteca A1 fake que retorne status qualificado sem operação criptográfica.

## O que permanece pendente

A1 automático, base persistida/eleita, pacotev2 e verificação externa homologada **não estão integrados** por este relatório. Nenhuma senha/PFX/certificado foi solicitado ou lido. Não houve alteração de app/schema, instalação, API de assinatura/validação, upload de documento real, serviço ou envio. A inspeção usou somente fontes e páginas públicas; requireCNPJ é trabalho independente coordenado com `admin_completion_audit`.
