# Quatro prévias de assinatura - artefatos finais

Entrega visual local, sem alteração no app/VPS ou assinatura real. Fonte reprodutível em `tools/admin-qa/pdf-signature-previews.mts`; os artefatos finais e renders estão em `/mnt/dev/peticao/output/pdf/previas-assinaturas-20261109/`.

Comparativo de quatro páginas e quatro opções isoladas de uma página: A1 e-CNPJ institucional, cartão da presidência, ambos e fluxo genérico gov.br. Dados pessoais fictícios; e-CNPJ institucional obtido do metadado existente no código. Nenhum certificado, chave privada, número de série, assinatura manuscrita, logo gov.br ou validação real.

Quatro renders finais inspecionados; cartões02/03/04 completos e blocos abaixo, sem recorte/sobreposição. Cinco PDFs sem JavaScript, AcroForm, dicionárioSig ou ByteRange. Fonte do gerador do app permaneceu idêntica. Gov.br se refere somente ao arquivo exibido, não a futuras listas.

| Artefato final | Bytes | SHA-256 |
| --- | --- | --- |
| `01-a1-icp-simulada.pdf` | 50041 | `2ee93d918b733acd69accf80c412ce475c9bae4ce03b05834d5db2e4a9482a90` |
| `02-presidente-modelo-site.pdf` | 53164 | `0d3c37d1cf5deb79d1abd2a85dde94d1708118f0f12e945d854dd331d053a990` |
| `03-a1-e-presidente-simuladas.pdf` | 55435 | `54d49ac3f3da541c5c9d5a6c867abcf36644d2cf4ce64fc571393d985b03aa61` |
| `04-govbr-simulada.pdf` | 50297 | `412e642bdb856c78933036a2ac2cb271c9aef43b5f2c433f3ecd05d5ff14502f` |
| `comparativo-quatro-opcoes.pdf` | 205000 | `8a952b7e8cebbb39c020a65d742eccb412703a581bb90497fccbe144c47a121d` |

Renders: `renders/comparativo-1.png` até `comparativo-4.png`. Manifesto e verificações: `manifesto.json`, `verificacao-poppler.json`, `verificacao-estrutura.json`, `conclusao.json` e `README.md` no diretório de entrega.

Limitação: o rodapé original da página-fonte permanece oculto na camada textual, podendo aparecer na extração em modo layout. O rodapé visível é único e legível; extração raw confirma uma única instância do rodapé acrescentado por página. É uma prévia visual, sem promessa de PDF final acessível ou assinatura.

Intermediários/versões rejeitadas estão preservados sob `tmp/pdfs/`; não devem ser anexados. Marcadores create e edit da skillPDF foram executados antes das operações correspondentes. A reprodução usa Node20 e dependências existentes do checkout congelado8cdd97a; não trocar por mainWIP. Não disparar a reprodução após compartilhar sem atualizar o manifesto: os metadados de criação podem produzir novos checksums.

Entrega autorizada apenas ao proprietário pelo agente integrador. Nenhum envio ao governo ou destinatário da petição foi realizado por esta frente.
