# Política central de interação dos formulários

Solicitação do responsável de 07/11/2026. Candidato isolado `form-interaction-20261107`, derivado do código publicado com diagnóstico; não integra admin-v2.

## CPF e nome

- `src/lib/cpf-feedback.ts` centraliza o estado visual: CPF incompleto é inválido ao sair; ao receber foco, o aviso desaparece enquanto houver menos de 11 dígitos. Com 11 dígitos e cálculo inválido, o aviso permanece, inclusive durante digitação. CPF válido remove o erro matemático.
- A regra é compartilhada pelo formulário público (servidor/apoiador) e pelo componente de confirmação WhatsApp. Isso não habilita o recurso WhatsApp que está desligado na plataforma.
- Divergência de nome devolvida pela API marca o campo. Receber foco remove o estado visual; apenas nova validação negativa o recoloca. Receber foco não aprova identidade nem altera políticas de grafia, quantidade, partículas, resolvedor, cache ou segurança.
- Modais continuam exclusivos do envio; sair do campo mantém somente avisos locais. Um envio com múltiplos erros gera um único modal; botão Corrigir mantém o foco no primeiro campo inválido.

## Independência dos formulários

Trocar categoria limpa todos os valores, consentimentos, erros, sugestões, desafio de identidade, ticket e estado de envio. Escolher novamente a mesma categoria não limpa. Respostas assíncronas iniciadas em categoria anterior são descartadas, mesmo que o mesmo e-mail seja digitado novamente. Reinicializar a interface não desfaz uma requisição já processada pelo servidor.

## E-mail

Servidor mantém as dicas e estilos existentes, com os três textos institucionais explicitamente solicitados. Exemplos locais confirmados na lista: `unir.br`, `ufmg.br`, `ifro.edu.br`. Não sugerir provedor pessoal nesse formulário.

Apoiador usa prioridade editorial definida em `SUPPORTER_PROVIDER_PRIORITY`: Gmail, Outlook, Hotmail, Yahoo Brasil/internacional, iCloud, Live, UOL, BOL, Terra, Proton e GMX. É ordenação de sugestões, não estatística de mercado ou nova lista de aceitação. Prefixos e distância com transposição consideram as letras digitadas em ordem; `g.com` sugere Gmail, `o.com` Outlook e `gmx.con` GMX. Domínio conhecido exato não é substituído. A sugestão exige ação explícita do usuário; a validação de domínio/MX continua no backend existente.

## Limites e preservação

Não alterar CSS, fontes, tamanhos, privacidade, avisos de armazenamento, assinaturas, hashes, datas, banco ou regras do backend. Sem chamadas reais à API CPF e sem e-mails para assinantes durante testes. O checkout local principal permanece intocado. Publicar somente arquivos de runtime listados no manifesto e depois de testes cumulativos, build, navegador, comparação visual e confirmação de baseline fresca.

## Seletores — decisão de 09/11/2026

Aplicar `docs/POLITICA-CENTRAL-SELETORES.md`: clicar abre todas as opções válidas do contexto; apenas digitar filtra. A correção vale para o corpo do campo, mesmo já focado, e para a seta.
