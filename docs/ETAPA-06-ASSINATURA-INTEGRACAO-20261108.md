# Etapa6 — limites da integração de assinatura

Inspeção local e consulta às fontes oficiais em08/11/2026. Documento técnico;
nenhum texto de interface, provedor, credencial ou serviço foi ativado.

## Situação do candidato

`site/src/lib/signer.ts` implementa somente `SIGNER=none`. Outros modos lançam
erro. Em produção, fora da prévia, `assertSendable` exige `icp-brasil`.
`signed-pdf.ts` oferece conferência estrutural e um adaptador externo configurável
para validação criptográfica. A correção `2ee972f` exige aprovação booleana estrita.
Isso não implementa uma autoridade certificadora nem comprova validação externa
real. Os testes locais usam respostas fictícias.

## Fontes e dependências externas

O [manual oficial de integração](https://manual-integracao-assinatura-eletronica.servicos.gov.br/pt-br/latest/iniciarintegracao.html)
exige solicitação de credenciais por gestor público; produção depende de Login
Único e domínio oficial. A tabela de escopos distingue certificado gov.br
(avançado) de `icp_brasil` (qualificado por PSC). OAuth requer consentimento,
state/nonce e callback cadastrado. PDF envelopado exige construção da assinatura
sobre os intervalos corretos, não simplesmente o hash do arquivo original.

O [guia do VALIDAR](https://validar.iti.gov.br/guia-desenvolvedor.html)
descreve padrões de documentos e integração por QR Code. Ele não documenta o
contrato JSON customizado `{valid,signer,cnpj}` usado pelo nosso adaptador.

## Próximos passos do módulo

1. Confirmar formalmente elegibilidade e credenciais do serviço escolhido.
   Não há nesta inspeção evidência suficiente de acesso da ADUNIR à API gov.br.
2. Definir certificado/identidade aceitos e o contrato verificável do validador;
   preservar a exigência ICP existente enquanto isso não for decidido.
3. Implementar adaptador isolado, com fixtures e testes de retorno/cancelamento,
   assinatura do documento reservado e revalidação da revisão após a chamada.
4. Homologar sem dados pessoais; somente depois solicitar ativação/publicação.

Essas dependências não impedem continuar o backend e QA dos demais controles de
documentos. Não interpretar API pública documentada como credencial disponível,
teste fictício como homologação, ou aprovação por código como assinatura digital.
